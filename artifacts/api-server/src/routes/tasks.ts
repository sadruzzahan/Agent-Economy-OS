import { Router, type IRouter } from "express";
import { Errors } from "../lib/errors";
import { and, eq, inArray, ilike, sql, desc, gte, lte, or } from "drizzle-orm";
import {
  db,
  tasksTable,
  taskCapabilitiesTable,
  taskStatusLogTable,
  taskCheckpointsTable,
  capabilitiesTable,
  agentsTable,
  walletsTable,
  walletTransactionsTable,
  reviewsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, getOrCreateDbUser } from "../lib/auth";
import { recalculateAgentReputation } from "../lib/reputation";
import { getAuth } from "@clerk/express";
import { audit } from "../lib/audit";
import {
  taskActionLimit,
  walletLimit,
} from "../middlewares/rateLimits";
import {
  CreateTaskBody,
  GetTaskParams,
  GetTaskResponse,
  ListTasksQueryParams,
  ListTasksResponse,
  AssignTaskBody,
  AssignTaskParams,
  AssignTaskResponse,
  StartTaskParams,
  StartTaskResponse,
  SubmitTaskResultBody,
  SubmitTaskResultParams,
  SubmitTaskResultResponse,
  VerifyTaskBody,
  VerifyTaskParams,
  VerifyTaskResponse,
  DisputeTaskBody,
  DisputeTaskParams,
  DisputeTaskResponse,
  ResolveDisputeBody,
  ResolveDisputeParams,
  ResolveDisputeResponse,
} from "@workspace/api-zod";
import { n } from "../lib/serialize";

const router: IRouter = Router();

async function buildTaskSummary(t: typeof tasksTable.$inferSelect) {
  const [poster] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, t.postedByUserId));
  let assignedAgentName: string | null = null;
  if (t.assignedAgentId) {
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, t.assignedAgentId));
    assignedAgentName = agent?.name ?? null;
  }
  const caps = await db
    .select({
      capabilityId: capabilitiesTable.id,
      slug: capabilitiesTable.slug,
      name: capabilitiesTable.name,
    })
    .from(taskCapabilitiesTable)
    .innerJoin(
      capabilitiesTable,
      eq(taskCapabilitiesTable.capabilityId, capabilitiesTable.id),
    )
    .where(eq(taskCapabilitiesTable.taskId, t.id));
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    paymentAmount: n(t.paymentAmount),
    deadline: t.deadline ? t.deadline.toISOString() : null,
    postedByUserId: t.postedByUserId,
    postedByDisplayName: poster?.displayName ?? null,
    assignedAgentId: t.assignedAgentId,
    assignedAgentName,
    capabilityRequirements: caps.map((c) => ({
      capabilityId: c.capabilityId,
      slug: c.slug,
      name: c.name,
      verified: false,
      verifiedScore: null,
    })),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

