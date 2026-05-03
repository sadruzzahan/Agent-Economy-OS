import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  walletsTable,
  auditLogTable,
  type User,
} from "@workspace/db";
import { Errors } from "./errors";
import { getAdminBootstrapEmails } from "./env";

/**
 * Append a role-change audit row directly (without requiring a Request
 * context). Role changes are rare and high-stakes so we write them
 * synchronously and surface failures in the logs but never block the
 * surrounding user-sync path.
 */
async function auditRoleChange(opts: {
  userId: number;
  fromRole: string;
  toRole: string;
  reason: string;
}): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorUserId: null, // System action — no human actor.
      actorAgentId: null,
      action: "user.role_change",
      targetType: "user",
      targetId: opts.userId,
      ipAddress: null,
      userAgent: null,
      requestId: null,
      before: { role: opts.fromRole },
      after: { role: opts.toRole, reason: opts.reason },
    });
  } catch {
    // Intentional swallow — the role change has already happened and
    // we don't want to break the user's request because audit failed.
    // The DB insert error is visible in pg logs.
  }
}

declare global {
  namespace Express {
    interface Request {
      dbUser?: User;
    }
  }
}

export async function getOrCreateDbUser(
  clerkUserId: string,
): Promise<User> {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId));
  if (existing) {
    // Idempotent admin bootstrap: if this user's email is in the
    // ADMIN_BOOTSTRAP_EMAILS list and they're not yet an admin, promote
    // them. This lets ops grant the first admin role without ever issuing
    // a SQL UPDATE in production.
    if (existing.role !== "admin" && existing.email) {
      const admins = getAdminBootstrapEmails();
      if (admins.includes(existing.email.toLowerCase())) {
        const [promoted] = await db
          .update(usersTable)
          .set({ role: "admin" })
          .where(eq(usersTable.id, existing.id))
          .returning();
        if (promoted) {
          await auditRoleChange({
            userId: promoted.id,
            fromRole: existing.role,
            toRole: "admin",
            reason: "ADMIN_BOOTSTRAP_EMAILS promotion on login",
          });
        }
        return promoted ?? existing;
      }
    }
    return existing;
  }

  let email: string | null = null;
  let displayName: string | null = null;
  let avatarUrl: string | null = null;
  try {
    const cu = await clerkClient.users.getUser(clerkUserId);
    email = cu.emailAddresses?.[0]?.emailAddress ?? null;
    const first = cu.firstName ?? "";
    const last = cu.lastName ?? "";
    displayName =
      [first, last].filter(Boolean).join(" ").trim() ||
      cu.username ||
      email ||
      "User";
    avatarUrl = cu.imageUrl ?? null;
  } catch {
    displayName = "User";
  }

  const adminEmails = getAdminBootstrapEmails();
  const role: "admin" | "user" =
    email && adminEmails.includes(email.toLowerCase()) ? "admin" : "user";

  const [user] = await db
    .insert(usersTable)
    .values({ clerkUserId, email, displayName, avatarUrl, role })
    .returning();

  if (!user) throw new Error("Failed to create user");

  // First-class audit row whenever a brand-new account starts elevated.
  // Default ("user") creations are not audited — they're the baseline.
  if (role !== "user") {
    await auditRoleChange({
      userId: user.id,
      fromRole: "(new account)",
      toRole: role,
      reason: "ADMIN_BOOTSTRAP_EMAILS promotion at first sync from Clerk",
    });
  }

  await db.insert(walletsTable).values({
    kind: "user",
    ownerUserId: user.id,
    balance: "100.00",
  });

  return user;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    return next(Errors.unauthorized());
  }
  try {
    req.dbUser = await getOrCreateDbUser(clerkUserId);
    next();
  } catch (err) {
    req.log?.error({ err }, "Failed to resolve user");
    next(err);
  }
}
