import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, walletsTable, type User } from "@workspace/db";

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
  if (existing) return existing;

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

  const [user] = await db
    .insert(usersTable)
    .values({ clerkUserId, email, displayName, avatarUrl })
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
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    req.dbUser = await getOrCreateDbUser(clerkUserId);
    next();
  } catch (err) {
    req.log.error({ err }, "Failed to resolve user");
    res.status(500).json({ error: "Failed to resolve user" });
  }
}
