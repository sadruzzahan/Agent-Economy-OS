import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  walletsTable,
  walletTransactionsTable,
  stripeEventsTable,
  type ConnectStatus,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { audit } from "../lib/audit";
import { Errors } from "../lib/errors";
import { walletLimit } from "../middlewares/rateLimits";
import { stripeClient, type WebhookEvent } from "../lib/stripe";
import { getAppBaseUrl, getStubWebhookSecret } from "../lib/env";
import { centsFromDb, formatCents } from "../lib/money";
import { logger } from "../lib/logger";
import { z } from "zod";

const router: IRouter = Router();

// ─── Connect onboarding ─────────────────────────────────────────────────────

router.post(
  "/stripe/connect/onboard",
  requireAuth,
  walletLimit,
  async (req, res): Promise<void> => {
    const me = req.dbUser!;
    let accountId = me.stripeConnectAccountId;
    const priorStatus: ConnectStatus = me.stripeConnectStatus;

    if (!accountId) {
      const acct = await stripeClient.createConnectAccount({
        email: me.email,
        userId: me.id,
      });
      accountId = acct.id;
      await db
        .update(usersTable)
        .set({
          stripeConnectAccountId: accountId,
          stripeConnectStatus: "pending",
        })
        .where(eq(usersTable.id, me.id));
    }

    const baseUrl = getAppBaseUrl();
    const link = await stripeClient.createOnboardingLink({
      accountId,
      refreshUrl: `${baseUrl}/wallet?connect=refresh`,
      returnUrl: `${baseUrl}/wallet?connect=return`,
    });

    await audit(req, {
      action: "connect.onboard_start",
      targetType: "stripe_event",
      targetId: null,
      after: {
        accountId,
        priorStatus,
        stub: stripeClient.isStub,
      },
    });

    res.json({
      accountId,
      onboardingUrl: link.url,
      expiresAt: link.expiresAt,
      stub: stripeClient.isStub,
    });
  },
);

router.get(
  "/stripe/connect/status",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.dbUser!;
    if (!me.stripeConnectAccountId) {
      res.json({
        accountId: null,
        status: "none" as ConnectStatus,
        chargesEnabled: false,
        payoutsEnabled: false,
        requirementsCurrentlyDue: [],
        stub: stripeClient.isStub,
      });
      return;
    }
    const status = await stripeClient.retrieveAccount(
      me.stripeConnectAccountId,
    );
    let nextStatus: ConnectStatus = me.stripeConnectStatus;
    if (status.chargesEnabled && status.payoutsEnabled) {
      nextStatus = "verified";
    } else if (status.requirementsCurrentlyDue.length === 0) {
      nextStatus = "pending";
    } else {
      nextStatus = "restricted";
    }
    if (nextStatus !== me.stripeConnectStatus) {
      await db
        .update(usersTable)
        .set({ stripeConnectStatus: nextStatus })
        .where(eq(usersTable.id, me.id));
      await audit(req, {
        action: "connect.status_change",
        targetType: "stripe_event",
        targetId: null,
        before: { status: me.stripeConnectStatus },
        after: { status: nextStatus },
      });
    }
    res.json({
      accountId: me.stripeConnectAccountId,
      status: nextStatus,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      requirementsCurrentlyDue: status.requirementsCurrentlyDue,
      stub: stripeClient.isStub,
    });
  },
);

// ─── Webhook ────────────────────────────────────────────────────────────────

/**
 * POST /stripe/webhook — Receives Stripe events. Mounted in app.ts
 * BEFORE the global JSON parser so `req.body` is the raw Buffer needed
 * for signature verification.
 *
 * Idempotency contract (exactly-once side effects):
 *   1. INSERT INTO stripe_events (id, …, processed_at = NULL) ON CONFLICT
 *      DO NOTHING. The PK conflict is the lock that serializes
 *      concurrent deliveries.
 *   2. If we lost the race (no row inserted), look the existing row up:
 *        - processed_at IS NOT NULL → already done, reply 200 no-op.
 *        - processed_at IS NULL    → previous attempt CRASHED before
 *                                     finishing; we get to retry. (This
 *                                     case is rare in practice but it
 *                                     is the difference between
 *                                     "exactly once" and "at-most once
 *                                     while still telling Stripe yes".)
 *   3. Run the side effect.
 *   4. UPDATE … SET processed_at = NOW(). Stripe retries on any
 *      non-2xx, so a thrown side effect leaves processed_at NULL and
 *      the next delivery resumes from step 2.
 */
