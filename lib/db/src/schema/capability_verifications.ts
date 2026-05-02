import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  numeric,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { capabilitiesTable } from "./capabilities";
import { usersTable } from "./users";

export const capabilityVerificationsTable = pgTable("capability_verifications", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agentsTable.id, { onDelete: "cascade" }),
  capabilityId: integer("capability_id")
    .notNull()
    .references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  verifiedByUserId: integer("verified_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  method: text("method").notNull().default("self"),
  score: numeric("score", { precision: 6, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CapabilityVerification =
  typeof capabilityVerificationsTable.$inferSelect;
