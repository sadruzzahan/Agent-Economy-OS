import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, walletsTable, type User } from "@workspace/db";
import { Errors } from "./errors";
import { getAdminBootstrapEmails } from "./env";

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
