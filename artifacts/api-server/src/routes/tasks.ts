import { Router, type IRouter } from "express";
import { and, eq, inArray, ilike, sql, desc, gte, lte, or } from "drizzle-orm";
import {
  db,
  tasksTable,
  taskCapabilitiesTable,
  taskStatusLogTable,
  capabilitiesTable,
  agentsTable,
  walletsTable,
  walletTransactionsTable,
  reviewsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, getOrCreateDbUser } from "../lib/auth";
import { getAuth } from "@clerk/express";
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
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const {
    status,
    capabilityId,
    postedByMe,
    assignedToMyAgents,
    minPayment,
    maxPayment,
    search,
  } = parsed.data;

  const conditions = [];
  if (status) conditions.push(eq(tasksTable.status, status));
  if (typeof minPayment === "number")
    conditions.push(gte(tasksTable.paymentAmount, String(minPayment)));
  if (typeof maxPayment === "number")
    conditions.push(lte(tasksTable.paymentAmount, String(maxPayment)));
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
      res.status(401).json({ error: "Unauthorized" });
      return;
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

router.post("/tasks", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
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
    res.status(400).json({ error: "Insufficient posting balance" });
    return;
  }

  // Lock funds: deduct from postingBalance into a user-wallet escrow analog
  await db
    .update(usersTable)
    .set({ postingBalance: String(n(me.postingBalance) - paymentAmount) })
    .where(eq(usersTable.id, me.id));

  const [userWallet] = await db
    .select()
    .from(walletsTable)
    .where(eq(walletsTable.ownerUserId, me.id));
  if (userWallet) {
    const newEscrow = n(userWallet.escrowed) + paymentAmount;
    await db
      .update(walletsTable)
      .set({ escrowed: String(newEscrow) })
      .where(eq(walletsTable.id, userWallet.id));
    await db.insert(walletTransactionsTable).values({
      walletId: userWallet.id,
      type: "escrow_lock",
      amount: String(paymentAmount),
      balanceAfter: String(n(userWallet.balance)),
      description: `Escrow for task: ${title}`,
    });
  }

  const [task] = await db
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
  if (!task) {
    res.status(500).json({ error: "Failed to create task" });
    return;
  }

  if (capabilityIds.length > 0) {
    await db
      .insert(taskCapabilitiesTable)
      .values(
        capabilityIds.map((capabilityId) => ({
          taskId: task.id,
          capabilityId,
        })),
      );
  }

  await db.insert(taskStatusLogTable).values({
    taskId: task.id,
    status: "open",
    actorUserId: me.id,
    note: "Task posted to market",
  });

  const dto = await buildTaskSummary(task);
  res.status(201).json(dto);
});

router.get("/tasks/:taskId", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, params.data.taskId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const dto = await buildTaskDetail(task);
  res.json(GetTaskResponse.parse(dto));
});

router.post(
  "/tasks/:taskId/assign",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = AssignTaskParams.safeParse(req.params);
    const body = AssignTaskBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (task.status !== "open") {
      res.status(400).json({ error: "Task is not open" });
      return;
    }
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, body.data.agentId));
    if (!agent || agent.ownerUserId !== me.id) {
      res.status(401).json({ error: "Not your agent" });
      return;
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
    });
    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
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
      res.status(400).json({ error: params.error.message });
      return;
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (task.status !== "assigned" || !task.assignedAgentId) {
      res.status(400).json({ error: "Task not in assigned state" });
      return;
    }
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, task.assignedAgentId));
    if (!agent || agent.ownerUserId !== me.id) {
      res.status(401).json({ error: "Not your agent" });
      return;
    }
    await db
      .update(tasksTable)
      .set({ status: "in_progress" })
      .where(eq(tasksTable.id, task.id));
    await db.insert(taskStatusLogTable).values({
      taskId: task.id,
      status: "in_progress",
      actorAgentId: agent.id,
      actorUserId: me.id,
    });
    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
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
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task || !task.assignedAgentId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, task.assignedAgentId));
    if (!agent || agent.ownerUserId !== me.id) {
      res.status(401).json({ error: "Not your agent" });
      return;
    }
    if (task.status !== "in_progress" && task.status !== "assigned") {
      res.status(400).json({ error: "Task not in submittable state" });
      return;
    }
    await db
      .update(tasksTable)
      .set({
        status: "submitted",
        result: body.data.result,
        resultNotes: body.data.notes ?? null,
      })
      .where(eq(tasksTable.id, task.id));
    await db.insert(taskStatusLogTable).values({
      taskId: task.id,
      status: "submitted",
      actorAgentId: agent.id,
      actorUserId: me.id,
      note: body.data.notes ?? null,
    });
    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    res.json(SubmitTaskResultResponse.parse(await buildTaskSummary(updated!)));
  },
);

router.post(
  "/tasks/:taskId/verify",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = VerifyTaskParams.safeParse(req.params);
    const body = VerifyTaskBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task || !task.assignedAgentId) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (task.postedByUserId !== me.id) {
      res.status(401).json({ error: "Not your task" });
      return;
    }
    if (task.status !== "submitted") {
      res.status(400).json({ error: "Task not in submitted state" });
      return;
    }
    const payment = n(task.paymentAmount);
    const assignedAgentId = task.assignedAgentId;

    await db.transaction(async (tx) => {
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

      await tx
        .update(tasksTable)
        .set({ status: "complete" })
        .where(eq(tasksTable.id, task.id));
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

        const [agg] = await tx
          .select({
            avgRating: sql<number>`coalesce(avg(${reviewsTable.rating}), 0)::float`,
          })
          .from(reviewsTable)
          .where(eq(reviewsTable.agentId, assignedAgentId));
        const newScore = Math.min(100, (agg?.avgRating ?? 0) * 20);
        await tx
          .update(agentsTable)
          .set({ reputationScore: String(newScore) })
          .where(eq(agentsTable.id, assignedAgentId));
      }
    });

    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    res.json(VerifyTaskResponse.parse(await buildTaskSummary(updated!)));
  },
);

router.post(
  "/tasks/:taskId/dispute",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DisputeTaskParams.safeParse(req.params);
    const body = DisputeTaskBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const me = req.dbUser!;
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, params.data.taskId));
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (task.postedByUserId !== me.id) {
      res.status(401).json({ error: "Not your task" });
      return;
    }
    await db
      .update(tasksTable)
      .set({ status: "disputed", disputeReason: body.data.reason })
      .where(eq(tasksTable.id, task.id));
    await db.insert(taskStatusLogTable).values({
      taskId: task.id,
      status: "disputed",
      actorUserId: me.id,
      note: body.data.reason,
    });
    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    res.json(DisputeTaskResponse.parse(await buildTaskSummary(updated!)));
  },
);

export default router;
