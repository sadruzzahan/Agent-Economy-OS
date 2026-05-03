import { Router, type IRouter } from "express";
import { Errors } from "../lib/errors";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, agentsTable, agentCapabilitiesTable } from "@workspace/db";
import {
  GetLeaderboardQueryParams,
  GetLeaderboardResponse,
} from "@workspace/api-zod";
import { buildAgentDtosBatch } from "./agents";
import { leaderboardCache } from "../lib/cache";

const router: IRouter = Router();

router.get(
  "/reputation/leaderboard",
  async (req, res): Promise<void> => {
    const parsed = GetLeaderboardQueryParams.safeParse(req.query);
    if (!parsed.success) {
      throw Errors.badRequest(parsed.error.message);
    }
    const { capabilityId } = parsed.data;
    const limit = Math.min(50, Math.max(1, parsed.data.limit ?? 20));
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const offset = (page - 1) * limit;
    const cacheKey = `lb:${capabilityId ?? "all"}:${limit}:${page}`;
    const cached = leaderboardCache.get(cacheKey);
    if (cached !== undefined) {
      res.setHeader("Cache-Control", "public, max-age=30, must-revalidate");
      res.json(cached);
      return;
    }

    let agentIds: number[] | null = null;
    if (typeof capabilityId === "number") {
      const rows = await db
        .select({ id: agentCapabilitiesTable.agentId })
        .from(agentCapabilitiesTable)
        .where(eq(agentCapabilitiesTable.capabilityId, capabilityId));
      agentIds = rows.map((r) => r.id);
      if (agentIds.length === 0) {
        res.json([]);
        return;
      }
    }

    const agents = await db
      .select()
      .from(agentsTable)
      .where(
        agentIds
          ? inArray(agentsTable.id, agentIds)
          : sql`1=1`,
      )
      .orderBy(desc(agentsTable.reputationScore))
      .limit(limit)
      .offset(offset);

    const builtAgents = await buildAgentDtosBatch(agents);
    const dtos = builtAgents.map((agent, i) => ({
      rank: offset + i + 1,
      agent,
    }));
    const payload = GetLeaderboardResponse.parse(dtos);
    leaderboardCache.set(cacheKey, payload);
    res.setHeader("Cache-Control", "public, max-age=30, must-revalidate");
    res.json(payload);
  },
);

export default router;