async function buildTaskDetail(t: typeof tasksTable.$inferSelect) {
  const summary = await buildTaskSummary(t);
  const log = await db
    .select({
      id: taskStatusLogTable.id,
      status: taskStatusLogTable.status,
      note: taskStatusLogTable.note,
      createdAt: taskStatusLogTable.createdAt,
      actorUserName: usersTable.displayName,
      actorAgentName: agentsTable.name,
    })
    .from(taskStatusLogTable)
    .leftJoin(usersTable, eq(taskStatusLogTable.actorUserId, usersTable.id))
    .leftJoin(agentsTable, eq(taskStatusLogTable.actorAgentId, agentsTable.id))
    .where(eq(taskStatusLogTable.taskId, t.id))
    .orderBy(taskStatusLogTable.createdAt);
  return {
    ...summary,
    inputData: (t.inputData as Record<string, unknown>) ?? {},
    outputSchema: (t.outputSchema as Record<string, unknown>) ?? {},
    successCriteria: (t.successCriteria as string[]) ?? [],
    result: t.result ?? null,
    resultNotes: t.resultNotes,
    disputeReason: t.disputeReason,
    statusLog: log.map((l) => ({
      id: l.id,
      status: l.status,
      note: l.note,
      actorDisplayName: l.actorAgentName ?? l.actorUserName ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

router.get("/tasks", async (req, res): Promise<void> => {
  const parsed = ListTasksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.message);
  }
  const {
    status,
    capabilityId,
    postedByMe,
    assignedToMyAgents,
    minPayment,
    maxPayment,
    search,
    deadlineBefore,
  } = parsed.data;

  const conditions = [];
  if (status) conditions.push(eq(tasksTable.status, status));
  if (typeof minPayment === "number")
    conditions.push(gte(tasksTable.paymentAmount, String(minPayment)));
  if (typeof maxPayment === "number")
    conditions.push(lte(tasksTable.paymentAmount, String(maxPayment)));
  if (deadlineBefore) {
    const d = new Date(deadlineBefore);
    if (!isNaN(d.getTime()))
      conditions.push(lte(tasksTable.deadline, d));
  }
  if (search)
    conditions.push(
      or(
        ilike(tasksTable.title, `%${search}%`),
        ilike(tasksTable.description, `%${search}%`),
      )!,
    );
  if (postedByMe || assignedToMyAgents) {
    const auth = getAuth(req);
    if (!auth?.userId) {
      throw Errors.unauthorized("Unauthorized");
    }
    const me = await getOrCreateDbUser(auth.userId);
    if (postedByMe) conditions.push(eq(tasksTable.postedByUserId, me.id));
    if (assignedToMyAgents) {
      const myAgents = await db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(eq(agentsTable.ownerUserId, me.id));
      const ids = myAgents.map((a) => a.id);
      if (ids.length === 0) {
        res.json([]);
        return;
      }
      conditions.push(inArray(tasksTable.assignedAgentId, ids));
    }
  }
  if (typeof capabilityId === "number") {
    const matchingTaskIds = await db
      .select({ id: taskCapabilitiesTable.taskId })
      .from(taskCapabilitiesTable)
      .where(eq(taskCapabilitiesTable.capabilityId, capabilityId));
    const ids = matchingTaskIds.map((r) => r.id);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    conditions.push(inArray(tasksTable.id, ids));
  }
  const rows = await db
    .select()
    .from(tasksTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(tasksTable.createdAt));
  const dtos = await Promise.all(rows.map((r) => buildTaskSummary(r)));
  res.json(ListTasksResponse.parse(dtos));
});

router.post("/tasks", requireAuth, walletLimit, async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.message);
  }
  const me = req.dbUser!;
  const {
    title,
    description,
    inputData,
    outputSchema,
    successCriteria,
    paymentAmount,
    deadline,
    capabilityIds,
  } = parsed.data;

  if (n(me.postingBalance) < paymentAmount) {
    throw Errors.badRequest("Insufficient posting balance");
  }

  const task = await db.transaction(async (tx) => {
    const [createdTask] = await tx
      .insert(tasksTable)
      .values({
        postedByUserId: me.id,
        title,
        description,
        inputData,
        outputSchema,
        successCriteria,
        paymentAmount: String(paymentAmount),
        deadline: deadline ? new Date(deadline) : null,
      })
      .returning();
    if (!createdTask) {
      throw new Error("Failed to create task");
    }

    await tx
      .update(usersTable)
      .set({ postingBalance: sql`${usersTable.postingBalance} - ${String(paymentAmount)}::numeric` })
      .where(eq(usersTable.id, me.id));

    const [userWallet] = await tx
      .select()
      .from(walletsTable)
      .where(eq(walletsTable.ownerUserId, me.id));
    if (userWallet) {
      const newBalance = n(userWallet.balance) - paymentAmount;
      const newEscrow = n(userWallet.escrowed) + paymentAmount;
      await tx
        .update(walletsTable)
        .set({ balance: String(newBalance), escrowed: String(newEscrow) })
        .where(eq(walletsTable.id, userWallet.id));
      await tx.insert(walletTransactionsTable).values({
        walletId: userWallet.id,
        type: "escrow_lock",
        amount: String(paymentAmount),
        balanceAfter: String(newBalance),
        relatedTaskId: createdTask.id,
        description: `Escrow for task: ${title}`,
      });
    }

    if (capabilityIds.length > 0) {
      await tx
        .insert(taskCapabilitiesTable)
        .values(
          capabilityIds.map((capabilityId) => ({
            taskId: createdTask.id,
            capabilityId,
          })),
        );
    }

    await tx.insert(taskStatusLogTable).values({
      taskId: createdTask.id,
      status: "open",
      actorUserId: me.id,
      note: "Task posted to market",
    });

    return createdTask;
  });

  const dto = await buildTaskSummary(task);
  await audit(req, {
    action: "task.create",
    targetType: "task",
    targetId: task.id,
    after: { title, paymentAmount, capabilityIds },
  });
  res.status(201).json(dto);
});

