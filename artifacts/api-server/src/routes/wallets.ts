import { Router, type IRouter } from "express";
import { eq, desc, inArray, or, sql } from "drizzle-orm";
import {
  db,
  walletsTable,
  walletTransactionsTable,
  agentsTable,
  usersTable,
  tasksTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { audit } from "../lib/audit";
import { walletLimit, userBaselineLimit } from "../middlewares/rateLimits";
import { Errors } from "../lib/errors";
import {
  ListMyWalletsResponse,
  ListWalletTransactionsQueryParams,
  ListWalletTransactionsResponse,
  CreateCheckoutSessionBody,
  CreateCheckoutSessionResponse,
  RequestPayoutBody,
  RequestPayoutResponse,
} from "@workspace/api-zod";
import {
  centsFromDb,
  centsToDollars,
  dollarsToCents,
  formatCents,
} from "../lib/money";
import { stripeClient } from "../lib/stripe";
import { getAppBaseUrl } from "../lib/env";
import { processStripeEvent } from "./stripe";
import crypto from "node:crypto";

const router: IRouter = Router();

/**
 * Build the wallet summary for a user. Internally everything is integer
 * cents; the API surface still emits decimal dollars (number) for
 * back-compat with the existing UI and OpenAPI consumers.
 */
async function buildWalletSummary(userId: number) {
  const [userWalletRow] = await db
    .select()
    .from(walletsTable)
    .where(eq(walletsTable.ownerUserId, userId));

  const myAgents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.ownerUserId, userId));
  const agentIds = myAgents.map((a) => a.id);

  const agentWalletsRaw =
    agentIds.length > 0
      ? await db
          .select()
          .from(walletsTable)
          .where(inArray(walletsTable.agentId, agentIds))
      : [];

  const agentNames = new Map(myAgents.map((a) => [a.id, a.name]));

  const userWallet = userWalletRow
    ? {
        id: userWalletRow.id,
        kind: "user" as const,
        ownerUserId: userId,
        agentId: null,
        agentName: null,
        balance: centsToDollars(centsFromDb(userWalletRow.balanceCents)),
        escrowed: centsToDollars(centsFromDb(userWalletRow.escrowedCents)),
        totalEarned: centsToDollars(
          centsFromDb(userWalletRow.totalEarnedCents),
        ),
      }
    : {
        id: 0,
        kind: "user" as const,
        ownerUserId: userId,
        agentId: null,
        agentName: null,
        balance: 0,
        escrowed: 0,
        totalEarned: 0,
      };

  const agentWallets = agentWalletsRaw.map((w) => ({
    id: w.id,
    kind: "agent" as const,
    ownerUserId: null,
    agentId: w.agentId,
    agentName: w.agentId ? agentNames.get(w.agentId) ?? null : null,
    balance: centsToDollars(centsFromDb(w.balanceCents)),
    escrowed: centsToDollars(centsFromDb(w.escrowedCents)),
    totalEarned: centsToDollars(centsFromDb(w.totalEarnedCents)),
  }));

  const totalBalance =
    userWallet.balance + agentWallets.reduce((s, w) => s + w.balance, 0);
  const totalEscrowed =
    userWallet.escrowed + agentWallets.reduce((s, w) => s + w.escrowed, 0);

  return {
    userWallet,
    agentWallets,
    totalBalance,
    totalEscrowed,
  };
}

router.get(
  "/wallets",
  requireAuth,
  userBaselineLimit,
  async (req, res): Promise<void> => {
    const me = req.dbUser!;
    const summary = await buildWalletSummary(me.id);
    res.json(ListMyWalletsResponse.parse(summary));
  },
);

/**
 * POST /wallets/checkout — Replaces the old "topup" endpoint.
 *
 * Returns a Stripe Checkout URL the client must redirect to. The
 * actual wallet credit happens asynchronously via the
 * `checkout.session.completed` webhook (see `routes/stripe.ts`),
 * NEVER here — that's the only way to make the credit idempotent
 * against retries and concurrent submissions.
 *
 * In stub mode the returned URL points back at the success page so
 * end-to-end tests can complete without a real Stripe round-trip.
 */
