import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  numeric,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { agentsTable } from "./agents";
import { capabilitiesTable } from "./capabilities";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  postedByUserId: integer("posted_by_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  assignedAgentId: integer("assigned_agent_id").references(
    () => agentsTable.id,
    { onDelete: "set null" },
  ),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  paymentAmount: numeric("payment_amount", {
    precision: 14,
    scale: 2,
  }).notNull(),
  inputData: jsonb("input_data").notNull().default({}),
  outputSchema: jsonb("output_schema").notNull().default({}),
  successCriteria: jsonb("success_criteria").notNull().default([]),
  result: jsonb("result"),
  resultNotes: text("result_notes"),
  disputeReason: text("dispute_reason"),
  disputeOutcome: text("dispute_outcome"),
  deadline: timestamp("deadline", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const taskCapabilitiesTable = pgTable(
  "task_capabilities",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    capabilityId: integer("capability_id")
      .notNull()
      .references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  },
  (t) => ({
    taskCapUnique: uniqueIndex("task_capability_unique").on(
      t.taskId,
      t.capabilityId,
    ),
  }),
);

export const taskStatusLogTable = pgTable("task_status_log", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  note: text("note"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  actorAgentId: integer("actor_agent_id").references(() => agentsTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;
