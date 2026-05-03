import { Router, type IRouter } from "express";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  tasksTable,
  taskCapabilitiesTable,
  taskStatusLogTable,
  taskCheckpointsTable,
  agentActivityLogTable,
  capabilitiesTable,
  walletsTable,
  walletTransactionsTable,
  agentsTable,
  usersTable,
} from "@workspace/db";
import { requireApiKeyAuth } from "../middlewares/apiKeyAuth";
import { recalculateAgentReputation } from "../lib/reputation";
import { n } from "../lib/serialize";
import { z } from "zod";

const router: IRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

async function logActivity(
  agentId: number,
  method: string,
  endpoint: string,
  status: number,
  ip?: string,
) {
  await db
    .insert(agentActivityLogTable)
    .values({ agentId, method, endpoint, responseStatus: status, ipAddress: ip ?? null })
    .catch(() => {});
}

function clientIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  return raw?.split(",")[0]?.trim() || req.ip;
}

async function buildRuntimeTaskDto(t: typeof tasksTable.$inferSelect) {
  const caps = await db
    .select({ capabilityId: capabilitiesTable.id, slug: capabilitiesTable.slug, name: capabilitiesTable.name })
    .from(taskCapabilitiesTable)
    .innerJoin(capabilitiesTable, eq(taskCapabilitiesTable.capabilityId, capabilitiesTable.id))
    .where(eq(taskCapabilitiesTable.taskId, t.id));

  const [latestCp] = await db
    .select()
    .from(taskCheckpointsTable)
    .where(eq(taskCheckpointsTable.taskId, t.id))
    .orderBy(desc(taskCheckpointsTable.createdAt))
    .limit(1);

  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    paymentAmount: n(t.paymentAmount),
    deadline: t.deadline ? t.deadline.toISOString() : null,
    inputData: (t.inputData as Record<string, unknown>) ?? {},
    outputSchema: (t.outputSchema as Record<string, unknown>) ?? {},
    successCriteria: (t.successCriteria as string[]) ?? [],
    capabilityRequirements: caps.map((c) => ({
      capabilityId: c.capabilityId,
      slug: c.slug,
      name: c.name,
      verified: false,
      verifiedScore: null,
    })),
    latestCheckpoint: latestCp
      ? {
          id: latestCp.id,
          state: latestCp.state,
          note: latestCp.note ?? null,
          createdAt: latestCp.createdAt.toISOString(),
          updatedAt: latestCp.updatedAt.toISOString(),
        }
      : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// ─── All runtime routes require API key auth ────────────────────────────────

router.use("/runtime", requireApiKeyAuth);

// ─── GET /runtime/tasks/assigned ────────────────────────────────────────────

router.get("/runtime/tasks/assigned", async (req, res): Promise<void> => {
  const agent = req.apiKeyAgent!;
  const ep = "GET /runtime/tasks/assigned";

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.assignedAgentId, agent.id), eq(tasksTable.status, "assigned")))
    .orderBy(desc(tasksTable.createdAt));

  const dtos = await Promise.all(tasks.map(buildRuntimeTaskDto));
  await logActivity(agent.id, "GET", ep, 200, clientIp(req));
  res.json(dtos);
});

// ─── POST /runtime/tasks/:taskId/accept ─────────────────────────────────────

const AcceptTaskParams = z.object({ taskId: z.coerce.number().int().positive() });

router.post("/runtime/tasks/:taskId/accept", async (req, res): Promise<void> => {
  const agent = req.apiKeyAgent!;
  const ep = "POST /runtime/tasks/:taskId/accept";
  const parsed = AcceptTaskParams.safeParse(req.params);
  if (!parsed.success) {
    await logActivity(agent.id, "POST", ep, 400, clientIp(req));
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  const { taskId } = parsed.data;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    await logActivity(agent.id, "POST", ep, 404, clientIp(req));
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (task.assignedAgentId !== agent.id) {
    await logActivity(agent.id, "POST", ep, 403, clientIp(req));
    res.status(403).json({ error: "Task is not assigned to your agent" });
    return;
  }
  if (task.status !== "assigned") {
    await logActivity(agent.id, "POST", ep, 400, clientIp(req));
    res.status(400).json({ error: `Task is in '${task.status}' state — only 'assigned' tasks can be accepted` });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.update(tasksTable).set({ status: "in_progress" }).where(eq(tasksTable.id, taskId));
    await tx.insert(taskStatusLogTable).values({
      taskId,
      status: "in_progress",
      actorAgentId: agent.id,
      note: "Accepted by agent via runtime API",
    });
    await recalculateAgentReputation(tx, agent.id);
  });

  const [updated] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  const dto = await buildRuntimeTaskDto(updated!);
  await logActivity(agent.id, "POST", ep, 200, clientIp(req));
  res.json(dto);
});

// ─── GET /runtime/tasks/:taskId/checkpoint ──────────────────────────────────

const CheckpointParams = z.object({ taskId: z.coerce.number().int().positive() });

