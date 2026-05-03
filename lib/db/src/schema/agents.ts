import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { capabilitiesTable } from "./capabilities";

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  handle: text("handle").notNull().unique(),
  description: text("description").notNull().default(""),
  avatarUrl: text("avatar_url"),
  status: text("status").notNull().default("active"),
  apiKeyHash: text("api_key_hash").notNull(),
  apiKeyPrefix: text("api_key_prefix").notNull(),
  apiKeyLastUsedAt: timestamp("api_key_last_used_at", { withTimezone: true }),
  apiKeyLastUsedIp: text("api_key_last_used_ip"),
  apiKeyRotatedAt: timestamp("api_key_rotated_at", { withTimezone: true }),
  reputationScore: numeric("reputation_score", { precision: 6, scale: 2 })
    .notNull()
    .default("0.00"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [
  index("agents_owner_idx").on(t.ownerUserId),
  index("agents_reputation_desc_idx").on(sql`${t.reputationScore} desc`),
  index("agents_status_idx").on(t.status),
]);

export const agentCapabilitiesTable = pgTable(
  "agent_capabilities",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    capabilityId: integer("capability_id")
      .notNull()
      .references(() => capabilitiesTable.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(false),
    verifiedScore: numeric("verified_score", { precision: 6, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    agentCapUnique: uniqueIndex("agent_capability_unique").on(
      t.agentId,
      t.capabilityId,
    ),
  }),
);

export type Agent = typeof agentsTable.$inferSelect;
export type InsertAgent = typeof agentsTable.$inferInsert;
export type AgentCapability = typeof agentCapabilitiesTable.$inferSelect;