router.post(
  "/wallets/checkout",
  requireAuth,
  walletLimit,
  async (req, res): Promise<void> => {
    const parsed = CreateCheckoutSessionBody.safeParse(req.body);
    if (!parsed.success) throw Errors.badRequest(parsed.error.message);
    const me = req.dbUser!;

    const amountCents = dollarsToCents(parsed.data.amount);
    if (amountCents < 100) {
      throw Errors.badRequest("Minimum deposit is $1.00");
    }

    // Lazily provision a Stripe Customer the first time a user pays in.
    const customer = await stripeClient.createOrRetrieveCustomer({
      existingId: me.stripeCustomerId,
      email: me.email,
      userId: me.id,
    });
    if (!me.stripeCustomerId) {
      await db
        .update(usersTable)
        .set({ stripeCustomerId: customer.id })
        .where(eq(usersTable.id, me.id));
    }

    const baseUrl = getAppBaseUrl();
    // The success/cancel URLs include the artifact base path so the
    // proxied preview pane resolves them correctly.
    const session = await stripeClient.createCheckoutSession({
      userId: me.id,
      customerId: customer.id,
      customerEmail: me.email,
      amountCents,
      successUrl: `${baseUrl}/wallet/success`,
      cancelUrl: `${baseUrl}/wallet/cancel`,
      metadata: {
        userId: String(me.id),
        purpose: "wallet_topup",
      },
    });

    // Pre-record the pending top-up so the wallet page can show a
    // "processing" entry between redirect and webhook arrival. The
    // webhook will look this row up by stripe_reference and flip it to
    // succeeded.
    const [userWallet] = await db
      .select()
      .from(walletsTable)
      .where(eq(walletsTable.ownerUserId, me.id));
    if (userWallet) {
      await db.insert(walletTransactionsTable).values({
        walletId: userWallet.id,
        type: "top_up",
        amountCents,
        balanceAfterCents: centsFromDb(userWallet.balanceCents),
        externalStatus: "pending",
        stripeReference: session.id,
        description: `Stripe Checkout pending: ${formatCents(amountCents)}`,
      });
    }

    await audit(req, {
      action: "wallet.checkout_create",
      targetType: "wallet",
      targetId: userWallet?.id ?? null,
      after: {
        sessionId: session.id,
        amountCents,
        stub: stripeClient.isStub,
      },
    });

    // Stub-mode auto-settle: we own both sides of the stub Stripe so
    // we synthesize and dispatch the `checkout.session.completed`
    // event right now. This makes top-ups end-to-end functional in
    // dev/test without hand-rolling a webhook curl. In live mode
    // Stripe sends the real event after the user's card is charged.
    if (stripeClient.isStub) {
      try {
        await processStripeEvent({
          id: `evt_stub_${crypto.randomBytes(8).toString("hex")}`,
          type: "checkout.session.completed",
          data: {
            object: {
              id: session.id,
              amount_total: amountCents,
              metadata: {
                userId: String(me.id),
                purpose: "wallet_topup",
              },
            },
          },
        });
      } catch (err) {
        // Don't fail the redirect on stub-settle errors — the
        // pending row is still on the books and a manual webhook can
        // retry. Just log loudly.
        // eslint-disable-next-line no-console
        console.error("[stub-settle] failed to auto-credit checkout", err);
      }
    }

    res.json(
      CreateCheckoutSessionResponse.parse({
        sessionId: session.id,
        url: session.url,
        stub: stripeClient.isStub,
      }),
    );
  },
);

/**
 * POST /wallets/payout — owner cash-out from an agent wallet to their
 * connected Stripe account. We never let payouts dip into pending
 * funds — those are still moving through Stripe's settlement window
 * and could get clawed back.
 */
router.post(
  "/wallets/payout",
  requireAuth,
  walletLimit,
  async (req, res): Promise<void> => {
    const parsed = RequestPayoutBody.safeParse(req.body);
    if (!parsed.success) throw Errors.badRequest(parsed.error.message);
    const me = req.dbUser!;

    if (
      !me.stripeConnectAccountId ||
      me.stripeConnectStatus !== "verified"
    ) {
      throw Errors.badRequest(
        "Stripe Connect account is not verified — complete onboarding first",
      );
    }

    const amountCents = dollarsToCents(parsed.data.amount);
    if (amountCents < 100) {
      throw Errors.badRequest("Minimum payout is $1.00");
    }

    // The wallet must belong to one of the user's agents AND have
    // enough liquid (non-pending) balance.
    const [wallet] = await db
      .select({
        wallet: walletsTable,
        agent: agentsTable,
      })
      .from(walletsTable)
      .innerJoin(agentsTable, eq(walletsTable.agentId, agentsTable.id))
      .where(eq(walletsTable.id, parsed.data.walletId));
    if (!wallet || wallet.agent.ownerUserId !== me.id) {
      throw Errors.forbidden("Wallet not owned by user");
    }
    const liquidCents =
      centsFromDb(wallet.wallet.balanceCents) -
      centsFromDb(wallet.wallet.pendingCents);
    if (liquidCents < amountCents) {
      throw Errors.badRequest(
        `Insufficient liquid balance (have ${formatCents(liquidCents)}, need ${formatCents(amountCents)})`,
      );
    }

    // ── DEBIT FIRST ────────────────────────────────────────────────
    // The hard rule: never call Stripe before the ledger has agreed
    // to part with the money. Otherwise a debit failure (race or DB
    // outage) after a successful Stripe call leaves us short. The
    // guarded UPDATE serializes concurrent payout requests on the
    // same wallet via Postgres row locks.
    const amountCentsStr = String(amountCents);
    const [debited] = await db
      .update(walletsTable)
      .set({
        balanceCents: sql`${walletsTable.balanceCents} - ${amountCentsStr}::bigint`,
      })
      .where(
        sql`${walletsTable.id} = ${wallet.wallet.id} AND (${walletsTable.balanceCents} - ${walletsTable.pendingCents}) >= ${amountCentsStr}::bigint`,
      )
      .returning({
        id: walletsTable.id,
        balanceCents: walletsTable.balanceCents,
      });
    if (!debited) {
      throw Errors.conflict("Concurrent payout drained the wallet");
    }

    // ── THEN call Stripe with a compensation on failure ───────────
    let payout: Awaited<ReturnType<typeof stripeClient.createPayout>>;
    try {
      payout = await stripeClient.createPayout({
        destinationAccountId: me.stripeConnectAccountId,
        amountCents,
        metadata: {
          userId: String(me.id),
          walletId: String(wallet.wallet.id),
        },
      });
    } catch (err) {
      // Compensate: restore the balance we just took. We do NOT
      // record a `fee_adjust` row here because the only ledger row
      // that ever existed (the debit) was never actually written —
      // we're cleanly reversing the bare UPDATE.
      await db
        .update(walletsTable)
        .set({
          balanceCents: sql`${walletsTable.balanceCents} + ${amountCentsStr}::bigint`,
        })
        .where(eq(walletsTable.id, wallet.wallet.id));
      throw err;
    }

    await db.insert(walletTransactionsTable).values({
      walletId: wallet.wallet.id,
      type: "payout",
      amountCents: -amountCents,
      balanceAfterCents: centsFromDb(debited.balanceCents),
      externalStatus: payout.status === "paid" ? "succeeded" : "pending",
      stripeReference: payout.id,
      description: `Payout to bank: ${formatCents(amountCents)}`,
    });

    await audit(req, {
      action: "wallet.payout_request",
      targetType: "wallet",
      targetId: wallet.wallet.id,
      after: {
        payoutId: payout.id,
        amountCents,
        stub: stripeClient.isStub,
      },
    });

    res.json(
      RequestPayoutResponse.parse({
        payoutId: payout.id,
        status: payout.status,
        amount: centsToDollars(amountCents),
        stub: stripeClient.isStub,
      }),
    );
  },
);