router.get("/tasks/:taskId", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    throw Errors.badRequest(params.error.message);
  }
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, params.data.taskId));
  if (!task) {
    throw Errors.notFound("Task not found");
  }
  const dto = await buildTaskDetail(task);
  res.json(GetTaskResponse.parse(dto));
});

router.post(
  "/tasks/:taskId/assign",
  requireAuth,
  taskActionLimit,
  async (req, res): Promise<void> => {
    const params = AssignTaskParams.safeParse(req.params);
    const body = AssignTaskBody.safeParse(req.body);
    if (!params.success || !body.success) {
      throw Errors.badRequest("Invalid request");
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task) {
      throw Errors.notFound("Task not found");
    }
    if (task.status !== "open") {
      throw Errors.badRequest("Task is not open");
    }
    if (task.postedByUserId !== me.id) {
      throw Errors.unauthorized("Only the task poster can assign an agent");
    }
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, body.data.agentId));
    if (!agent || agent.status !== "active") {
      throw Errors.badRequest("Agent not found or not active");
    }
    await db.transaction(async (tx) => {
      await tx
        .update(tasksTable)
        .set({ status: "assigned", assignedAgentId: agent.id })
        .where(eq(tasksTable.id, task.id));
      await tx.insert(taskStatusLogTable).values({
        taskId: task.id,
        status: "assigned",
        actorAgentId: agent.id,
        actorUserId: me.id,
        note: `Assigned to ${agent.name}`,
      });
      await recalculateAgentReputation(tx, agent.id);
    });
    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    await audit(req, {
      action: "task.assign",
      targetType: "task",
      targetId: task.id,
      before: { status: task.status, assignedAgentId: task.assignedAgentId },
      after: { status: "assigned", assignedAgentId: agent.id },
    });
    const dto = await buildTaskSummary(updated!);
    res.json(AssignTaskResponse.parse(dto));
  },
);

router.post(
  "/tasks/:taskId/start",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = StartTaskParams.safeParse(req.params);
    if (!params.success) {
      throw Errors.badRequest(params.error.message);
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task) {
      throw Errors.notFound("Task not found");
    }
    if (task.status !== "assigned" || !task.assignedAgentId) {
      throw Errors.badRequest("Task not in assigned state");
    }
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, task.assignedAgentId));
    if (!agent || agent.ownerUserId !== me.id) {
      throw Errors.unauthorized("Not your agent");
    }
    await db.transaction(async (tx) => {
      await tx
        .update(tasksTable)
        .set({ status: "in_progress" })
        .where(eq(tasksTable.id, task.id));
      await tx.insert(taskStatusLogTable).values({
        taskId: task.id,
        status: "in_progress",
        actorAgentId: agent.id,
        actorUserId: me.id,
      });
      await recalculateAgentReputation(tx, agent.id);
    });
    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    await audit(req, {
      action: "task.start",
      targetType: "task",
      targetId: task.id,
      before: { status: task.status },
      after: { status: "in_progress", agentId: agent.id },
    });
    res.json(StartTaskResponse.parse(await buildTaskSummary(updated!)));
  },
);

router.post(
  "/tasks/:taskId/submit",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = SubmitTaskResultParams.safeParse(req.params);
    const body = SubmitTaskResultBody.safeParse(req.body);
    if (!params.success || !body.success) {
      throw Errors.badRequest("Invalid request");
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task || !task.assignedAgentId) {
      throw Errors.notFound("Task not found");
    }
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, task.assignedAgentId));
    if (!agent || agent.ownerUserId !== me.id) {
      throw Errors.unauthorized("Not your agent");
    }
    if (task.status !== "in_progress" && task.status !== "assigned") {
      throw Errors.badRequest("Task not in submittable state");
    }
    await db.transaction(async (tx) => {
      await tx
        .update(tasksTable)
        .set({
          status: "submitted",
          result: body.data.result,
          resultNotes: body.data.notes ?? null,
        })
        .where(eq(tasksTable.id, task.id));
      await tx.insert(taskStatusLogTable).values({
        taskId: task.id,
        status: "submitted",
        actorAgentId: agent.id,
        actorUserId: me.id,
        note: body.data.notes ?? null,
      });
      await recalculateAgentReputation(tx, agent.id);
    });
    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    await audit(req, {
      action: "task.submit",
      targetType: "task",
      targetId: task.id,
      before: { status: task.status },
      after: { status: "submitted", agentId: agent.id },
    });
    res.json(SubmitTaskResultResponse.parse(await buildTaskSummary(updated!)));
  },
);

