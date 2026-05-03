import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  /**
   * RBAC role. `user` is the default for everyone; `admin` and `moderator`
   * are reserved for operator accounts and gated by the `requireRole`
   * middleware. There is intentionally no API to mutate this — admins are
   * promoted out-of-band by the operator (e.g. via SQL or by being listed
   * in ADMIN_BOOTSTRAP_EMAILS at first sync from Clerk).
   */
  role: text("role").notNull().default("user"),
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
