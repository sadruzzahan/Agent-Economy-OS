import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  bigint,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { agentsTable } from "./agents";
import { tasksTable } from "./tasks";

/**
 * Wallet balances are stored in integer USD cents. Float/decimal money
 * math is a footgun — every value here is a `bigint` column read in
 * `mode: "number"` (safe up to ~$90T). Conversion to/from dollars is
 * confined to `lib/money.ts` on the API server.
 */
export const walletsTable = pgTable(
  "wallets",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    ownerUserId: integer("owner_user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
    agentId: integer("agent_id")
      .references(() => agentsTable.id, { onDelete: "cascade" })
      .unique(),
    balanceCents: bigint("balance_cents", { mode: "number" })
      .notNull()
      .default(0),
    escrowedCents: bigint("escrowed_cents", { mode: "number" })
      .notNull()
      .default(0),
    /**
     * Balance that's been credited to the ledger but is still inside
     * Stripe's pending-settlement window. We don't allow payouts against
     * pending funds — see `lib/money.ts` and the payout route.
     */
    pendingCents: bigint("pending_cents", { mode: "number" })
      .notNull()
      .default(0),
    totalEarnedCents: bigint("total_earned_cents", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index("wallets_owner_user_idx").on(t.ownerUserId),
  }),
);

export const walletTransactionsTable = pgTable(
  "wallet_transactions",
  {
    id: serial("id").primaryKey(),
    walletId: integer("wallet_id")
      .notNull()
      .references(() => walletsTable.id, { onDelete: "cascade" }),
    /**
     * Transaction type. Existing ledger types plus payment-rail types:
     *   top_up, escrow_lock, escrow_release, escrow_return, credit, debit,
     *   payout, refund, fee_adjust
     */
    type: text("type").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    balanceAfterCents: bigint("balance_after_cents", {
      mode: "number",
    }).notNull(),
    /** Platform/Stripe fee captured against this transaction, in cents. */
    feeAmountCents: bigint("fee_amount_cents", { mode: "number" })
      .notNull()
      .default(0),
    /**
     * Lifecycle of an external payment-rail event:
     *   null         — internal-only ledger entry (escrow lock, refund credit)
     *   pending      — Checkout/PaymentIntent/Payout created, not yet settled
     *   succeeded    — webhook confirmed funds moved
     *   failed       — webhook reported failure (we may have rolled back)
     *   refunded     — original charge was refunded
     */
    externalStatus: text("external_status"),
    /**
     * Stripe object id we can use to reconcile this row. Format examples:
     *   cs_test_..., pi_3..., re_3..., po_..., tr_...
     * Made unique-per-status downstream by the reconciliation script.
     */
    stripeReference: text("stripe_reference"),
    relatedTaskId: integer("related_task_id").references(() => tasksTable.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    walletCreatedIdx: index("wallet_tx_wallet_created_idx").on(
      t.walletId,
      t.createdAt.desc(),
    ),
    stripeRefIdx: index("wallet_tx_stripe_ref_idx").on(t.stripeReference),
  }),
);

/**
 * Every Stripe webhook event we have processed. Stripe guarantees an
 * `id` like `evt_1Nx...` per event, so the primary key alone gives us
 * exactly-once processing — replays become a no-op INSERT conflict.
 *
 * We record the full payload so reconciliation and forensics don't need
 * a Stripe API round-trip months later.
 */
export const stripeEventsTable = pgTable(
  "stripe_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    /**
     * Null until the side-effect handler has finished. A row with a
     * non-null `processed_at` is a successful end-state; a row with
     * a null one is a claim-in-flight that the next webhook delivery
     * is allowed to retry. This is the linchpin of our exactly-once
     * processing — see `routes/stripe.ts` for the full contract.
     */
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    typeIdx: index("stripe_events_type_idx").on(t.type),
  }),
);

export type Wallet = typeof walletsTable.$inferSelect;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
export type StripeEvent = typeof stripeEventsTable.$inferSelect;
