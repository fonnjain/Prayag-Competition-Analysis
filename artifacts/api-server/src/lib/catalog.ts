import { sql, eq } from "drizzle-orm";
import { db, competitorPricesTable } from "@workspace/db";

// Recompute is_current per live item_code: the row with the latest
// effective_date (tie-broken by highest id / most recent load) is current; all
// others false. A scheduled withdrawal takes effect on its stated date.
export async function recomputeCurrentFlags(): Promise<void> {
  await db.execute(sql`UPDATE mrp_price_history SET is_current = false`);
  await db.execute(sql`
    UPDATE mrp_price_history m
    SET is_current = true
    FROM (
      SELECT DISTINCT ON (h.item_code) h.id
      FROM mrp_price_history h
      JOIN catalog_products p ON p.item_code = h.item_code
      WHERE h.effective_date <= CURRENT_DATE
        AND p.is_active IS TRUE
        AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
      ORDER BY h.item_code, h.effective_date DESC, h.id DESC
    ) latest
    WHERE m.id = latest.id
  `);
}

// Recompute is_current on competitor_prices for a given brand after a period
// change. Matched rows: latest effective_date per (competitor, matched_prayag_code).
// Unmatched rows: all rows from the newest period for that competitor.
export async function recomputeCompetitorCurrentFlags(
  competitor: string,
): Promise<void> {
  await db.execute(
    sql`UPDATE competitor_prices SET is_current = false WHERE competitor = ${competitor}`,
  );
  await db.execute(sql`
    UPDATE competitor_prices
    SET is_current = true
    WHERE id IN (
      SELECT DISTINCT ON (competitor, matched_prayag_code) id
      FROM competitor_prices
      WHERE competitor = ${competitor}
        AND matched_prayag_code IS NOT NULL
        AND effective_date <= CURRENT_DATE
      ORDER BY competitor, matched_prayag_code, effective_date DESC NULLS LAST, id DESC
    )
  `);
  await db.execute(sql`
    UPDATE competitor_prices
    SET is_current = true
    WHERE competitor = ${competitor}
      AND matched_prayag_code IS NULL
      AND effective_date = (
        SELECT MAX(effective_date) FROM competitor_prices
        WHERE competitor = ${competitor}
          AND matched_prayag_code IS NULL
          AND effective_date <= CURRENT_DATE
      )
  `);
}

export function normCode(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}
