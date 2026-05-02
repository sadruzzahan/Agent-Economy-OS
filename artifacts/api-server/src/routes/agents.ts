import { Router, type IRouter, type Request } from "express";
import { and, eq, inArray, ilike, sql, desc } from "drizzle-orm";
import crypto from "node:crypto";
import {
  db,
  agentsTable,
  agentCapabilitiesTable,
  capabilitiesTable,
  walletsTable,
  tasksTable,
  usersTable,
  reviewsTable,
  reputationHistoryTable,
} from "@workspace/db";
import { requireAuth, getOrCreateDbUser } from "../lib/auth";
import { getAuth } from "@clerk/express";
import {
  CreateAgentBody,
  GetAgentParams,
  GetAgentResponse,
  ListAgentsQueryParams,
  ListAgentsResponse,
  UpdateAgentBody,
  UpdateAgentParams,
  UpdateAgentResponse,
  DeactivateAgentParams,
  ListAgentReviewsParams,
  ListAgentReviewsResponse,
  GetAgentReputationHistoryParams,
  GetAgentReputationHistoryResponse,
} from "@workspace/api-zod";
import { n } from "../lib/serialize";

const router: IRouter = Router();

function makeHandle(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 24);
  const suffix = crypto.randomBytes(2).toString("hex");
  return `${base || "agent"}-${suffix}`;
}

function generateApiKey(): { plain: string; hash: string; prefix: string } {
  const plain = `aeo_${crypto.randomBytes(24).toString("base64url")}`;
  const hash = crypto.createHash("sha256").update(plain).digest("hex");
  const prefix = plain.slice(0, 12);
  return { plain, hash, prefix };
}

async function buildAgentDto(agentRow: {
  id: number;
  ownerUserId: number;
  name: string;
  handle: string;
  description: string;
  avatarUrl: string | null;
  status: string;
  reputationScore: string;
  lastActiveAt: Date | null;
  createdAt: Date;
}) {
  const [owner] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, agentRow.ownerUserId));

  const caps = await db
    .select({
      capabilityId: capabilitiesTable.id,
      slug: capabilitiesTable.slug,
      name: capabilitiesTable.name,
      verified: agentCapabilitiesTable.verified,
      verifiedScore: agentCapabilitiesTable.verifiedScore,
    })
    .from(agentCapabilitiesTable)
    .innerJoin(
      capabilitiesTable,
      eq(agentCapabilitiesTable.capabilityId, capabilitiesTable.id),
    )
    .where(eq(agentCapabilitiesTable.agentId, agentRow.id));

  const [wallet] = await db
    .select()
    .from(walletsTable)
    .where(eq(walletsTable.agentId, agentRow.id));

  const [counts] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'complete')::int`,
      inProgress: sql<number>`count(*) filter (where ${tasksTable.status} in ('assigned','in_progress','submitted'))::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.assignedAgentId, agentRow.id));

  return {
    id: agentRow.id,
    ownerUserId: agentRow.ownerUserId,
    ownerDisplayName: owner?.displayName ?? null,
    name: agentRow.name,
    handle: agentRow.handle,
    description: agentRow.description,
    avatarUrl: agentRow.avatarUrl,
    status: agentRow.status,
    capabilities: caps.map((c) => ({
      capabilityId: c.capabilityId,
      slug: c.slug,
      name: c.name,
      verified: c.verified,
      verifiedScore:
        c.verifiedScore == null ? null : Number(c.verifiedScore),
    })),
    reputationScore: n(agentRow.reputationScore),
    tasksCompleted: counts?.completed ?? 0,
    tasksInProgress: counts?.inProgress ?? 0,
    totalEarned: wallet ? n(wallet.totalEarned) : 0,
    walletBalance: wallet ? n(wallet.balance) : 0,
    walletEscrowed: wallet ? n(wallet.escrowed) : 0,
    lastActiveAt: agentRow.lastActiveAt
      ? agentRow.lastActiveAt.toISOString()
      : null,
    createdAt: agentRow.createdAt.toISOString(),
  };
}

router.get("/agents", async (req: Request, res): Promise<void> => {
  const parsed = ListAgentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { ownedByMe, capabilityId, minReputation, search } = parsed.data;

  const conditions = [];
  if (ownedByMe) {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const me = await getOrCreateDbUser(auth.userId);
    conditions.push(eq(agentsTable.ownerUserId, me.id));
  }
  if (search) {
    conditions.push(ilike(agentsTable.name, `%${search}%`));
  }
  if (typeof minReputation === "number") {
    conditions.push(
      sql`${agentsTable.reputationScore} >= ${minReputation}`,
    );
  }
  if (typeof capabilityId === "number") {
    const matchingAgentIds = await db
      .select({ id: agentCapabilitiesTable.agentId })
      .from(agentCapabilitiesTable)
      .where(eq(agentCapabilitiesTable.capabilityId, capabilityId));
    const ids = matchingAgentIds.map((r) => r.id);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    conditions.push(inArray(agentsTable.id, ids));
  }

  const rows = await db
    .select()
    .from(agentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(agentsTable.reputationScore));

  const dtos = await Promise.all(rows.map((r) => buildAgentDto(r)));
  res.json(ListAgentsResponse.parse(dtos));
});

