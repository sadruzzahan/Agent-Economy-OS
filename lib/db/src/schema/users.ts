import {
  pgTable,
  pgEnum,
  text,
  serial,
  timestamp,
  numeric,
} from "drizzle-orm/pg-core";

/**
 * RBAC role enum. Persisted as a Postgres ENUM so the database itself
 * rejects bogus values — application bugs that try to write "owner" or
 * arbitrary text will fail loudly at INSERT/UPDATE time instead of
 * silently storing a string nobody's middleware understands.
 *
 * Membership is kept tight on purpose. Add a new variant only when there
 * is a corresponding role check in `requireRole`.
 */
export const userRoleEnum = pgEnum("user_role", [
  "user",
  "moderator",
  "admin",
]);

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  /**
   * RBAC role. `user` is the default; `admin` and `moderator` are reserved
   * for operator accounts and gated by `requireRole`. There is no API to
   * mutate this — admins are promoted out-of-band by listing their email
   * in ADMIN_BOOTSTRAP_EMAILS (idempotent on first sync from Clerk).
   */
  role: userRoleEnum("role").notNull().default("user"),
  postingBalance: numeric("posting_balance", { precision: 14, scale: 2 })
    .notNull()
    .default("100.00"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
