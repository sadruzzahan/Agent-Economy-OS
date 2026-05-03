import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  usersTable,
  walletsTable,
  walletTransactionsTable,
} from "@workspace/db";

const TEST_PREFIX = "__spend_limit_test__";

/**
 * Mirrors the exact guarded UPDATE in `routes/runtime.ts` POST
 * /runtime/tasks. Internally everything is integer cents now — the
 * guard predicate `balance_cents >= :amount_cents` is what gives us
 * the no-double-spend invariant under concurrent requests.
 */
async function atomicDebitWalletCents(
  walletId: number,
  amountCents: number,
): Promise<{ success: boolean; newBalanceCents: number | null }> {
  const amountStr = String(amountCents);
  const [row] = await db
    .update(walletsTable)
    .set({
      balanceCents: sql`${walletsTable.balanceCents} - ${amountStr}::bigint`,
      escrowedCents: sql`${walletsTable.escrowedCents} + ${amountStr}::bigint`,
    })
    .where(
      and(
        eq(walletsTable.id, walletId),
        sql`${walletsTable.balanceCents} >= ${amountStr}::bigint`,
      ),
    )
    .returning({
      id: walletsTable.id,
      balanceCents: walletsTable.balanceCents,
    });
  return row
    ? { success: true, newBalanceCents: Number(row.balanceCents) }
    : { success: false, newBalanceCents: null };
}

describe("Runtime wallet spend-limit guard (atomic debit, integer cents)", () => {
  let agentId: number;
  let walletId: number;

  beforeEach(async () => {
    const [user] = await db.select().from(usersTable).limit(1);
    if (!user) throw new Error("Seed a user before running integration tests");

    const handle = `${TEST_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const [agent] = await db
      .insert(agentsTable)
      .values({
        ownerUserId: user.id,
        name: "Spend Limit Test Agent",
        handle,
        status: "active",
        reputationScore: "0",
        apiKeyHash: `slt_hash_${handle}`,
        apiKeyPrefix: "slt_",
      })
      .returning();
    agentId = agent!.id;

    const [wallet] = await db
      .insert(walletsTable)
      .values({
        kind: "agent",
        agentId,
        balanceCents: 5000, // $50.00
        escrowedCents: 0,
        totalEarnedCents: 0,
      })
      .returning();
    walletId = wallet!.id;
  });

  afterEach(async () => {
    await db.delete(walletTransactionsTable).where(eq(walletTransactionsTable.walletId, walletId)).catch(() => {});
    await db.delete(walletsTable).where(eq(walletsTable.id, walletId)).catch(() => {});
    await db.delete(agentsTable).where(eq(agentsTable.id, agentId)).catch(() => {});
  });

  it("allows a single debit within available balance", async () => {
    const result = await atomicDebitWalletCents(walletId, 2000); // $20.00
    expect(result.success).toBe(true);

    const [w] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
    expect(Number(w!.balanceCents)).toBe(3000);
    expect(Number(w!.escrowedCents)).toBe(2000);
  });

  it("rejects a debit that exceeds the available balance", async () => {
    const result = await atomicDebitWalletCents(walletId, 7500); // $75.00
    expect(result.success).toBe(false);

    const [w] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
    expect(Number(w!.balanceCents)).toBe(5000);
    expect(Number(w!.escrowedCents)).toBe(0);
  });

  it("prevents double-spend: concurrent $40 debits against $50 — exactly one wins", async () => {
    const [r1, r2] = await Promise.all([
      atomicDebitWalletCents(walletId, 4000),
      atomicDebitWalletCents(walletId, 4000),
    ]);

    const successes = [r1, r2].filter((r) => r.success).length;
    expect(successes).toBe(1);

    const [w] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
    expect(Number(w!.balanceCents)).toBe(1000);
    expect(Number(w!.escrowedCents)).toBe(4000);
  });

  it("allows sequential debits until balance is exhausted", async () => {
    const r1 = await atomicDebitWalletCents(walletId, 2000);
    const r2 = await atomicDebitWalletCents(walletId, 2000);
    const r3 = await atomicDebitWalletCents(walletId, 2000); // would push to -1000c — must reject

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r3.success).toBe(false);

    const [w] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
    expect(Number(w!.balanceCents)).toBe(1000);
    expect(Number(w!.escrowedCents)).toBe(4000);
  });
});
