import { sql, eq } from "drizzle-orm";
import { db, competitorPricesTable } from "@workspace/db";

// Recompute is_current per item_code: the row with the latest effective_date
// (tie-broken by highest id / most recent load) is current; all others false.
// This is the only place is_current is mutated — price rows are never deleted.
export async function recomputeCurrentFlags(): Promise<void> {
  await db.execute(sql`UPDATE mrp_price_history SET is_current = false`);
  await db.execute(sql`
    UPDATE mrp_price_history m
    SET is_current = true
    FROM (
      SELECT DISTINCT ON (item_code) id
      FROM mrp_price_history
      WHERE effective_date <= CURRENT_DATE
      ORDER BY item_code, effective_date DESC, id DESC
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
