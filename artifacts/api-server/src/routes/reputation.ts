import { Router, type IRouter } from "express";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, agentsTable, agentCapabilitiesTable } from "@workspace/db";
import {
  GetLeaderboardQueryParams,
  GetLeaderboardResponse,
} from "@workspace/api-zod";
import { buildAgentDto } from "./agents";

const router: IRouter = Router();

router.get(
  "/reputation/leaderboard",
  async (req, res): Promise<void> => {
    const parsed = GetLeaderboardQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { capabilityId, limit = 10 } = parsed.data;

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
      .limit(limit);

    const dtos = await Promise.all(
      agents.map(async (a, i) => ({
        rank: i + 1,
        agent: await buildAgentDto(a),
      })),
    );
    res.json(GetLeaderboardResponse.parse(dtos));
  },
);

export default router;
