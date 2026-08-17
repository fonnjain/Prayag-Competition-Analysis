---
name: Period-aware pricing (effective-date feature)
description: Architecture decisions for the multi-period MRP + competitor price history feature.
---

## What was built
Competitor prices and Prayag MRP history are now period-aware. Each period is identified by an `effective_date`. Old periods are preserved (append-only). Analysis filters to a chosen period.

## Key decisions

**competitor_prices.is_current** — added column (boolean NOT NULL DEFAULT true). After each import, `recomputeCompetitorCurrentFlags(competitor)` sets:
- Matched rows: is_current=true only for the latest effective_date per (competitor, matched_prayag_code)
- Unmatched rows: is_current=true for all rows whose effective_date equals the max date for that competitor

**Default analysis view** — `getFilteredRows` without `effectivePeriod` uses `WHERE is_current = true` for both competitor prices and Prayag MRP (not a full table scan any more). With `effectivePeriod`, uses DISTINCT ON raw SQL.

**recomputeCurrentFlags (MRP)** — fixed to exclude future-dated rows: `WHERE effective_date <= CURRENT_DATE`. This ensures "Upcoming" (e.g., Sep 2026) rows never become is_current=true.

**Load competitor route** — now requires `effectiveDate` (YYYY-MM-DD) in the POST body. Deletes only (competitor, effectiveDate) rows — NOT all competitor rows. isCurrent=false on insert; recompute sets flags after.

**Upcoming rows** — loaded into mrp_price_history with is_current=false. Appear in period list and history panel but NOT in default comparison. The `/analysis/periods` endpoint flags them via `isFuturePeriod` map.

**period filter in analysis dashboard** — stored in DashboardFilters.effectivePeriod. Undefined = "Latest (auto)" = isCurrent=true path. A specific date = DISTINCT ON path.

**Why:**
Prayag needs to compare prices across historical periods (e.g., pre vs post price increase) and see upcoming prices (w.e.f. Sep 2026) without affecting current KPIs.

**How to apply:**
- Any new analysis endpoint that reads competitor/MRP data must call `getCompetitorRowsForPeriod(atDate)` and `getPrayagCatalogMapForPeriod(atDate)` (both in analysis.ts).
- Any new competitor import must include `effectiveDate` and call `recomputeCompetitorCurrentFlags` after.
- Never use `db.select().from(competitorPricesTable)` (all rows) in analysis — use the period-aware helpers.

## Data loaded (2026-08-17)
- 8,207 rows from `0_Prayag_Master_MultiPeriod_1786970660521.xlsx` sheet `mrp_price_history`
- Previous/Current/Upcoming status stored in `notes` column
- 1,989 Upcoming rows (2026-09-01) have is_current=false
- 6,595 rows are is_current=true across all mrp_price_history
