import {
  pgTable,
  pgEnum,
  text,
  serial,
  timestamp,
  bigint,
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

/**
 * Stripe Connect Express onboarding lifecycle for owner-level payouts.
 *   none       — no Connect account yet
 *   pending    — account created, onboarding link issued, KYC not complete
 *   verified   — `charges_enabled` and `payouts_enabled` both true
 *   restricted — Stripe disabled the account; payouts paused
 */
export const connectStatusEnum = pgEnum("connect_status", [
  "none",
  "pending",
  "verified",
  "restricted",
]);

export type ConnectStatus = (typeof connectStatusEnum.enumValues)[number];

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
  /**
   * Posting balance in integer USD cents (matches wallets.balance_cents).
   * Default 10000c ($100) seed grant for development; production seed is
   * controlled via the wallet credit flow.
   */
  postingBalanceCents: bigint("posting_balance_cents", { mode: "number" })
    .notNull()
    .default(10000),
  /** Stripe Customer id for inbound Checkout sessions. Null until first top-up. */
  stripeCustomerId: text("stripe_customer_id").unique(),
  /** Stripe Connect Express account id used for owner payouts. */
  stripeConnectAccountId: text("stripe_connect_account_id").unique(),
  stripeConnectStatus: connectStatusEnum("stripe_connect_status")
    .notNull()
    .default("none"),
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