router.get("/runtime/tasks/:taskId/checkpoint", async (req, res): Promise<void> => {
  const agent = req.apiKeyAgent!;
  const ep = "GET /runtime/tasks/:taskId/checkpoint";
  const parsed = CheckpointParams.safeParse(req.params);
  if (!parsed.success) {
    await logActivity(agent.id, "GET", ep, 400, clientIp(req));
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  const { taskId } = parsed.data;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task || task.assignedAgentId !== agent.id) {
    await logActivity(agent.id, "GET", ep, 404, clientIp(req));
    res.status(404).json({ error: "Task not found or not assigned to your agent" });
    return;
  }

  const [cp] = await db
    .select()
    .from(taskCheckpointsTable)
    .where(eq(taskCheckpointsTable.taskId, taskId))
    .orderBy(desc(taskCheckpointsTable.createdAt))
    .limit(1);

  await logActivity(agent.id, "GET", ep, 200, clientIp(req));
  if (!cp) {
    res.json(null);
    return;
  }
  res.json({
    id: cp.id,
    taskId: cp.taskId,
    agentId: cp.agentId,
    state: cp.state,
    note: cp.note ?? null,
    createdAt: cp.createdAt.toISOString(),
    updatedAt: cp.updatedAt.toISOString(),
  });
});

// ─── POST /runtime/tasks/:taskId/checkpoint ─────────────────────────────────

const SaveCheckpointBody = z.object({
  state: z.record(z.unknown()),
  note: z.string().max(500).optional(),
});

router.post("/runtime/tasks/:taskId/checkpoint", async (req, res): Promise<void> => {
  const agent = req.apiKeyAgent!;
  const ep = "POST /runtime/tasks/:taskId/checkpoint";
  const params = CheckpointParams.safeParse(req.params);
  const body = SaveCheckpointBody.safeParse(req.body);
  if (!params.success || !body.success) {
    await logActivity(agent.id, "POST", ep, 400, clientIp(req));
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { taskId } = params.data;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task || task.assignedAgentId !== agent.id) {
    await logActivity(agent.id, "POST", ep, 404, clientIp(req));
    res.status(404).json({ error: "Task not found or not assigned to your agent" });
    return;
  }
  if (!["in_progress", "assigned"].includes(task.status)) {
    await logActivity(agent.id, "POST", ep, 400, clientIp(req));
    res.status(400).json({ error: `Cannot save checkpoint for task in '${task.status}' state` });
    return;
  }

  const [cp] = await db
    .insert(taskCheckpointsTable)
    .values({
      taskId,
      agentId: agent.id,
      state: body.data.state,
      note: body.data.note ?? null,
    })
    .returning();

  await logActivity(agent.id, "POST", ep, 201, clientIp(req));
  res.status(201).json({
    id: cp!.id,
    taskId: cp!.taskId,
    agentId: cp!.agentId,
    state: cp!.state,
    note: cp!.note ?? null,
    createdAt: cp!.createdAt.toISOString(),
    updatedAt: cp!.updatedAt.toISOString(),
  });
});

// ─── POST /runtime/tasks/:taskId/submit ─────────────────────────────────────

const SubmitBody = z.object({
  result: z.record(z.unknown()),
  notes: z.string().max(2000).optional().nullable(),
});

router.post("/runtime/tasks/:taskId/submit", async (req, res): Promise<void> => {
  const agent = req.apiKeyAgent!;
  const ep = "POST /runtime/tasks/:taskId/submit";
  const params = CheckpointParams.safeParse(req.params);
  const body = SubmitBody.safeParse(req.body);
  if (!params.success || !body.success) {
    await logActivity(agent.id, "POST", ep, 400, clientIp(req));
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { taskId } = params.data;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task || task.assignedAgentId !== agent.id) {
    await logActivity(agent.id, "POST", ep, 404, clientIp(req));
    res.status(404).json({ error: "Task not found or not assigned to your agent" });
    return;
  }
  if (task.status !== "in_progress") {
    await logActivity(agent.id, "POST", ep, 400, clientIp(req));
    res.status(400).json({ error: `Task is in '${task.status}' state — only in_progress tasks can be submitted` });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(tasksTable)
      .set({ status: "submitted", result: body.data.result, resultNotes: body.data.notes ?? null })
      .where(eq(tasksTable.id, taskId));
    await tx.insert(taskStatusLogTable).values({
      taskId,
      status: "submitted",
      actorAgentId: agent.id,
      note: body.data.notes ?? "Result submitted via runtime API",
    });
    await recalculateAgentReputation(tx, agent.id);
  });

  const [updated] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  const dto = await buildRuntimeTaskDto(updated!);
  await logActivity(agent.id, "POST", ep, 200, clientIp(req));
  res.json(dto);
});

// ─── POST /runtime/tasks (post a sub-task) ──────────────────────────────────

const RuntimeCreateTaskBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  paymentAmount: z.number().min(0.01),
  inputData: z.record(z.unknown()).optional().default({}),
  outputSchema: z.record(z.unknown()).optional().default({}),
  successCriteria: z.array(z.string()).optional().default([]),
  capabilityIds: z.array(z.number().int().positive()).optional().default([]),
  deadline: z.string().datetime().optional().nullable(),
});

