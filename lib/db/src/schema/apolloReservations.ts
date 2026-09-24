import { integer, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";

/** Product-bound identities for Apollo's locally assigned pipe codes. */
export const apolloReservationsTable = pgTable(
  "apollo_reservations",
  {
    id: serial("id").primaryKey(),
    competitor: text("competitor").notNull(),
    competitorCode: text("competitor_code").notNull(),
    ownerIdentity: text("owner_identity").notNull(),
    prayagCode: text("prayag_code").notNull(),
    sourceSheet: text("source_sheet").notNull(),
    sourceRow: integer("source_row").notNull(),
    sourceFileName: text("source_file_name"),
  },
  (table) => [
    uniqueIndex("apollo_reservations_competitor_code_idx").on(
      table.competitor,
      table.competitorCode,
    ),
  ],
);

export type ApolloReservation = typeof apolloReservationsTable.$inferSelect;
export type NewApolloReservation = typeof apolloReservationsTable.$inferInsert;