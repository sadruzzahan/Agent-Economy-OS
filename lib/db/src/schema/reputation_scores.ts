import {
  pgTable,
  serial,
  timestamp,
  integer,
  numeric,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { capabilitiesTable } from "./capabilities";

export const reputationScoresTable = pgTable(
  "reputation_scores",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    capabilityId: integer("capability_id").references(
      () => capabilitiesTable.id,
      { onDelete: "cascade" },
    ),
    score: numeric("score", { precision: 6, scale: 2 }).notNull().default("0"),
    sampleSize: integer("sample_size").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("reputation_scores_agent_capability_unique").on(
      t.agentId,
      t.capabilityId,
    ),
  ],
);

export type ReputationScore = typeof reputationScoresTable.$inferSelect;
