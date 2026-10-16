import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bucketSql, bucketCompetitorSql } from "./bucketFilter";

export type FinderProduct = {
  item_code: string; product_name: string | null; division: string | null; category: string | null; uom: string;
  discontinued_from: string | null; current_mrp: number | null; current_price_basis: string | null; current_effective_date: string | null;
  upcoming_mrp: number | null; upcoming_effective_date: string | null; has_recorded_competitor_price: boolean;
};
type FinderVariant = { item_code: string; variant: string; current_mrp: number; current_price_basis: string | null; current_effective_date: string;
  upcoming_mrp: number | null; upcoming_effective_date: string | null };
type FinderQuote = { item_code: string; competitor: string; price: number; effective_date: string;
  price_basis: string | null; gst_pct: number | null; unit: string | null; upcoming_price: number | null; upcoming_effective_date: string | null };

/** Shared detail/batch resolver: same approved variant windows and matched brand
 * lateral subqueries, parameterised by exact codes and as-of. Never is_current. */
export async function readFinderEvidence(codes: string[], asOf: string) {
  const list = codes.length ? sql.join(codes.map(c => sql`${c}`), sql`,`) : sql`NULL`;
  const [products, variants, competitors] = await Promise.all([
    db.execute<FinderProduct>(sql`
      SELECT p.item_code,p.product_name,p.division,p.category,p.uom,p.discontinued_from,
        cur.mrp AS current_mrp,cur.price_basis AS current_price_basis,cur.effective_date::text AS current_effective_date,
        upc.mrp AS upcoming_mrp,upc.effective_date::text AS upcoming_effective_date,
        EXISTS(SELECT 1 FROM competitor_prices recorded
          WHERE recorded.matched_prayag_code=p.item_code AND recorded.match_status='matched'
            AND recorded.price IS NOT NULL AND recorded.effective_date<=${asOf}::date) AS has_recorded_competitor_price
      FROM catalog_products p
      LEFT JOIN LATERAL (
        SELECT h.mrp,h.price_basis,h.effective_date FROM mrp_price_history h
        WHERE h.item_code=p.item_code AND h.variant='Standard' AND h.mrp IS NOT NULL
          AND h.review_status='approved' AND h.effective_date<=${asOf}::date
        ORDER BY h.effective_date DESC,h.id DESC LIMIT 1
      ) cur ON true
      LEFT JOIN LATERAL (
        SELECT h.mrp,h.effective_date FROM mrp_price_history h
        WHERE h.item_code=p.item_code AND h.variant='Standard' AND h.mrp IS NOT NULL
          AND h.review_status='approved' AND h.effective_date>${asOf}::date
          AND (p.discontinued_from IS NULL OR h.effective_date<p.discontinued_from)
        ORDER BY h.effective_date ASC,h.id DESC LIMIT 1
      ) upc ON true
      WHERE p.item_code IN (${list}) AND p.is_active IS TRUE
        AND (p.discontinued_from IS NULL OR p.discontinued_from>${asOf}::date)
        AND ${bucketSql(sql`p.item_code`)}
    `),
    db.execute<FinderVariant>(sql`
      SELECT v.item_code,v.variant,cur.mrp AS current_mrp,cur.price_basis AS current_price_basis,cur.effective_date::text AS current_effective_date,
        upc.mrp AS upcoming_mrp,upc.effective_date::text AS upcoming_effective_date
      FROM (SELECT DISTINCT h.item_code,h.variant FROM mrp_price_history h
        WHERE h.item_code IN (${list}) AND h.variant!='Standard' AND h.mrp IS NOT NULL AND h.review_status='approved') v
      JOIN LATERAL (
        SELECT h.mrp,h.price_basis,h.effective_date FROM mrp_price_history h WHERE h.item_code=v.item_code AND h.variant=v.variant
          AND h.mrp IS NOT NULL AND h.review_status='approved' AND h.effective_date<=${asOf}::date
        ORDER BY h.effective_date DESC,h.id DESC LIMIT 1
      ) cur ON true
      LEFT JOIN LATERAL (
        SELECT h.mrp,h.effective_date FROM mrp_price_history h WHERE h.item_code=v.item_code AND h.variant=v.variant
          AND h.mrp IS NOT NULL AND h.review_status='approved' AND h.effective_date>${asOf}::date
        ORDER BY h.effective_date ASC,h.id DESC LIMIT 1
      ) upc ON true
      WHERE ${bucketSql(sql`v.item_code`)}
      ORDER BY v.item_code,v.variant
    `),
    db.execute<FinderQuote>(sql`
      SELECT brands.item_code,brands.competitor,
        CASE WHEN lower(coalesce(cur.price_basis,''))='ex-gst' THEN cur.price*(1+coalesce(cur.gst_pct,18)/100.0) ELSE cur.price END AS price,
        cur.effective_date::text AS effective_date,cur.price_basis,cur.gst_pct,cur.unit,
        CASE WHEN lower(coalesce(upc.price_basis,''))='ex-gst' THEN upc.price*(1+coalesce(upc.gst_pct,18)/100.0) ELSE upc.price END AS upcoming_price,
        upc.effective_date::text AS upcoming_effective_date
      FROM (SELECT DISTINCT cp.matched_prayag_code AS item_code,cp.competitor FROM competitor_prices cp
        WHERE cp.matched_prayag_code IN (${list}) AND cp.match_status='matched'
          AND cp.price IS NOT NULL AND cp.effective_date<=${asOf}::date
          AND ${bucketCompetitorSql(sql`cp.competitor`,sql`cp.matched_prayag_code`)}) brands
      JOIN LATERAL (
        SELECT cp.price,cp.effective_date,cp.price_basis,cp.gst_pct,cp.unit FROM competitor_prices cp
        WHERE cp.matched_prayag_code=brands.item_code AND cp.competitor=brands.competitor AND cp.match_status='matched'
          AND cp.price IS NOT NULL AND cp.effective_date<=${asOf}::date
          AND ${bucketCompetitorSql(sql`cp.competitor`,sql`cp.matched_prayag_code`)}
        ORDER BY cp.effective_date DESC,cp.id DESC LIMIT 1
      ) cur ON true
      LEFT JOIN LATERAL (
        SELECT cp.price,cp.effective_date,cp.price_basis,cp.gst_pct FROM competitor_prices cp
        WHERE cp.matched_prayag_code=brands.item_code AND cp.competitor=brands.competitor AND cp.match_status='matched'
          AND cp.price IS NOT NULL AND cp.effective_date>${asOf}::date
          AND ${bucketCompetitorSql(sql`cp.competitor`,sql`cp.matched_prayag_code`)}
        ORDER BY cp.effective_date ASC,cp.id DESC LIMIT 1
      ) upc ON true ORDER BY brands.item_code,brands.competitor
    `),
  ]);
  return { products: products.rows, variants: variants.rows, competitors: competitors.rows };
}
