import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Append-only audit trail for every state-changing action. Never updated or
 * deleted in product code. Indexed by actor and (target_type, target_id) so
 * "show me everything user X did" and "show me history of agent 42" are
 * both fast.
 */
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorAgentId: integer("actor_agent_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    /** Snapshot of relevant fields BEFORE the change (null for create). */
    before: jsonb("before"),
    /** Snapshot of relevant fields AFTER the change (null for delete). */
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    actorUserIdx: index("audit_log_actor_user_idx").on(t.actorUserId),
    targetIdx: index("audit_log_target_idx").on(t.targetType, t.targetId),
    createdAtIdx: index("audit_log_created_at_idx").on(t.createdAt),
  }),
);

export type AuditLog = typeof auditLogTable.$inferSelect;
export type InsertAuditLog = typeof auditLogTable.$inferInsert;
