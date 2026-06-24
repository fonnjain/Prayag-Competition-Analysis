import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

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
      ORDER BY item_code, effective_date DESC, id DESC
    ) latest
    WHERE m.id = latest.id
  `);
}

export function normCode(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}