const SessionPayload = z.object({
  id: z.string(),
  amount_total: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string()).optional(),
  payment_intent: z.string().nullable().optional(),
});

/** Programmatic entry point: process a synthesized stub event from
 *  inside the same process (e.g. our own /wallets/checkout in stub
 *  mode auto-settles the credit). Goes through the same idempotency
 *  contract as a real Stripe delivery. */
export async function processStripeEvent(event: WebhookEvent): Promise<void> {
  const inserted = await db
    .insert(stripeEventsTable)
    .values({
      id: event.id,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
      // processedAt intentionally omitted — defaults to NULL until
      // the side effect succeeds.
    })
    .onConflictDoNothing({ target: stripeEventsTable.id })
    .returning({ id: stripeEventsTable.id });

  if (inserted.length === 0) {
    const [existing] = await db
      .select({ processedAt: stripeEventsTable.processedAt })
      .from(stripeEventsTable)
      .where(eq(stripeEventsTable.id, event.id));
    if (existing?.processedAt) return; // already done
    // else: previous attempt crashed — fall through and retry side effect.
  }

  await dispatchEvent(event);

  await db
    .update(stripeEventsTable)
    .set({ processedAt: new Date() })
    .where(eq(stripeEventsTable.id, event.id));
}

async function dispatchEvent(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event);
      break;
    case "checkout.session.expired":
      await handleCheckoutExpired(event);
      break;
    case "payout.paid":
    case "payout.failed":
      await handlePayoutSettled(event);
      break;
    case "account.updated":
      await handleAccountUpdated(event);
      break;
    default:
      logger.debug({ type: event.type }, "Unhandled Stripe event type");
  }
}

router.post(
  "/stripe/webhook",
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers["stripe-signature"];
    let event: WebhookEvent;
    try {
      const raw = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body ?? {}));

      // Stub-mode auth: refuse anonymous traffic. The shared secret
      // can travel either as the Stripe-Signature header value (real
      // Stripe-style) or as the x-stub-webhook-secret header (curl-
      // friendly during development).
      if (stripeClient.isStub) {
        const stubSecret = getStubWebhookSecret();
        const provided =
          (typeof signature === "string" ? signature : undefined) ??
          (req.headers["x-stub-webhook-secret"] as string | undefined);
        if (provided !== stubSecret) {
          throw new Error(
            "Stub webhook auth failed: missing/invalid x-stub-webhook-secret",
          );
        }
      }

      event = stripeClient.verifyWebhook(
        raw,
        typeof signature === "string" ? signature : undefined,
      );
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "Stripe webhook verification failed",
      );
      throw Errors.badRequest("Webhook verification failed");
    }

    await audit(req, {
      action: "stripe.event_received",
      targetType: "stripe_event",
      targetId: null,
      after: { eventId: event.id, type: event.type },
    });

    try {
      await processStripeEvent(event);
    } catch (err) {
      // Surface to Stripe so it retries — processedAt stays NULL on
      // the event row, which means the next delivery legitimately
      // re-runs the side effect.
      logger.error(
        { err, eventId: event.id, type: event.type },
        "Webhook side-effect failed",
      );
      throw err;
    }

    res.json({ received: true });
  },
);

