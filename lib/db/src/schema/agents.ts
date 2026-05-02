import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  numeric,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
  reputationScore: numeric("reputation_score", { precision: 6, scale: 2 })
    .notNull()
    .default("50.00"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
