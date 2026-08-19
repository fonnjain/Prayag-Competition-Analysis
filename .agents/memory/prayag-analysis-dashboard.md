---
name: Prayag Competition Analysis dashboard
description: How the /analysis dashboard computes competitor price gaps from existing tables, and the basis/sign rules that must stay consistent.
---

# Competition Analysis dashboard (@workspace/prayag-analysis, /analysis/)

A read-only analytics dashboard layered on the SAME tables the Console uses
(`catalog_products`, approved period-aware `mrp_price_history`, `competitor_prices`).
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
- **Gap MRP is period-aware, not a stored import snapshot.** Resolve the latest
  approved, non-null Prayag MRP in force on the chosen as-of date and join it to
  an active, non-discontinued catalog product. **Why:** the market report must
  reproduce the official price period after history rebuilds; the import snapshot
  is retained as provenance, not as the canonical gap input.
- **Population selection:** for each `(competitor, matched Prayag code)`, first
  require `match_status = "matched"` and a non-null price, then choose the latest
  revision on or before the as-of date. **Why:** a later row awaiting review must
  not silently erase an earlier confirmed price. Future, inactive, discontinued,
  unmatched, and null-price rows are excluded from gap aggregates.
- **Basis normalization:** explicit `price_basis = Ex-GST` uses row `gst_pct`
  (default 18%); legacy `unit = Rate (ex-GST)` uses 18%. Other rows are already
  MRP-comparable. Per-metre normalization is a comparison-row display aid and
  must never feed the official dashboard/report aggregate.
- **Comparability gate:** a price gap is computed only for the canonical
  population with a positive in-force Prayag MRP. Non-comparable rows still count
  toward coverage / match-quality but are excluded from gap stats.
- **Sign convention:** `priceDiff = competitorEffectivePrice − prayagMrp`;
  `prayagCheaper = competitorEffectivePrice > prayagMrp`. Positive diff% = Prayag
  cheaper = GREEN/good (margin headroom). Negative = Prayag costlier = RED threat.
  The frontend color language depends on this sign — do not flip it.
- **No catalog-attribute leakage:** `buildRow` only hydrates division/category
  (and the period-resolved MRP) for `matched` rows, even if a non-matched row carries a
  stray `matchedPrayagCode`. **Why:** otherwise unmatched rows would pollute
  per-category breakdowns.

## Nullable competitor price (verified mapping, MRP pending)
- `competitor_prices.price` is NULLABLE and `competitor_code` stores the rival's
  own catalogue number (e.g. Sparsh Pearl "ED-950"). A verified mapping may exist
  before the competitor's MRP is known — store the row with `price = NULL`, never
  `0`. **Why:** price 0 corrupts every gap stat; NULL rows are stored but excluded
  from all gap math (`comparable` requires a non-null competitor basis) while still
  counting toward coverage/match-quality.
- Null-price ripples are guarded in `lib/analysis.ts` (buildRow), both comparison
  matrix builders, per-metre normalization (`NO_NORM` short-circuit), and the
  by-product quote-candidate grouping (group kept, candidate skipped). OpenAPI
  `ComparisonRow.competitorPrice` and `MappingReviewRow.price` are `["number","null"]`.

## Headline numbers
As of the July 2026 erase-and-load, the DB holds ONLY the verified Prayag vs
Sparsh Pearl (PTMT) mapping: 150 competitor rows (all matched/High, all with
`prayag_mrp_at_compare`), 140 comparable (10 Black Pearl rows have null price),
median gap ≈ −1%, avg ≈ −1.6%, ~39% Prayag-cheaper. Categories = series names
(Black Pearl 67, Standard 20, Diamond 19, Cobra 18, Quadra 14, Vitro 12),
division "PTMT & Plastic Fittings". No auto-matching was used; gaps are always
computed live. (Earlier multi-brand load of ~3.2k rows was wiped on request.)

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
