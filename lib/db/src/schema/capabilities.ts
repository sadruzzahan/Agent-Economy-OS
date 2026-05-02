import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const capabilitiesTable = pgTable("capabilities", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Capability = typeof capabilitiesTable.$inferSelect;
