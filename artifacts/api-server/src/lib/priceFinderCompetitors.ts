import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bucketSql, bucketCompetitorSql } from "./bucketFilter";

export function finderAsOf(value: unknown): string {
  if (value == null || value === "") return new Date().toISOString().slice(0, 10);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("asOf must be YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid asOf date.");
  return value;
}

/** Codes are exact identifiers: no trim, case-folding or comma splitting. */
export function exactQueryCodes(value: unknown, cap = 50): string[] {
  const items = value == null ? [] : Array.isArray(value) ? value : [value];
  if (items.some(v => typeof v !== "string" || v.length === 0)) throw new Error("Codes must be non-empty repeated strings.");
  const codes = [...new Set(items as string[])];
  if (codes.length > cap) throw new Error(`Select at most ${cap} products.`);
  return codes;
}

export function finderScope(query: Record<string, unknown>) {
  const text = (key: string) => {
    const v = query[key];
    if (v == null || v === "" || v === "all") return null;
    if (typeof v !== "string") throw new Error(`${key} must be a single string.`);
    return v;
  };
  return { itemCodes: exactQueryCodes(query.itemCode), division: text("division"), category: text("category") };
}

export async function scopedFinderCompetitors(scope: ReturnType<typeof finderScope>, asOf: string) {
  const codes = scope.itemCodes;
  const result = await db.execute<{
    products: number; without_price: number;
    competitors: { competitor: string; pricedProducts: number; coveragePct: number; effectiveDate: string | null }[];
  }>(sql`
    WITH products AS (
      SELECT p.item_code FROM catalog_products p
      WHERE p.is_active IS TRUE
        AND (p.discontinued_from IS NULL OR p.discontinued_from > ${asOf}::date)
        AND ${bucketSql(sql`p.item_code`)}
        ${codes.length ? sql`AND p.item_code IN (${sql.join(codes.map(c => sql`${c}`), sql`,`)})` : sql``}
        ${scope.division ? scope.division === "__none__" ? sql`AND p.division IS NULL` : sql`AND p.division = ${scope.division}` : sql``}
        ${scope.category ? ["__none__", "__uncategorised__"].includes(scope.category) ? sql`AND (p.category IS NULL OR p.category='')` : sql`AND p.category = ${scope.category}` : sql``}
    ), quotes AS (
      SELECT cp.competitor, cp.matched_prayag_code AS item_code, max(cp.effective_date) AS effective_date
      FROM competitor_prices cp JOIN products p ON p.item_code=cp.matched_prayag_code
      WHERE cp.match_status='matched' AND cp.price IS NOT NULL
        AND cp.effective_date <= ${asOf}::date
        AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
      GROUP BY cp.competitor, cp.matched_prayag_code
    ), brands AS (
      SELECT competitor, count(*)::int AS priced_products, max(effective_date)::text AS effective_date
      FROM quotes GROUP BY competitor
    )
    SELECT (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM products p WHERE NOT EXISTS(SELECT 1 FROM quotes q WHERE q.item_code=p.item_code)) AS without_price,
      coalesce((SELECT json_agg(json_build_object('competitor',competitor,'pricedProducts',priced_products,
        'coveragePct',CASE WHEN (SELECT count(*) FROM products)=0 THEN 0 ELSE round(100.0*priced_products/(SELECT count(*) FROM products),2) END,
        'effectiveDate',effective_date) ORDER BY priced_products DESC,competitor) FROM brands),'[]'::json) AS competitors
  `);
  const row = result.rows[0];
  return { asOfDate: asOf, scope, competitors: row?.competitors ?? [],
    productsInScope: Number(row?.products ?? 0), productsWithNoCompetitorPrice: Number(row?.without_price ?? 0) };
}
