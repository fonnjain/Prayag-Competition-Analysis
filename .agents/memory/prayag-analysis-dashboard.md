---
name: Prayag Competition Analysis dashboard
description: How the /analysis dashboard computes competitor price gaps from existing tables, and the basis/sign rules that must stay consistent.
---

# Competition Analysis dashboard (@workspace/prayag-analysis, /analysis/)

A read-only analytics dashboard layered on the SAME tables the Console uses
(`catalog_products`, `mrp_price_history` where `is_current`, `competitor_prices`).
No new tables, no migration, no cache — every `/api/analysis/*` endpoint recomputes
in-memory per request (dataset is small: ~8.7k competitor rows).

## Where the logic lives
- Pure compute (basis normalization, comparability, aggregation, positioning,
  filters) is isolated in `artifacts/api-server/src/lib/analysis.ts` and unit-tested
  in `analysis.test.ts`. **Why:** keeping it DB-free is what makes it testable —
  put new analytic rules there, not inline in the route.
- `routes/analysis.ts` only does DB reads + per-endpoint aggregation, then delegates
  row-building to `buildRow`.

## Rules that MUST stay consistent (subtle, easy to silently break)
- **Basis normalization:** `competitor_prices.unit` trimmed === `"Rate (ex-GST)"`
  → multiply price by 1.18 (GST gross-up) before comparing; null/empty/anything
  else is treated as already MRP-comparable. All comparisons are vs Prayag CURRENT
  MRP only.
- **Comparability gate:** a price gap is computed ONLY when
  `match_status === "matched"` AND `prayagMrp > 0` AND competitor price present.
  Non-comparable rows still count toward coverage / match-quality but are excluded
  from gap stats.
- **Sign convention:** `priceDiff = competitorEffectivePrice − prayagMrp`;
  `prayagCheaper = competitorEffectivePrice > prayagMrp`. Positive diff% = Prayag
  cheaper = GREEN/good (margin headroom). Negative = Prayag costlier = RED threat.
  The frontend color language depends on this sign — do not flip it.
- **No catalog-attribute leakage:** `buildRow` only hydrates division/category/MRP
  from the catalog for `matched` rows, even if a non-matched row carries a stray
  `matchedPrayagCode`. **Why:** otherwise unmatched rows would pollute per-category
  breakdowns.

## Known data quality caveat
`avgPriceDiffPct` is hugely inflated (~1000%+) because some competitor rows store
per-piece prices in the wrong magnitude (lakhs). This is real source-data noise, not
a bug — the dashboard surfaces **median** gap (~44%) as the robust headline and keeps
the mean honest rather than silently clipping outliers.

## Shared filters
Every endpoint accepts the same query filters: `competitor` (repeatable array),
`division`, `category`, `matchConfidence`, `matchStatus`. They all flow through one
`getFilteredRows()` pipeline so behavior is identical across endpoints.