router.post(
  "/tasks/:taskId/verify",
  requireAuth,
  taskActionLimit,
  async (req, res): Promise<void> => {
    const params = VerifyTaskParams.safeParse(req.params);
    const body = VerifyTaskBody.safeParse(req.body);
    if (!params.success || !body.success) {
      throw Errors.badRequest("Invalid request");
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task || !task.assignedAgentId) {
      throw Errors.notFound("Task not found");
    }
    if (task.postedByUserId !== me.id) {
      throw Errors.unauthorized("Not your task");
    }
    if (task.status !== "submitted") {
      throw Errors.badRequest("Task not in submitted state");
    }
    const payment = n(task.paymentAmount);
    const assignedAgentId = task.assignedAgentId;

    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(tasksTable)
        .set({ status: "complete" })
        .where(and(eq(tasksTable.id, task.id), eq(tasksTable.status, "submitted")))
        .returning({ id: tasksTable.id });
      if (!claimed) {
        throw new Error("Task was already processed by a concurrent request");
      }

      const [userWallet] = await tx
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.ownerUserId, me.id));
      if (userWallet) {
        const newEscrow = Math.max(0, n(userWallet.escrowed) - payment);
        await tx
          .update(walletsTable)
          .set({ escrowed: String(newEscrow) })
          .where(eq(walletsTable.id, userWallet.id));
        await tx.insert(walletTransactionsTable).values({
          walletId: userWallet.id,
          type: "escrow_release",
          amount: String(payment),
          balanceAfter: String(n(userWallet.balance)),
          relatedTaskId: task.id,
          description: `Released escrow for task: ${task.title}`,
        });
      }

      const [agentWallet] = await tx
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.agentId, assignedAgentId));
      if (agentWallet) {
        const newBalance = n(agentWallet.balance) + payment;
        const newEarned = n(agentWallet.totalEarned) + payment;
        await tx
          .update(walletsTable)
          .set({
            balance: String(newBalance),
            totalEarned: String(newEarned),
          })
          .where(eq(walletsTable.id, agentWallet.id));
        await tx.insert(walletTransactionsTable).values({
          walletId: agentWallet.id,
          type: "credit",
          amount: String(payment),
          balanceAfter: String(newBalance),
          relatedTaskId: task.id,
          description: `Payment received for task: ${task.title}`,
        });
      }

      await tx.insert(taskStatusLogTable).values({
        taskId: task.id,
        status: "complete",
        actorUserId: me.id,
        note: "Task verified and payment released",
      });

      if (body.data.rating != null) {
        await tx.insert(reviewsTable).values({
          agentId: assignedAgentId,
          taskId: task.id,
          reviewerUserId: me.id,
          rating: body.data.rating,
          text: body.data.reviewText ?? null,
        });
      }

      await recalculateAgentReputation(tx, assignedAgentId);
    });

    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    await audit(req, {
      action: "task.verify",
      targetType: "task",
      targetId: task.id,
      before: { status: "submitted" },
      after: {
        status: "complete",
        rating: body.data.rating ?? null,
        paymentReleased: payment,
      },
    });
    res.json(VerifyTaskResponse.parse(await buildTaskSummary(updated!)));
  },
);

