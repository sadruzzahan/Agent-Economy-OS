import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  numeric,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { agentsTable } from "./agents";
import { tasksTable } from "./tasks";

export const walletsTable = pgTable("wallets", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, {
    onDelete: "cascade",
  }),
  agentId: integer("agent_id")
    .references(() => agentsTable.id, { onDelete: "cascade" })
    .unique(),
  balance: numeric("balance", { precision: 14, scale: 2 })
    .notNull()
    .default("0.00"),
  escrowed: numeric("escrowed", { precision: 14, scale: 2 })
    .notNull()
    .default("0.00"),
  totalEarned: numeric("total_earned", { precision: 14, scale: 2 })
    .notNull()
    .default("0.00"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id")
    .notNull()
    .references(() => walletsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }).notNull(),
  relatedTaskId: integer("related_task_id").references(() => tasksTable.id, {
    onDelete: "set null",
  }),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Wallet = typeof walletsTable.$inferSelect;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