router.post("/agents", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.dbUser!;
  const { name, description, capabilityIds } = parsed.data;
  const apiKey = generateApiKey();
  const handle = makeHandle(name);

  const [agent] = await db
    .insert(agentsTable)
    .values({
      ownerUserId: me.id,
      name,
      description,
      handle,
      apiKeyHash: apiKey.hash,
      apiKeyPrefix: apiKey.prefix,
    })
    .returning();
  if (!agent) {
    res.status(500).json({ error: "Failed to create agent" });
    return;
  }

  if (capabilityIds.length > 0) {
    await db
      .insert(agentCapabilitiesTable)
      .values(
        capabilityIds.map((capabilityId) => ({
          agentId: agent.id,
          capabilityId,
        })),
      );
  }

  await db.insert(walletsTable).values({ kind: "agent", agentId: agent.id });

  const dto = await buildAgentDto(agent);
  res.status(201).json({
    agent: dto,
    apiKey: apiKey.plain,
  });
});

router.get("/agents/:agentId", async (req, res): Promise<void> => {
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, params.data.agentId));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const dto = await buildAgentDto(agent);
  res.json(GetAgentResponse.parse(dto));
});

router.patch("/agents/:agentId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateAgentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const me = req.dbUser!;
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, params.data.agentId));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  if (agent.ownerUserId !== me.id) {
    res.status(401).json({ error: "Not your agent" });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (body.data.name !== undefined) updates["name"] = body.data.name;
  if (body.data.description !== undefined)
    updates["description"] = body.data.description;
  if (body.data.status !== undefined) updates["status"] = body.data.status;
  if (Object.keys(updates).length > 0) {
    await db
      .update(agentsTable)
      .set(updates)
      .where(eq(agentsTable.id, agent.id));
  }
  if (body.data.capabilityIds) {
    await db
      .delete(agentCapabilitiesTable)
      .where(eq(agentCapabilitiesTable.agentId, agent.id));
    if (body.data.capabilityIds.length > 0) {
      await db.insert(agentCapabilitiesTable).values(
        body.data.capabilityIds.map((capabilityId) => ({
          agentId: agent.id,
          capabilityId,
        })),
      );
    }
  }
  const [updated] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agent.id));
  const dto = await buildAgentDto(updated!);
  res.json(UpdateAgentResponse.parse(dto));
});

router.delete(
  "/agents/:agentId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeactivateAgentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const me = req.dbUser!;
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, params.data.agentId));
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (agent.ownerUserId !== me.id) {
      res.status(401).json({ error: "Not your agent" });
      return;
    }
    await db
      .update(agentsTable)
      .set({ status: "inactive" })
      .where(eq(agentsTable.id, agent.id));
    res.sendStatus(204);
  },
);

router.get(
  "/agents/:agentId/reviews",
  async (req, res): Promise<void> => {
    const params = ListAgentReviewsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const rows = await db
      .select({
        id: reviewsTable.id,
        agentId: reviewsTable.agentId,
        taskId: reviewsTable.taskId,
        taskTitle: tasksTable.title,
        rating: reviewsTable.rating,
        text: reviewsTable.text,
        createdAt: reviewsTable.createdAt,
        reviewerDisplayName: usersTable.displayName,
      })
      .from(reviewsTable)
      .innerJoin(tasksTable, eq(reviewsTable.taskId, tasksTable.id))
      .innerJoin(usersTable, eq(reviewsTable.reviewerUserId, usersTable.id))
      .where(eq(reviewsTable.agentId, params.data.agentId))
      .orderBy(desc(reviewsTable.createdAt));
    const dto = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
    res.json(ListAgentReviewsResponse.parse(dto));
  },
);

router.get(
  "/agents/:agentId/reputation-history",
  async (req, res): Promise<void> => {
    const params = GetAgentReputationHistoryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const rows = await db
      .select()
      .from(reputationHistoryTable)
      .where(eq(reputationHistoryTable.agentId, params.data.agentId))
      .orderBy(reputationHistoryTable.date);
    const dto = rows.map((r) => ({
      date: typeof r.date === "string" ? r.date : String(r.date),
      score: n(r.score),
    }));
    res.json(GetAgentReputationHistoryResponse.parse(dto));
  },
);

export { buildAgentDto };
export default router;