async function handleCheckoutCompleted(event: WebhookEvent) {
  const sess = SessionPayload.parse(event.data.object);
  const userId = Number(sess.metadata?.userId ?? 0);
  const amountCents = sess.amount_total ?? 0;
  if (!userId || amountCents <= 0) return;

  await db.transaction(async (tx) => {
    // Re-check the existing tx row INSIDE the transaction — guards
    // against a concurrent delivery that already credited.
    const existing = await tx
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.stripeReference, sess.id));
    if (existing.length > 0 && existing[0]!.externalStatus === "succeeded") {
      return;
    }

    const [wallet] = await tx
      .select()
      .from(walletsTable)
      .where(eq(walletsTable.ownerUserId, userId));
    if (!wallet) return;

    const amountCentsStr = String(amountCents);
    const [updated] = await tx
      .update(walletsTable)
      .set({
        balanceCents: sql`${walletsTable.balanceCents} + ${amountCentsStr}::bigint`,
      })
      .where(eq(walletsTable.id, wallet.id))
      .returning({ balanceCents: walletsTable.balanceCents });
    await tx
      .update(usersTable)
      .set({
        postingBalanceCents: sql`${usersTable.postingBalanceCents} + ${amountCentsStr}::bigint`,
      })
      .where(eq(usersTable.id, userId));

    if (existing.length > 0) {
      await tx
        .update(walletTransactionsTable)
        .set({
          externalStatus: "succeeded",
          balanceAfterCents: centsFromDb(updated!.balanceCents),
          description: `Wallet top-up: ${formatCents(amountCents)}`,
        })
        .where(eq(walletTransactionsTable.id, existing[0]!.id));
    } else {
      await tx.insert(walletTransactionsTable).values({
        walletId: wallet.id,
        type: "top_up",
        amountCents,
        balanceAfterCents: centsFromDb(updated!.balanceCents),
        externalStatus: "succeeded",
        stripeReference: sess.id,
        description: `Wallet top-up: ${formatCents(amountCents)}`,
      });
    }
  });
}

async function handleCheckoutExpired(event: WebhookEvent) {
  const sess = SessionPayload.parse(event.data.object);
  await db
    .update(walletTransactionsTable)
    .set({ externalStatus: "failed" })
    .where(eq(walletTransactionsTable.stripeReference, sess.id));
}

const PayoutPayload = z.object({
  id: z.string(),
  status: z.string(),
});

/**
 * Payout settlement — `payout.paid` flips status to succeeded; on
 * `payout.failed` we MUST also restore the wallet balance we already
 * debited at request time, because the funds never actually left.
 *
 * We compensate by inserting a paired credit transaction (kind
 * `fee_adjust` so it's clearly a reversal, not a fresh deposit) and
 * bumping the wallet back up. Both updates live in one transaction
 * to preserve the invariant `balance + escrowed == sum(transactions)`.
 */
async function handlePayoutSettled(event: WebhookEvent) {
  const po = PayoutPayload.parse(event.data.object);
  const succeeded = event.type === "payout.paid";

  await db.transaction(async (tx) => {
    const [debitTx] = await tx
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.stripeReference, po.id));
    if (!debitTx) return;
    if (debitTx.externalStatus === (succeeded ? "succeeded" : "failed")) {
      return; // already settled
    }

    await tx
      .update(walletTransactionsTable)
      .set({ externalStatus: succeeded ? "succeeded" : "failed" })
      .where(eq(walletTransactionsTable.id, debitTx.id));

    if (!succeeded) {
      const refundCents = Math.abs(Number(debitTx.amountCents));
      const refundCentsStr = String(refundCents);
      const [restored] = await tx
        .update(walletsTable)
        .set({
          balanceCents: sql`${walletsTable.balanceCents} + ${refundCentsStr}::bigint`,
        })
        .where(eq(walletsTable.id, debitTx.walletId))
        .returning({ balanceCents: walletsTable.balanceCents });
      await tx.insert(walletTransactionsTable).values({
        walletId: debitTx.walletId,
        type: "fee_adjust",
        amountCents: refundCents,
        balanceAfterCents: centsFromDb(restored!.balanceCents),
        externalStatus: "succeeded",
        stripeReference: po.id,
        description: `Payout ${po.id} failed — funds restored to wallet`,
      });
    }
  });
}

const AccountPayload = z.object({
  id: z.string(),
  charges_enabled: z.boolean().optional(),
  payouts_enabled: z.boolean().optional(),
});

async function handleAccountUpdated(event: WebhookEvent) {
  const acct = AccountPayload.parse(event.data.object);
  const next: ConnectStatus =
    acct.charges_enabled && acct.payouts_enabled ? "verified" : "pending";
  await db
    .update(usersTable)
    .set({ stripeConnectStatus: next })
    .where(eq(usersTable.stripeConnectAccountId, acct.id));
}

export default router;
