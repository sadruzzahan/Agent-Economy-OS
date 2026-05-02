import { Router, type IRouter } from "express";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import {
  db,
  agentsTable,
  tasksTable,
  walletsTable,
  walletTransactionsTable,
  taskStatusLogTable,
  reviewsTable,
  capabilitiesTable,
  agentCapabilitiesTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import {
  GetDashboardActivityQueryParams,
  GetDashboardActivityResponse,
  GetDashboardSummaryResponse,
  GetPlatformStatsResponse,
} from "@workspace/api-zod";
import { n } from "../lib/serialize";

const router: IRouter = Router();

router.get(
  "/dashboard/summary",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.dbUser!;
    const myAgents = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.ownerUserId, me.id));
    const agentIds = myAgents.map((a) => a.id);

    const totalAgents = myAgents.length;
    const activeAgents = myAgents.filter((a) => a.status === "active").length;

    const [postedCounts] = await db
      .select({
        open: sql<number>`count(*) filter (where status = 'open')::int`,
        inProgress: sql<number>`count(*) filter (where status in ('assigned','in_progress','submitted'))::int`,
        completed: sql<number>`count(*) filter (where status = 'complete')::int`,
        spent: sql<number>`coalesce(sum(payment_amount) filter (where status = 'complete'), 0)::float`,
      })
      .from(tasksTable)
      .where(eq(tasksTable.postedByUserId, me.id));

    let totalEarned = 0;
    let agentInProgress = 0;
    if (agentIds.length > 0) {
      const [earnedRow] = await db
        .select({
          total: sql<number>`coalesce(sum(total_earned), 0)::float`,
        })
        .from(walletsTable)
        .where(inArray(walletsTable.agentId, agentIds));
      totalEarned = earnedRow?.total ?? 0;
      const [aggInProg] = await db
        .select({
          c: sql<number>`count(*)::int`,
        })
        .from(tasksTable)
        .where(
          and(
            inArray(tasksTable.assignedAgentId, agentIds),
            inArray(tasksTable.status, [
              "assigned",
              "in_progress",
              "submitted",
            ]),
          ),
        );
      agentInProgress = aggInProg?.c ?? 0;
    }

    const [userWallet] = await db
      .select()
      .from(walletsTable)
      .where(eq(walletsTable.ownerUserId, me.id));

    res.json(
      GetDashboardSummaryResponse.parse({
        totalAgents,
        activeAgents,
        openTasksPosted: postedCounts?.open ?? 0,
        tasksInProgress:
          (postedCounts?.inProgress ?? 0) + agentInProgress,
        tasksCompleted: postedCounts?.completed ?? 0,
        totalEarned,
        totalSpent: postedCounts?.spent ?? 0,
        postingBalance: n(me.postingBalance),
        totalEscrowed: userWallet ? n(userWallet.escrowed) : 0,
      }),
    );
  },
);

router.get(
  "/dashboard/activity",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = GetDashboardActivityQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const me = req.dbUser!;
    const limit = parsed.data.limit ?? 20;

    const myAgents = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.ownerUserId, me.id));
    const agentIds = myAgents.map((a) => a.id);

    type Item = {
      id: string;
      type: string;
      title: string;
      description: string;
      relatedTaskId: number | null;
      relatedAgentId: number | null;
      amount: number | null;
      createdAt: string;
    };
    const items: Item[] = [];

    const myTasksLogs = await db
      .select({
        id: taskStatusLogTable.id,
        taskId: taskStatusLogTable.taskId,
        status: taskStatusLogTable.status,
        note: taskStatusLogTable.note,
        createdAt: taskStatusLogTable.createdAt,
        title: tasksTable.title,
        paymentAmount: tasksTable.paymentAmount,
        postedByUserId: tasksTable.postedByUserId,
        assignedAgentId: tasksTable.assignedAgentId,
      })
      .from(taskStatusLogTable)
      .innerJoin(tasksTable, eq(taskStatusLogTable.taskId, tasksTable.id))
      .where(
        agentIds.length > 0
          ? sql`${tasksTable.postedByUserId} = ${me.id} OR ${tasksTable.assignedAgentId} IN (${sql.join(
              agentIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : eq(tasksTable.postedByUserId, me.id),
      )
      .orderBy(desc(taskStatusLogTable.createdAt))
      .limit(limit);

    for (const l of myTasksLogs) {
      const typeMap: Record<string, string> = {
        open: "task_posted",
        assigned: "task_assigned",
        in_progress: "task_started",
        submitted: "task_submitted",
        complete: "task_completed",
        disputed: "task_disputed",
      };
      items.push({
        id: `log-${l.id}`,
        type: typeMap[l.status] ?? "task_posted",
        title: l.title,
        description: l.note ?? `Task ${l.status}`,
        relatedTaskId: l.taskId,
        relatedAgentId: l.assignedAgentId,
        amount:
          l.status === "complete" ? n(l.paymentAmount) : null,
        createdAt: l.createdAt.toISOString(),
      });
    }

    for (const a of myAgents.slice(0, 5)) {
      items.push({
        id: `agent-${a.id}`,
        type: "agent_created",
        title: `Agent “${a.name}” created`,
        description: a.description.slice(0, 120),
        relatedTaskId: null,
        relatedAgentId: a.id,
        amount: null,
        createdAt: a.createdAt.toISOString(),
      });
    }

    if (agentIds.length > 0) {
      const recentReviews = await db
        .select()
        .from(reviewsTable)
        .where(inArray(reviewsTable.agentId, agentIds))
        .orderBy(desc(reviewsTable.createdAt))
        .limit(10);
      for (const r of recentReviews) {
        items.push({
          id: `review-${r.id}`,
          type: "review_received",
          title: `New ${r.rating}-star review`,
          description: r.text ?? "Reviewer left a rating.",
          relatedTaskId: r.taskId,
          relatedAgentId: r.agentId,
          amount: null,
          createdAt: r.createdAt.toISOString(),
        });
      }
    }

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(GetDashboardActivityResponse.parse(items.slice(0, limit)));
  },
);

router.get(
  "/dashboard/platform-stats",
  async (_req, res): Promise<void> => {
    const [agentAgg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where status = 'active')::int`,
      })
      .from(agentsTable);
    const [taskAgg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where status = 'complete')::int`,
        volume: sql<number>`coalesce(sum(payment_amount) filter (where status = 'complete'), 0)::float`,
      })
      .from(tasksTable);

    const topCaps = await db
      .select({
        capability: capabilitiesTable,
        agentCount: sql<number>`count(${agentCapabilitiesTable.agentId})::int`,
      })
      .from(capabilitiesTable)
      .leftJoin(
        agentCapabilitiesTable,
        eq(agentCapabilitiesTable.capabilityId, capabilitiesTable.id),
      )
      .groupBy(capabilitiesTable.id)
      .orderBy(sql`count(${agentCapabilitiesTable.agentId}) desc`)
      .limit(8);

    res.json(
      GetPlatformStatsResponse.parse({
        totalAgents: agentAgg?.total ?? 0,
        totalActiveAgents: agentAgg?.active ?? 0,
        totalTasksPosted: taskAgg?.total ?? 0,
        totalTasksCompleted: taskAgg?.completed ?? 0,
        totalVolume: taskAgg?.volume ?? 0,
        topCapabilities: topCaps.map((tc) => ({
          capability: tc.capability,
          agentCount: tc.agentCount,
        })),
      }),
    );
  },
);

export default router;
