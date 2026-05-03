/**
 * Stripe ↔ ledger reconciliation script.
 *
 * Walks every wallet_transactions row that has a `stripe_reference`
 * (Checkout session, Payout, or Refund) and verifies that:
 *   1. the row's lifecycle (`external_status`) is not stuck pending,
 *   2. (live mode only) the Stripe object still exists and its status
 *      matches our column.
 *
 * In stub mode (no `STRIPE_SECRET_KEY`) the script is a no-op except
 * for surfacing rows with stale `pending` external_status > 24h —
 * useful in dev to spot orphaned checkout sessions caused by an
 * abandoned redirect.
 *
 * The script intentionally does NOT mutate the DB: webhooks are the
 * authoritative writer. This script's job is to alert.
 *
 * Run via:
 *   pnpm --filter @workspace/scripts exec tsx ./src/stripe-reconcile.ts
 */
import { db, walletTransactionsTable } from "@workspace/db";
import { and, eq, isNotNull, lt } from "drizzle-orm";

const STUB = !process.env.STRIPE_SECRET_KEY;

async function reconcile(): Promise<void> {
  console.log(`[stripe-reconcile] starting (stub mode: ${STUB})`);

  // Surface stale "pending" rows older than 24h regardless of mode.
  // Even in stub mode this catches forgotten Checkout flows.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await db
    .select({
      id: walletTransactionsTable.id,
      stripeReference: walletTransactionsTable.stripeReference,
      externalStatus: walletTransactionsTable.externalStatus,
      createdAt: walletTransactionsTable.createdAt,
    })
    .from(walletTransactionsTable)
    .where(
      and(
        isNotNull(walletTransactionsTable.stripeReference),
        eq(walletTransactionsTable.externalStatus, "pending"),
        lt(walletTransactionsTable.createdAt, staleCutoff),
      ),
    );

  if (stale.length === 0) {
    console.log("[stripe-reconcile] no stale pending rows.");
  } else {
    console.warn(
      `[stripe-reconcile] ${stale.length} rows stuck in 'pending' >24h:`,
    );
    for (const row of stale) {
      console.warn(
        `  - tx#${row.id} ref=${row.stripeReference} created=${row.createdAt.toISOString()}`,
      );
    }
  }

  if (STUB) {
    console.log(
      "[stripe-reconcile] stub mode — skipping live Stripe verification.",
    );
    return;
  }

  // Live-mode reconciliation requires the Stripe SDK; the user opted
  // out of installing it. When a real key is configured later, replace
  // this branch with a fetch loop against the Stripe REST API.
  console.warn(
    "[stripe-reconcile] STRIPE_SECRET_KEY is set but the Stripe SDK is not " +
      "bundled in this build. Install `stripe` and extend this script before " +
      "going live.",
  );
}

reconcile()
  .then(async () => {
    // Drizzle's pg pool keeps an open handle; close it so the process exits.
    type EndableClient = { end?: () => Promise<unknown> };
    const client = (db as unknown as { $client?: EndableClient }).$client;
    await client?.end?.().catch(() => {});
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[stripe-reconcile] FATAL", err);
    type EndableClient = { end?: () => Promise<unknown> };
    const client = (db as unknown as { $client?: EndableClient }).$client;
    await client?.end?.().catch(() => {});
    process.exit(2);
  });
