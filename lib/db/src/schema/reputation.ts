import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  numeric,
  date,
} from "drizzle-orm/pg-core";
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
});

export const reputationHistoryTable = pgTable("reputation_history", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agentsTable.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  score: numeric("score", { precision: 6, scale: 2 }).notNull(),
});

export type Review = typeof reviewsTable.$inferSelect;
export type ReputationHistoryPoint =
  typeof reputationHistoryTable.$inferSelect;