router.post(
  "/tasks/:taskId/dispute",
  requireAuth,
  taskActionLimit,
  async (req, res): Promise<void> => {
    const params = DisputeTaskParams.safeParse(req.params);
    const body = DisputeTaskBody.safeParse(req.body);
    if (!params.success || !body.success) {
      throw Errors.badRequest("Invalid request");
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task) {
      throw Errors.notFound("Task not found");
    }
    if (task.postedByUserId !== me.id) {
      throw Errors.unauthorized("Not your task");
    }
    if (task.status !== "submitted") {
      throw Errors.badRequest("Task must be in submitted state to dispute");
    }
    const payment = n(task.paymentAmount);

    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(tasksTable)
        .set({ status: "disputed", disputeReason: body.data.reason })
        .where(and(eq(tasksTable.id, task.id), eq(tasksTable.status, "submitted")))
        .returning({ id: tasksTable.id });
      if (!claimed) {
        throw new Error("Task was already processed by a concurrent request");
      }

      const [userWallet] = await tx
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.ownerUserId, me.id));
      if (userWallet) {
        const newBalance = n(userWallet.balance) + payment;
        const newEscrow = Math.max(0, n(userWallet.escrowed) - payment);
        await tx
          .update(walletsTable)
          .set({ balance: String(newBalance), escrowed: String(newEscrow) })
          .where(eq(walletsTable.id, userWallet.id));
        await tx.insert(walletTransactionsTable).values({
          walletId: userWallet.id,
          type: "escrow_return",
          amount: String(payment),
          balanceAfter: String(newBalance),
          relatedTaskId: task.id,
          description: `Escrow returned after dispute: ${task.title}`,
        });
      }
      await tx
        .update(usersTable)
        .set({ postingBalance: sql`${usersTable.postingBalance} + ${String(payment)}::numeric` })
        .where(eq(usersTable.id, me.id));

      await tx.insert(taskStatusLogTable).values({
        taskId: task.id,
        status: "disputed",
        actorUserId: me.id,
        note: body.data.reason,
      });

      if (task.assignedAgentId != null) {
        await recalculateAgentReputation(tx, task.assignedAgentId);
      }
    });

    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    await audit(req, {
      action: "task.dispute",
      targetType: "task",
      targetId: task.id,
      before: { status: "submitted" },
      after: { status: "disputed", reason: body.data.reason },
    });
    res.json(DisputeTaskResponse.parse(await buildTaskSummary(updated!)));
  },
);

router.post(
  "/tasks/:taskId/resolve-dispute",
  requireAuth,
  taskActionLimit,
  async (req, res): Promise<void> => {
    const params = ResolveDisputeParams.safeParse(req.params);
    const body = ResolveDisputeBody.safeParse(req.body);
    if (!params.success || !body.success) {
      throw Errors.badRequest("Invalid request");
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task) {
      throw Errors.notFound("Task not found");
    }
    if (task.postedByUserId !== me.id) {
      throw Errors.unauthorized("Only the task poster can resolve a dispute");
    }
    if (task.status !== "disputed") {
      throw Errors.badRequest("Task is not in disputed state");
    }
    if (task.disputeOutcome !== null) {
      // Idempotent: same outcome → 200 no-op; different outcome → 409 conflict
      if (task.disputeOutcome === body.data.outcome) {
        const current = await buildTaskSummary(task);
        res.json(ResolveDisputeResponse.parse(current));
        return;
      }
      throw Errors.conflict("Dispute already resolved with a different outcome");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(tasksTable)
        .set({ disputeOutcome: body.data.outcome })
        .where(eq(tasksTable.id, task.id));
      await tx.insert(taskStatusLogTable).values({
        taskId: task.id,
        status: "disputed",
        actorUserId: me.id,
        note: `Dispute resolved: ${body.data.outcome}`,
      });
      if (task.assignedAgentId != null) {
        await recalculateAgentReputation(tx, task.assignedAgentId);
      }
    });

    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    await audit(req, {
      action: "task.dispute_resolve",
      targetType: "task",
      targetId: task.id,
      before: { disputeOutcome: task.disputeOutcome },
      after: { disputeOutcome: body.data.outcome },
    });
    res.json(ResolveDisputeResponse.parse(await buildTaskSummary(updated!)));
  },
);

router.get(
  "/tasks/:taskId/checkpoint",
  requireAuth,
  async (req, res): Promise<void> => {
    const taskId = parseInt(String(req.params.taskId), 10);
    if (isNaN(taskId)) {
      throw Errors.badRequest("Invalid task ID");
    }
    const me = req.dbUser!;
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
    if (!task) {
      throw Errors.notFound("Task not found");
    }
    // Only the task poster may view the checkpoint
    if (task.postedByUserId !== me.id) {
      throw Errors.forbidden("Only the task poster can view checkpoints");
    }
    const [cp] = await db
      .select()
      .from(taskCheckpointsTable)
      .where(eq(taskCheckpointsTable.taskId, taskId))
      .orderBy(desc(taskCheckpointsTable.createdAt))
      .limit(1);
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
  },
);

export default router;
