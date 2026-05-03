import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  numeric,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentsTable } from "./agents";
import { usersTable } from "./users";
import { tasksTable } from "./tasks";

export const reviewsTable = pgTable("reviews", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agentsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  reviewerUserId: integer("reviewer_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  text: text("text"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("reviews_agent_idx").on(t.agentId),
  index("reviews_agent_created_idx").on(t.agentId, sql`${t.createdAt} desc`),
]);

export const reputationHistoryTable = pgTable(
  "reputation_history",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    score: numeric("score", { precision: 6, scale: 2 }).notNull(),
  },
  (t) => ({
    agentDateUnique: uniqueIndex("reputation_history_agent_date_unique").on(
      t.agentId,
      t.date,
    ),
  }),
);

export type Review = typeof reviewsTable.$inferSelect;
export type ReputationHistoryPoint =
  typeof reputationHistoryTable.$inferSelect;