router.get(
  "/wallets/transactions",
  requireAuth,
  userBaselineLimit,
  async (req, res): Promise<void> => {
    const parsed = ListWalletTransactionsQueryParams.safeParse(req.query);
    if (!parsed.success) throw Errors.badRequest(parsed.error.message);
    const me = req.dbUser!;
    const myAgents = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.ownerUserId, me.id));
    const agentIds = myAgents.map((a) => a.id);

    const myWallets = await db
      .select()
      .from(walletsTable)
      .where(
        agentIds.length > 0
          ? or(
              eq(walletsTable.ownerUserId, me.id),
              inArray(walletsTable.agentId, agentIds),
            )
          : eq(walletsTable.ownerUserId, me.id),
      );
    const walletIds = myWallets.map((w) => w.id);
    if (walletIds.length === 0) {
      res.json([]);
      return;
    }
    const walletKindMap = new Map(
      myWallets.map((w) => [w.id, { kind: w.kind, agentId: w.agentId }]),
    );
    const agentNameRows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.ownerUserId, me.id));
    const agentNames = new Map(agentNameRows.map((a) => [a.id, a.name]));

    let filterIds: number[];
    if (parsed.data.walletId !== undefined) {
      if (!walletIds.includes(parsed.data.walletId)) {
        throw Errors.forbidden("Forbidden: wallet not owned by user");
      }
      filterIds = [parsed.data.walletId];
    } else {
      filterIds = walletIds;
    }

    const txns = await db
      .select({
        id: walletTransactionsTable.id,
        walletId: walletTransactionsTable.walletId,
        type: walletTransactionsTable.type,
        amountCents: walletTransactionsTable.amountCents,
        balanceAfterCents: walletTransactionsTable.balanceAfterCents,
        externalStatus: walletTransactionsTable.externalStatus,
        relatedTaskId: walletTransactionsTable.relatedTaskId,
        description: walletTransactionsTable.description,
        createdAt: walletTransactionsTable.createdAt,
        relatedTaskTitle: tasksTable.title,
      })
      .from(walletTransactionsTable)
      .leftJoin(
        tasksTable,
        eq(walletTransactionsTable.relatedTaskId, tasksTable.id),
      )
      .where(inArray(walletTransactionsTable.walletId, filterIds))
      .orderBy(desc(walletTransactionsTable.createdAt));

    const dto = txns.map((t) => {
      const wInfo = walletKindMap.get(t.walletId);
      return {
        id: t.id,
        walletId: t.walletId,
        kind: wInfo?.kind ?? "user",
        agentName: wInfo?.agentId
          ? agentNames.get(wInfo.agentId) ?? null
          : null,
        type: t.type,
        amount: centsToDollars(centsFromDb(t.amountCents)),
        balanceAfter: centsToDollars(centsFromDb(t.balanceAfterCents)),
        externalStatus: t.externalStatus,
        relatedTaskId: t.relatedTaskId,
        relatedTaskTitle: t.relatedTaskTitle,
        description: t.description,
        createdAt: t.createdAt.toISOString(),
      };
    });

    res.json(ListWalletTransactionsResponse.parse(dto));
  },
);

export default router;
