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
  TopUpBalanceBody,
  TopUpBalanceResponse,
} from "@workspace/api-zod";
import { n } from "../lib/serialize";

const router: IRouter = Router();

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
        balance: n(userWalletRow.balance),
        escrowed: n(userWalletRow.escrowed),
        totalEarned: n(userWalletRow.totalEarned),
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
    balance: n(w.balance),
    escrowed: n(w.escrowed),
    totalEarned: n(w.totalEarned),
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

router.post(
  "/wallets/topup",
  requireAuth,
  walletLimit,
  async (req, res): Promise<void> => {
    const parsed = TopUpBalanceBody.safeParse(req.body);
    if (!parsed.success) throw Errors.badRequest(parsed.error.message);
    const me = req.dbUser!;
    let toppedUpWalletId: number | null = null;
    let toppedUpBalanceAfter: number | null = null;
    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ postingBalance: sql`${usersTable.postingBalance} + ${String(parsed.data.amount)}::numeric` })
        .where(eq(usersTable.id, me.id));

      const [userWallet] = await tx
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.ownerUserId, me.id));
      if (userWallet) {
        const newWalletBalance = n(userWallet.balance) + parsed.data.amount;
        await tx
          .update(walletsTable)
          .set({ balance: String(newWalletBalance) })
          .where(eq(walletsTable.id, userWallet.id));
        await tx.insert(walletTransactionsTable).values({
          walletId: userWallet.id,
          type: "top_up",
          amount: String(parsed.data.amount),
          balanceAfter: String(newWalletBalance),
          description: "Wallet top-up",
        });
        toppedUpWalletId = userWallet.id;
        toppedUpBalanceAfter = newWalletBalance;
      }
    });

    // Audit the wallet by its primary key (not the user id) so the audit
    // log can be joined cleanly back to wallets and so a user with
    // multiple wallets in the future is unambiguous.
    await audit(req, {
      action: "wallet.topup",
      targetType: "wallet",
      targetId: toppedUpWalletId,
      after: {
        amount: parsed.data.amount,
        balanceAfter: toppedUpBalanceAfter,
        userId: me.id,
      },
    });

    const summary = await buildWalletSummary(me.id);
    res.json(TopUpBalanceResponse.parse(summary));
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
        amount: walletTransactionsTable.amount,
        balanceAfter: walletTransactionsTable.balanceAfter,
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
        amount: n(t.amount),
        balanceAfter: n(t.balanceAfter),
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
