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
- **Gap basis = persisted per-row MRP, NEVER a catalog lookup.** The competitor
  gap and the displayed "Prayag MRP" come ONLY from
  `competitor_prices.prayag_mrp_at_compare` (the period-matched `prayag_mrp` from
  the source sheet, snapshotted on the row at compare/import time). `buildRow`
  reads `c.prayagMrpAtCompare` for matched rows and null otherwise — it does NOT
  re-read `catalog_products` / `mrp_price_history` for the MRP. **Why:** the user
  wants each comparison frozen to the MRP that was in effect when the competitor
  sheet was matched, so it stays stable as the master catalog MRP later moves.
  The catalog (`mrp_price_history` is_current) is for the full-range catalog view
  (prayag-product-db) only. NOTE: `getPrayagCatalogMap` still selects `mrp` but
  that value is now unused by the gap — it only supplies division/category/name.
- **Every write path must populate `prayag_mrp_at_compare` for matched rows**, or
  those rows silently become non-comparable: (1) the verified-sheet reload loader
  stores the sheet's own `prayag_mrp`; (2) `POST /catalog/load-competitor`
  snapshots the catalog's current MRP at import time (raw sheets carry no Prayag
  MRP); (3) `loadCatalogSeed` (`lib/catalogSeed.ts`, the `/catalog/reset` path)
  snapshots the seed price-history's latest-effective MRP. Miss any one and a
  reset/import leaves matched rows with null MRP → excluded from all gap stats.
- **Basis normalization:** `competitor_prices.unit` trimmed === `"Rate (ex-GST)"`
  → multiply price by 1.18 (GST gross-up) before comparing; null/empty/anything
  else is treated as already MRP-comparable.
- **Comparability gate:** a price gap is computed ONLY when
  `match_status === "matched"` AND `prayagMrpAtCompare > 0` AND competitor price
  present. Non-comparable rows still count toward coverage / match-quality but are
  excluded from gap stats.
- **Sign convention:** `priceDiff = competitorEffectivePrice − prayagMrp`;
  `prayagCheaper = competitorEffectivePrice > prayagMrp`. Positive diff% = Prayag
  cheaper = GREEN/good (margin headroom). Negative = Prayag costlier = RED threat.
  The frontend color language depends on this sign — do not flip it.
- **No catalog-attribute leakage:** `buildRow` only hydrates division/category
  (and the per-row MRP) for `matched` rows, even if a non-matched row carries a
  stray `matchedPrayagCode`. **Why:** otherwise unmatched rows would pollute
  per-category breakdowns.

## Headline numbers
With gaps computed from the persisted per-row `prayag_mrp_at_compare`, the KPIs are
sane: ~3,218 comparable rows, ~52% Prayag-cheaper, avg gap ~+5%, median ~+1.5%.
(The earlier ~1000% avg / ~44% median inflation came from comparing against
mismatched-magnitude CATALOG MRPs; pinning each row to its own period-matched MRP
removed that noise.) Median is still the robust headline; the mean stays honest
rather than clipping the few legitimate large-spread rows.

## Shared filters
Every endpoint accepts the same query filters: `competitor` (repeatable array),
`division`, `category`, `matchConfidence`, `matchStatus`. They all flow through one
`getFilteredRows()` pipeline so behavior is identical across endpoints.

## Net-to-Net comparison mode (additive, never default)
- Two comparison bases live behind one `mode` query param (`mrp` default, `net`).
  MRP mode is untouched; net is purely additive. `buildRow` takes optional opts
  (defaults to mrp) so all pre-existing tests/callers keep MRP behavior.
- **Net math:** prayag_net = prayagMrpAtCompare × (1 − prayagDisc/100);
  comp_net = effectivePrice × (1 − compDisc/100); gap% = (comp_net − prayag_net)/
  prayag_net × 100. effectivePrice keeps the ex-GST×1.18 grossing, so net == mrp
  basis when there is no ex-GST row. **Key trick:** in net mode the NET values are
  written back into `prayagMrp` & `competitorEffectivePrice` on the row, so every
  downstream consumer (gapStats, opportunities, export, comparability gate) works
  unchanged — do NOT add a parallel net field.
- Gaps are computed live every request; nothing net is ever stored.
- **Discounts** live in `discount_settings` (scope unique; `prayag` global default
  5%, one row per competitor default 40%). `getDiscounts()` MUST backfill missing
  competitor scopes on EVERY call (not only when the table is empty) via
  onConflictDoNothing, or competitors imported after first seed never get a
  configurable row. PUT scope validation must trim BEFORE comparing to `prayag`,
  else `" prayag "` bypasses the guard and overwrites the global row.
- Frontend: segmented MRP/Net toggle in the dashboard header; `mode` rides inside
  the same filters object so all child hooks + export URL pick it up. Discount
  Settings page at `/settings/discounts`; saving invalidates all queries so net
  figures refresh.
