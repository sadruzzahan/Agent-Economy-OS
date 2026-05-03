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

// Mirrors the exact guarded UPDATE in runtime.ts POST /runtime/tasks
async function atomicDebitWallet(
  walletId: number,
  amount: number,
): Promise<{ success: boolean; newBalance: string | null }> {
  const amountStr = amount.toFixed(2);
  const [row] = await db
    .update(walletsTable)
    .set({
      balance: sql`${walletsTable.balance} - ${amountStr}::numeric`,
      escrowed: sql`${walletsTable.escrowed} + ${amountStr}::numeric`,
    })
    .where(
      and(
        eq(walletsTable.id, walletId),
        sql`${walletsTable.balance} >= ${amountStr}::numeric`,
      ),
    )
    .returning({ id: walletsTable.id, balance: walletsTable.balance });
  return row
    ? { success: true, newBalance: String(row.balance) }
    : { success: false, newBalance: null };
}

describe("Runtime wallet spend-limit guard (atomic debit)", () => {
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
        balance: "50.00",
        escrowed: "0.00",
        totalEarned: "0.00",
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
    const result = await atomicDebitWallet(walletId, 20.00);
    expect(result.success).toBe(true);

    const [w] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
    expect(Number(w!.balance)).toBeCloseTo(30.00, 2);
    expect(Number(w!.escrowed)).toBeCloseTo(20.00, 2);
  });

  it("rejects a debit that exceeds the available balance", async () => {
    const result = await atomicDebitWallet(walletId, 75.00);
    expect(result.success).toBe(false);

    const [w] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
    expect(Number(w!.balance)).toBeCloseTo(50.00, 2);
    expect(Number(w!.escrowed)).toBeCloseTo(0.00, 2);
  });

  it("prevents double-spend: concurrent $40 debits against $50 balance — exactly one wins", async () => {
    const [r1, r2] = await Promise.all([
      atomicDebitWallet(walletId, 40.00),
      atomicDebitWallet(walletId, 40.00),
    ]);

    const successes = [r1, r2].filter((r) => r.success).length;
    expect(successes).toBe(1);

    const [w] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
    expect(Number(w!.balance)).toBeCloseTo(10.00, 2);
    expect(Number(w!.escrowed)).toBeCloseTo(40.00, 2);
  });

  it("allows sequential debits until balance is exhausted", async () => {
    const r1 = await atomicDebitWallet(walletId, 20.00);
    const r2 = await atomicDebitWallet(walletId, 20.00);
    const r3 = await atomicDebitWallet(walletId, 20.00); // would push to -10 — must reject

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r3.success).toBe(false);

    const [w] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
    expect(Number(w!.balance)).toBeCloseTo(10.00, 2);
    expect(Number(w!.escrowed)).toBeCloseTo(40.00, 2);
  });
});
