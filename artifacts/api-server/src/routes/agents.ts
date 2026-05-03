import { Router, type IRouter, type Request } from "express";
import { and, eq, inArray, ilike, sql, desc } from "drizzle-orm";
import { z } from "zod";
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
  agentActivityLogTable,
} from "@workspace/db";
import { requireAuth, getOrCreateDbUser } from "../lib/auth";
import { recalculateAgentReputation, computeReputationScore } from "../lib/reputation";
import { invalidateAggregateCaches } from "../lib/cache";
import { getAuth } from "@clerk/express";
import { audit } from "../lib/audit";
import { agentKeyLimit } from "../middlewares/rateLimits";
import { Errors } from "../lib/errors";
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
import { centsFromDb, centsToDollars } from "../lib/money";

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
      // Mirror reputation.ts: only in_progress+ states count toward totalAssigned
      // so a bare assignment by a third party cannot grief the completion-rate.
      // poster_fault disputes are excluded from the denominator for the same reason.
      disputed: sql<number>`count(*) filter (where ${tasksTable.status} = 'disputed' and ${tasksTable.disputeOutcome} = 'agent_fault')::int`,
      totalAssigned: sql<number>`count(*) filter (where ${tasksTable.status} in ('in_progress','submitted','complete','disputed') and not (${tasksTable.status} = 'disputed' and ${tasksTable.disputeOutcome} = 'poster_fault'))::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.assignedAgentId, agentRow.id));

  const [ratingAgg] = await db
    .select({
      avgRating: sql<number>`coalesce(avg(${reviewsTable.rating}), 0)::float`,
    })
    .from(reviewsTable)
    .where(eq(reviewsTable.agentId, agentRow.id));

  const taskCounts = {
    completed: counts?.completed ?? 0,
    disputed: counts?.disputed ?? 0,
    totalAssigned: counts?.totalAssigned ?? 0,
  };
  const avgRating = ratingAgg?.avgRating ?? 0;

  const { breakdown: scoreBreakdown } = computeReputationScore(taskCounts, avgRating);

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
    reputationScore: Number(agentRow.reputationScore),
    tasksCompleted: taskCounts.completed,
    tasksInProgress: counts?.inProgress ?? 0,
    disputeCount: taskCounts.disputed,
    scoreBreakdown,
    totalEarned: wallet ? centsToDollars(centsFromDb(wallet.totalEarnedCents)) : 0,
    walletBalance: wallet ? centsToDollars(centsFromDb(wallet.balanceCents)) : 0,
    walletEscrowed: wallet ? centsToDollars(centsFromDb(wallet.escrowedCents)) : 0,
    lastActiveAt: agentRow.lastActiveAt
      ? agentRow.lastActiveAt.toISOString()
      : null,
    createdAt: agentRow.createdAt.toISOString(),
  };
}

router.get("/agents", async (req: Request, res): Promise<void> => {
  const parsed = ListAgentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.message);
  }

  const { ownedByMe, capabilityId, minReputation, search } = parsed.data;

  const conditions = [];
  if (ownedByMe) {
    const auth = getAuth(req);
    if (!auth?.userId) {
      throw Errors.unauthorized("Unauthorized");
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

  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50),
  );
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);

  const rows = await db
    .select()
    .from(agentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(agentsTable.reputationScore))
    .limit(limit)
    .offset(offset);

  const dtos = await buildAgentDtosBatch(rows);
  res.json(ListAgentsResponse.parse(dtos));
});

router.post("/agents", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.message);
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
    throw new Error("Failed to create agent");
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

  await db.transaction(async (tx) => {
    await recalculateAgentReputation(tx, agent.id);
  });

  const [refreshed] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agent.id));

  const dto = await buildAgentDto(refreshed!);
  await audit(req, {
    action: "agent.create",
    targetType: "agent",
    targetId: agent.id,
    after: {
      name: agent.name,
      handle: agent.handle,
      capabilityIds,
    },
  });
  invalidateAggregateCaches();
  res.status(201).json({
    agent: dto,
    apiKey: apiKey.plain,
  });
});

router.get("/agents/:agentId", async (req, res): Promise<void> => {
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) {
    throw Errors.badRequest(params.error.message);
  }
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, params.data.agentId));
  if (!agent) {
    throw Errors.notFound("Agent not found");
  }
  const dto = await buildAgentDto(agent);
  res.json(GetAgentResponse.parse(dto));
});

router.patch("/agents/:agentId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateAgentParams.safeParse(req.params);
  if (!params.success) {
    throw Errors.badRequest(params.error.message);
  }
  const body = UpdateAgentBody.safeParse(req.body);
  if (!body.success) {
    throw Errors.badRequest(body.error.message);
  }
  const me = req.dbUser!;
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, params.data.agentId));
  if (!agent) {
    throw Errors.notFound("Agent not found");
  }
  if (agent.ownerUserId !== me.id) {
    throw Errors.unauthorized("Not your agent");
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
  await audit(req, {
    action: "agent.update",
    targetType: "agent",
    targetId: agent.id,
    before: {
      name: agent.name,
      description: agent.description,
      status: agent.status,
    },
    after: {
      name: updated?.name,
      description: updated?.description,
      status: updated?.status,
      capabilityIds: body.data.capabilityIds ?? undefined,
    },
  });
  const dto = await buildAgentDto(updated!);
  res.json(UpdateAgentResponse.parse(dto));
});

router.delete(
  "/agents/:agentId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeactivateAgentParams.safeParse(req.params);
    if (!params.success) {
      throw Errors.badRequest(params.error.message);
    }
    const me = req.dbUser!;
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, params.data.agentId));
    if (!agent) {
      throw Errors.notFound("Agent not found");
    }
    if (agent.ownerUserId !== me.id) {
      throw Errors.unauthorized("Not your agent");
    }
    await db
      .update(agentsTable)
      .set({ status: "inactive" })
      .where(eq(agentsTable.id, agent.id));
    await audit(req, {
      action: "agent.deactivate",
      targetType: "agent",
      targetId: agent.id,
      before: { status: agent.status },
      after: { status: "inactive" },
    });
    res.sendStatus(204);
  },
);

/**
 * Rotate the agent's API key. Revokes the previous key (the old hash is
 * overwritten so it can no longer authenticate) and returns a brand-new
 * plaintext key exactly once. Owner-only; rate-limited so a stolen
 * dashboard session can't churn keys.
 *
 * Re-auth model (defense in depth):
 *   1. Owner check: the caller's DB user must own the agent.
 *   2. Session freshness: the Clerk session must have been authenticated
 *      within the last `ROTATE_KEY_REAUTH_MAX_AGE_MS` (5 minutes). This
 *      forces the user to re-enter credentials in Clerk if their tab
 *      has been open for hours, mirroring GitHub's "sudo mode" / Clerk's
 *      `__session_fresh` pattern. A long-lived hijacked session token
 *      cannot complete this flow without a fresh password/passkey prompt.
 *   3. Typed-name confirmation: the body must echo the agent's exact
 *      name, so a one-click CSRF/clickjacking attempt fails even on a
 *      freshly-authenticated session.
 */
const ROTATE_KEY_REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

const RotateKeyBody = z.object({
  confirmAgentName: z.string().min(1),
});

router.post(
  "/agents/:agentId/rotate-key",
  requireAuth,
  agentKeyLimit,
  async (req, res, next): Promise<void> => {
    try {
      const params = DeactivateAgentParams.safeParse(req.params);
      if (!params.success) {
        throw Errors.badRequest(params.error.message);
      }
      const body = RotateKeyBody.safeParse(req.body ?? {});
      if (!body.success) {
        throw Errors.badRequest(
          "Body must include confirmAgentName matching the agent's name",
        );
      }

      // Session-freshness re-auth. `iat` (issued-at, in seconds) on the
      // Clerk session JWT is bumped on sign-in / re-auth; we require it
      // to be within the last 5 minutes for this destructive action.
      const auth = getAuth(req);
      const claims = auth?.sessionClaims as
        | { iat?: number; nbf?: number }
        | undefined;
      const issuedAtSec = claims?.iat ?? claims?.nbf;
      if (!issuedAtSec) {
        throw Errors.forbidden(
          "Re-authentication required. Please sign in again to rotate this key.",
        );
      }
      const ageMs = Date.now() - issuedAtSec * 1000;
      if (ageMs > ROTATE_KEY_REAUTH_MAX_AGE_MS) {
        throw Errors.forbidden(
          "Session is too old for this action. Please sign in again within the last 5 minutes and retry.",
        );
      }

      const me = req.dbUser!;
      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, params.data.agentId));
      if (!agent) throw Errors.notFound("Agent not found");
      if (agent.ownerUserId !== me.id) {
        throw Errors.forbidden("Only the agent owner can rotate its API key");
      }
      if (body.data.confirmAgentName !== agent.name) {
        throw Errors.forbidden(
          "confirmAgentName does not match the agent's name",
        );
      }

      const fresh = generateApiKey();
      const rotatedAt = new Date();

      // Atomic rotation: only succeed if the row's hash is still the one
      // we read above. A racing second rotation will see no rows updated
      // and we return 409 so the caller knows their issued key was never
      // valid. This eliminates the "two concurrent rotations both think
      // they won" race.
      const updated = await db
        .update(agentsTable)
        .set({
          apiKeyHash: fresh.hash,
          apiKeyPrefix: fresh.prefix,
          apiKeyRotatedAt: rotatedAt,
          apiKeyLastUsedAt: null,
          apiKeyLastUsedIp: null,
        })
        .where(
          and(
            eq(agentsTable.id, agent.id),
            eq(agentsTable.apiKeyHash, agent.apiKeyHash),
          ),
        )
        .returning({ id: agentsTable.id });
      if (updated.length === 0) {
        throw Errors.conflict(
          "Key was rotated concurrently — please retry",
        );
      }

      await audit(req, {
        action: "agent.key_rotate",
        targetType: "agent",
        targetId: agent.id,
        before: { apiKeyPrefix: agent.apiKeyPrefix },
        after: {
          apiKeyPrefix: fresh.prefix,
          rotatedAt: rotatedAt.toISOString(),
        },
      });

      res.status(200).json({
        apiKey: fresh.plain,
        apiKeyPrefix: fresh.prefix,
        rotatedAt: rotatedAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/agents/:agentId/reviews",
  async (req, res): Promise<void> => {
    const params = ListAgentReviewsParams.safeParse(req.params);
    if (!params.success) {
      throw Errors.badRequest(params.error.message);
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize ?? "10"), 10) || 10));
    const offset = (page - 1) * pageSize;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviewsTable)
      .where(eq(reviewsTable.agentId, params.data.agentId));
    const total = totalRow?.count ?? 0;

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
      .orderBy(desc(reviewsTable.createdAt))
      .limit(pageSize)
      .offset(offset);
    const dto = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
    res.setHeader("X-Total-Count", String(total));
    res.setHeader("X-Has-More", String(offset + rows.length < total));
    res.json(ListAgentReviewsResponse.parse(dto));
  },
);

router.get(
  "/agents/:agentId/reputation-history",
  async (req, res): Promise<void> => {
    const params = GetAgentReputationHistoryParams.safeParse(req.params);
    if (!params.success) {
      throw Errors.badRequest(params.error.message);
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

router.get(
  "/agents/:agentId/activity",
  requireAuth,
  async (req, res): Promise<void> => {
    const agentId = parseInt(String(req.params.agentId), 10);
    if (isNaN(agentId)) {
      throw Errors.badRequest("Invalid agent ID");
    }
    const me = req.dbUser!;
    // Only the agent owner may view runtime activity
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!agent) {
      throw Errors.notFound("Agent not found");
    }
    if (agent.ownerUserId !== me.id) {
      throw Errors.forbidden("Only the agent owner can view runtime activity");
    }
    const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10) || 50);
    const rows = await db
      .select()
      .from(agentActivityLogTable)
      .where(eq(agentActivityLogTable.agentId, agentId))
      .orderBy(desc(agentActivityLogTable.createdAt))
      .limit(limit);
    // ipAddress is not returned — it is internal telemetry only
    const dto = rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      endpoint: r.endpoint,
      method: r.method,
      responseStatus: r.responseStatus,
      createdAt: r.createdAt.toISOString(),
    }));
    res.json(dto);
  },
);

/**
 * Batched version of buildAgentDto: replaces N*5 sequential queries
 * with 5 single queries that load owners, capabilities, wallets, task
 * counts and review aggregates for the entire input set.
 */
async function buildAgentDtosBatch(
  agents: Array<typeof agentsTable.$inferSelect>,
) {
  if (agents.length === 0) return [];
  const agentIds = agents.map((a) => a.id);
  const ownerIds = [...new Set(agents.map((a) => a.ownerUserId))];

  const [owners, caps, wallets, taskCounts, ratingAggs] = await Promise.all([
    db.select().from(usersTable).where(inArray(usersTable.id, ownerIds)),
    db
      .select({
        agentId: agentCapabilitiesTable.agentId,
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
      .where(inArray(agentCapabilitiesTable.agentId, agentIds)),
    db.select().from(walletsTable).where(inArray(walletsTable.agentId, agentIds)),
    db
      .select({
        agentId: tasksTable.assignedAgentId,
        completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'complete')::int`,
        inProgress: sql<number>`count(*) filter (where ${tasksTable.status} in ('assigned','in_progress','submitted'))::int`,
        disputed: sql<number>`count(*) filter (where ${tasksTable.status} = 'disputed' and ${tasksTable.disputeOutcome} = 'agent_fault')::int`,
        totalAssigned: sql<number>`count(*) filter (where ${tasksTable.status} in ('in_progress','submitted','complete','disputed') and not (${tasksTable.status} = 'disputed' and ${tasksTable.disputeOutcome} = 'poster_fault'))::int`,
      })
      .from(tasksTable)
      .where(inArray(tasksTable.assignedAgentId, agentIds))
      .groupBy(tasksTable.assignedAgentId),
    db
      .select({
        agentId: reviewsTable.agentId,
        avgRating: sql<number>`coalesce(avg(${reviewsTable.rating}), 0)::float`,
      })
      .from(reviewsTable)
      .where(inArray(reviewsTable.agentId, agentIds))
      .groupBy(reviewsTable.agentId),
  ]);

  const ownersById = new Map(owners.map((o) => [o.id, o]));
  const capsByAgent = new Map<number, typeof caps>();
  for (const c of caps) {
    const arr = capsByAgent.get(c.agentId) ?? [];
    arr.push(c);
    capsByAgent.set(c.agentId, arr);
  }
  const walletByAgent = new Map<number, (typeof wallets)[number]>();
  for (const w of wallets) if (w.agentId != null) walletByAgent.set(w.agentId, w);
  const countsByAgent = new Map(
    taskCounts.filter((c) => c.agentId != null).map((c) => [c.agentId as number, c]),
  );
  const ratingByAgent = new Map(ratingAggs.map((r) => [r.agentId, r.avgRating]));

  return agents.map((agentRow) => {
    const owner = ownersById.get(agentRow.ownerUserId);
    const aCaps = capsByAgent.get(agentRow.id) ?? [];
    const wallet = walletByAgent.get(agentRow.id);
    const counts = countsByAgent.get(agentRow.id);
    const taskCountsObj = {
      completed: counts?.completed ?? 0,
      disputed: counts?.disputed ?? 0,
      totalAssigned: counts?.totalAssigned ?? 0,
    };
    const avgRating = ratingByAgent.get(agentRow.id) ?? 0;
    const { breakdown: scoreBreakdown } = computeReputationScore(
      taskCountsObj,
      avgRating,
    );
    return {
      id: agentRow.id,
      ownerUserId: agentRow.ownerUserId,
      ownerDisplayName: owner?.displayName ?? null,
      name: agentRow.name,
      handle: agentRow.handle,
      description: agentRow.description,
      avatarUrl: agentRow.avatarUrl,
      status: agentRow.status,
      capabilities: aCaps.map((c) => ({
        capabilityId: c.capabilityId,
        slug: c.slug,
        name: c.name,
        verified: c.verified,
        verifiedScore:
          c.verifiedScore == null ? null : Number(c.verifiedScore),
      })),
      reputationScore: Number(agentRow.reputationScore),
      tasksCompleted: taskCountsObj.completed,
      tasksInProgress: counts?.inProgress ?? 0,
      disputeCount: taskCountsObj.disputed,
      scoreBreakdown,
      totalEarned: wallet ? centsToDollars(centsFromDb(wallet.totalEarnedCents)) : 0,
      walletBalance: wallet ? centsToDollars(centsFromDb(wallet.balanceCents)) : 0,
      walletEscrowed: wallet ? centsToDollars(centsFromDb(wallet.escrowedCents)) : 0,
      lastActiveAt: agentRow.lastActiveAt
        ? agentRow.lastActiveAt.toISOString()
        : null,
      createdAt: agentRow.createdAt.toISOString(),
    };
  });
}

export { buildAgentDto, buildAgentDtosBatch };
export default router;
