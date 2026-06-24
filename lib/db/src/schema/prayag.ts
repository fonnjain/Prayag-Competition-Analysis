import {
  pgTable,
  serial,
  text,
  doublePrecision,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const productsTable = pgTable(
  "products",
  {
    itemCode: text("item_code").primaryKey(),
    category: text("category").notNull(),
    size: text("size"),
    prayagMrp: doublePrecision("prayag_mrp"),
    prayagNet: doublePrecision("prayag_net"),
    kgCost: doublePrecision("kg_cost"),
    edited: boolean("edited").notNull().default(false),
  },
  (t) => [index("products_category_idx").on(t.category)],
);

export const competitorsTable = pgTable("competitors", {
  name: text("name").primaryKey(),
  basis: text("basis").notNull(),
  hidden: boolean("hidden").notNull().default(false),
});

export const comparisonsTable = pgTable(
  "comparisons",
  {
    id: serial("id").primaryKey(),
    competitor: text("competitor").notNull(),
    itemCode: text("item_code").notNull(),
    basis: text("basis").notNull(),
    compMrp: doublePrecision("comp_mrp"),
    compPrice: doublePrecision("comp_price"),
    matchMethod: text("match_method").notNull().default("code"),
    sourceFile: text("source_file"),
    edited: boolean("edited").notNull().default(false),
  },
  (t) => [
    index("comparisons_item_idx").on(t.itemCode),
    index("comparisons_competitor_idx").on(t.competitor),
  ],
);

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  minimumMarginPct: doublePrecision("minimum_margin_pct").notNull().default(15),
});

export type Product = typeof productsTable.$inferSelect;
export type Competitor = typeof competitorsTable.$inferSelect;
export type Comparison = typeof comparisonsTable.$inferSelect;
export type Settings = typeof settingsTable.$inferSelect;
