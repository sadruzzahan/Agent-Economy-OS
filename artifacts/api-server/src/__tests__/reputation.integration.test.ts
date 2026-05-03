import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, agentsTable, reputationHistoryTable, tasksTable, taskStatusLogTable, usersTable, walletsTable } from "@workspace/db";
import { recalculateAgentReputation } from "../lib/reputation";

const TEST_HANDLE_PREFIX = "__integ_test__";

async function cleanupTestTask(taskId: number) {
  await db.delete(taskStatusLogTable).where(eq(taskStatusLogTable.taskId, taskId));
  await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
}

async function cleanupTestAgent(agentId: number) {
  await db.delete(reputationHistoryTable).where(eq(reputationHistoryTable.agentId, agentId));
  await db.delete(taskStatusLogTable).where(eq(taskStatusLogTable.actorAgentId, agentId));
  await db.delete(walletsTable).where(eq(walletsTable.agentId, agentId));
  await db.delete(agentsTable).where(eq(agentsTable.id, agentId));
}

describe("recalculateAgentReputation (integration)", () => {
  let agentId: number;
  let ownerId: number;

  beforeEach(async () => {
    let [user] = await db
      .select()
      .from(usersTable)
      .limit(1);
    if (!user) {
      throw new Error("No users in DB — seed data required for integration tests");
    }
    ownerId = user.id;

    const handle = `${TEST_HANDLE_PREFIX}${Date.now()}`;
    const [agent] = await db
      .insert(agentsTable)
      .values({
        ownerUserId: ownerId,
        name: "Integration Test Agent",
        handle,
        status: "active",
        reputationScore: "0",
        apiKeyHash: `test_hash_${Date.now()}`,
        apiKeyPrefix: "test_",
      })
      .returning();
    agentId = agent!.id;
  });

  afterEach(async () => {
    if (agentId) await cleanupTestAgent(agentId);
  });

  it("persists score=0 and a history row for a brand-new agent", async () => {
    const result = await db.transaction(async (tx) => {
      return recalculateAgentReputation(tx, agentId);
    });

    expect(result.score).toBe(0);
    expect(result.breakdown.completionRate).toBe(0);
    expect(result.breakdown.avgRating).toBe(0);
    expect(result.breakdown.nonDisputeRate).toBe(0);
    expect(result.breakdown.volumeBonus).toBe(0);

    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    expect(Number(agent?.reputationScore)).toBe(0);

    const today = new Date().toISOString().slice(0, 10);
    const historyRows = await db
      .select()
      .from(reputationHistoryTable)
      .where(
        and(
          eq(reputationHistoryTable.agentId, agentId),
          eq(reputationHistoryTable.date, today),
        ),
      );
    expect(historyRows).toHaveLength(1);
    expect(Number(historyRows[0]?.score)).toBe(0);
  });

  it("upserts history row on repeated calls (no duplicate rows)", async () => {
    await db.transaction(async (tx) => recalculateAgentReputation(tx, agentId));
    await db.transaction(async (tx) => recalculateAgentReputation(tx, agentId));

    const today = new Date().toISOString().slice(0, 10);
    const historyRows = await db
      .select()
      .from(reputationHistoryTable)
      .where(
        and(
          eq(reputationHistoryTable.agentId, agentId),
          eq(reputationHistoryTable.date, today),
        ),
      );
    expect(historyRows).toHaveLength(1);
  });

  it("reflects correct score from Alpha Bot seed data (no mutation)", async () => {
    const [alphaBot] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.handle, "alpha-bot-rep1"));
    if (!alphaBot) {
      console.warn("Alpha Bot seed agent not found — skipping assertion");
      return;
    }
    const result = await db.transaction(async (tx) => {
      return recalculateAgentReputation(tx, alphaBot.id);
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number(alphaBot.reputationScore)).toBe(result.score);
  });
});

describe("cross-owner hire: task from user A can be assigned to user B's agent", () => {
  let userAId: number;
  let userBId: number;
  let externalAgentId: number;
  let testTaskId: number;

  beforeEach(async () => {
    const users = await db.select().from(usersTable).limit(2);
    if (users.length < 2) throw new Error("Need at least 2 seed users for cross-owner hire test");
    userAId = users[0]!.id;
    userBId = users[1]!.id;

    const handle = `${TEST_HANDLE_PREFIX}xowner_${Date.now()}`;
    const [extAgent] = await db
      .insert(agentsTable)
      .values({
        ownerUserId: userBId,
        name: "External Hire Agent",
        handle,
        status: "active",
        reputationScore: "0",
        apiKeyHash: `xowner_hash_${Date.now()}`,
        apiKeyPrefix: "xown_",
      })
      .returning();
    externalAgentId = extAgent!.id;

    const [task] = await db
      .insert(tasksTable)
      .values({
        postedByUserId: userAId,
        title: "Cross-Owner Hire Test Task",
        description: "Posted by user A, assigned to user B agent",
        paymentAmount: "5.00",
        status: "open",
      })
      .returning();
    testTaskId = task!.id;
  });

  afterEach(async () => {
    if (testTaskId) await cleanupTestTask(testTaskId);
    if (externalAgentId) {
      await db.delete(reputationHistoryTable).where(eq(reputationHistoryTable.agentId, externalAgentId));
      await db.delete(agentsTable).where(eq(agentsTable.id, externalAgentId));
    }
  });

  it("assigns task cross-owner and persists reputation history for the external agent", async () => {
    await db.transaction(async (tx) => {
      await tx
        .update(tasksTable)
        .set({ status: "assigned", assignedAgentId: externalAgentId })
        .where(eq(tasksTable.id, testTaskId));
      await recalculateAgentReputation(tx, externalAgentId);
    });

    const [updatedTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, testTaskId));
    expect(updatedTask?.status).toBe("assigned");
    expect(updatedTask?.assignedAgentId).toBe(externalAgentId);

    const [updatedAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, externalAgentId));
    expect(updatedAgent?.ownerUserId).toBe(userBId);

    const today = new Date().toISOString().slice(0, 10);
    const history = await db
      .select()
      .from(reputationHistoryTable)
      .where(
        and(
          eq(reputationHistoryTable.agentId, externalAgentId),
          eq(reputationHistoryTable.date, today),
        ),
      );
    expect(history).toHaveLength(1);
  });

  it("task poster (user A) and agent owner (user B) are distinct users", async () => {
    expect(userAId).not.toBe(userBId);

    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, testTaskId));
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, externalAgentId));

    expect(task?.postedByUserId).toBe(userAId);
    expect(agent?.ownerUserId).toBe(userBId);
    expect(task?.postedByUserId).not.toBe(agent?.ownerUserId);
  });
});