router.post("/runtime/tasks", async (req, res): Promise<void> => {
  const agent = req.apiKeyAgent!;
  const ep = "POST /runtime/tasks";
  const body = RuntimeCreateTaskBody.safeParse(req.body);
  if (!body.success) {
    await logActivity(agent.id, "POST", ep, 400, clientIp(req));
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Spend limit: agent wallet must have sufficient balance
  const [wallet] = await db
    .select()
    .from(walletsTable)
    .where(eq(walletsTable.agentId, agent.id));

  if (!wallet) {
    await logActivity(agent.id, "POST", ep, 400, clientIp(req));
    res.status(400).json({ error: "Agent has no wallet" });
    return;
  }

  // We need a user owner for the task — fetch before the transaction
  const [owner] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, agent.ownerUserId));

  if (!owner) {
    await logActivity(agent.id, "POST", ep, 500, clientIp(req));
    res.status(500).json({ error: "Agent owner not found" });
    return;
  }

  const amount = body.data.paymentAmount;

  // Atomic guarded debit — uses a WHERE balance >= amount guard to prevent
  // double-spend under concurrent requests (no optimistic locking needed).
  const [task, spendErr] = await db.transaction(async (tx): Promise<[typeof tasksTable.$inferSelect | null, string | null]> => {
    // Try to deduct atomically; if balance is insufficient the row won't update
    const [debited] = await tx
      .update(walletsTable)
      .set({
        balance: sql`${walletsTable.balance} - ${String(amount.toFixed(2))}::numeric`,
        escrowed: sql`${walletsTable.escrowed} + ${String(amount.toFixed(2))}::numeric`,
      })
      .where(
        and(
          eq(walletsTable.id, wallet.id),
          sql`${walletsTable.balance} >= ${String(amount.toFixed(2))}::numeric`,
        ),
      )
      .returning({ id: walletsTable.id, balance: walletsTable.balance });

    if (!debited) {
      return [null, "insufficient_balance"];
    }

    const [newTask] = await tx
      .insert(tasksTable)
      .values({
        postedByUserId: owner.id,
        title: body.data.title,
        description: body.data.description,
        paymentAmount: String(amount.toFixed(2)),
        inputData: body.data.inputData,
        outputSchema: body.data.outputSchema,
        successCriteria: body.data.successCriteria,
        status: "open",
        deadline: body.data.deadline ? new Date(body.data.deadline) : null,
      })
      .returning();

    await tx.insert(walletTransactionsTable).values({
      walletId: wallet.id,
      type: "escrow_lock",
      amount: String((-amount).toFixed(2)),
      balanceAfter: String(debited.balance),
      relatedTaskId: newTask!.id,
      description: `Escrow locked for sub-task: ${body.data.title}`,
    });

    if (body.data.capabilityIds.length > 0) {
      await tx.insert(taskCapabilitiesTable).values(
        body.data.capabilityIds.map((cid) => ({ taskId: newTask!.id, capabilityId: cid })),
      );
    }

    await tx.insert(taskStatusLogTable).values({
      taskId: newTask!.id,
      status: "open",
      actorAgentId: agent.id,
      note: `Sub-task posted by agent ${agent.name} via runtime API`,
    });

    return [newTask!, null];
  });

  if (spendErr === "insufficient_balance") {
    await logActivity(agent.id, "POST", ep, 402, clientIp(req));
    res.status(402).json({
      error: `Insufficient agent wallet balance. Required: $${amount.toFixed(2)}`,
    });
    return;
  }

  const dto = await buildRuntimeTaskDto(task!);
  await logActivity(agent.id, "POST", ep, 201, clientIp(req));
  res.status(201).json(dto);
});

// ─── GET /runtime/me ────────────────────────────────────────────────────────

router.get("/runtime/me", async (req, res): Promise<void> => {
  const agent = req.apiKeyAgent!;
  const ep = "GET /runtime/me";

  const [wallet] = await db
    .select()
    .from(walletsTable)
    .where(eq(walletsTable.agentId, agent.id));

  const assignedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasksTable)
    .where(and(eq(tasksTable.assignedAgentId, agent.id), eq(tasksTable.status, "assigned")));

  const inProgressCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasksTable)
    .where(and(eq(tasksTable.assignedAgentId, agent.id), eq(tasksTable.status, "in_progress")));

  await logActivity(agent.id, "GET", ep, 200, clientIp(req));
  res.json({
    id: agent.id,
    name: agent.name,
    handle: agent.handle,
    status: agent.status,
    reputationScore: n(agent.reputationScore),
    walletBalance: wallet ? n(wallet.balance) : 0,
    assignedTaskCount: assignedCount[0]?.count ?? 0,
    inProgressTaskCount: inProgressCount[0]?.count ?? 0,
    lastActiveAt: agent.lastActiveAt ? agent.lastActiveAt.toISOString() : null,
  });
});

export default router;
