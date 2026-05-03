import { eq, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  tasksTable,
  reviewsTable,
  reputationHistoryTable,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ScoreComponents {
  completionRate: number;
  avgRating: number;
  nonDisputeRate: number;
  volumeBonus: number;
}

export async function recalculateAgentReputation(
  tx: Tx,
  agentId: number,
): Promise<{ score: number; breakdown: ScoreComponents }> {
  const [counts] = await tx
    .select({
      completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'complete')::int`,
      disputed: sql<number>`count(*) filter (where ${tasksTable.status} = 'disputed')::int`,
      totalAssigned: sql<number>`count(*) filter (where ${tasksTable.status} != 'open')::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.assignedAgentId, agentId));

  const [ratingAgg] = await tx
    .select({
      avgRating: sql<number>`coalesce(avg(${reviewsTable.rating}), 0)::float`,
    })
    .from(reviewsTable)
    .where(eq(reviewsTable.agentId, agentId));

  const completed = counts?.completed ?? 0;
  const disputed = counts?.disputed ?? 0;
  const totalAssigned = counts?.totalAssigned ?? 0;
  const avgRating = ratingAgg?.avgRating ?? 0;

  if (totalAssigned === 0 && avgRating === 0) {
    const breakdown: ScoreComponents = {
      completionRate: 0,
      avgRating: 0,
      nonDisputeRate: 0,
      volumeBonus: 0,
    };
    await applyScore(tx, agentId, 0, breakdown);
    return { score: 0, breakdown };
  }

  const completionRateComponent =
    (completed / Math.max(1, totalAssigned)) * 40;
  const avgRatingComponent = (avgRating / 5) * 35;
  const nonDisputeRateComponent =
    (1 - disputed / Math.max(1, totalAssigned)) * 15;
  const volumeBonusComponent = Math.min(10, completed);

  const raw =
    completionRateComponent +
    avgRatingComponent +
    nonDisputeRateComponent +
    volumeBonusComponent;

  const score = Math.round(Math.min(100, raw) * 10) / 10;

  const breakdown: ScoreComponents = {
    completionRate: Math.round(completionRateComponent * 10) / 10,
    avgRating: Math.round(avgRatingComponent * 10) / 10,
    nonDisputeRate: Math.round(nonDisputeRateComponent * 10) / 10,
    volumeBonus: Math.round(volumeBonusComponent * 10) / 10,
  };

  await applyScore(tx, agentId, score, breakdown);
  return { score, breakdown };
}

async function applyScore(
  tx: Tx,
  agentId: number,
  score: number,
  _breakdown: ScoreComponents,
): Promise<void> {
  await tx
    .update(agentsTable)
    .set({ reputationScore: String(score) })
    .where(eq(agentsTable.id, agentId));

  const today = new Date().toISOString().slice(0, 10);

  await tx
    .insert(reputationHistoryTable)
    .values({ agentId, date: today, score: String(score) })
    .onConflictDoUpdate({
      target: [reputationHistoryTable.agentId, reputationHistoryTable.date],
      set: { score: String(score) },
    });
}
