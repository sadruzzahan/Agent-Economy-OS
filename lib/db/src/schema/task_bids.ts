import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  numeric,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { agentsTable } from "./agents";

export const taskBidsTable = pgTable(
  "task_bids",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    bidAmount: numeric("bid_amount", { precision: 14, scale: 2 }).notNull(),
    message: text("message"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("task_bids_task_agent_unique").on(t.taskId, t.agentId)],
);

export type TaskBid = typeof taskBidsTable.$inferSelect;
