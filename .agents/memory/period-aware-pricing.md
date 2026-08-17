---
name: Period-aware pricing
description: How Prayag MRP and competitor prices are resolved to "current" — the source-of-truth rule and helper locations.
---

# Period-aware pricing

## The rule
**is_current is a denormalised convenience flag, never the source of truth for what price is in force.**
All live price lookups use `DISTINCT ON (item_code) … WHERE effective_date <= :asOf ORDER BY effective_date DESC, id DESC`.
`:asOf` defaults to `todayString()` (YYYY-MM-DD, local calendar) when no period filter is selected.

**Why:** is_current only updates when recomputeCurrentFlags() runs — a future-dated row loaded today would immediately become "current" under the old flag approach.

## Key helpers (routes/analysis.ts)
- `todayString()` — returns today as YYYY-MM-DD
- `getPrayagCatalogMapForPeriod(atDate?)` — resolves Prayag MRP + upcoming MRP via two parallel DISTINCT ON queries (current ≤ asOf, upcoming > asOf)
- `getCompetitorRowsForPeriod(atDate?)` — matched rows via DISTINCT ON, unmatched via MAX(effective_date) JOIN, both ≤ resolvedDate

## Comparison.ts helpers (also date-driven now)
- `getPrayagMaps()` — DISTINCT ON WHERE effective_date <= today (was is_current = true)
- `getCatalogCandidates()` — same

## Competitor flag fix (lib/catalog.ts)
- `recomputeCompetitorCurrentFlags()` now has `AND effective_date <= CURRENT_DATE` on both the matched DISTINCT ON and the unmatched MAX() subquery

## Upcoming prices (Part 3)
- `PrayagInfo` has `upcomingMrp` / `upcomingMrpDate` (earliest revision AFTER asOf per item)
- `AnalysisRow` has `upcomingPrayagMrp` / `upcomingPrayagMrpDate`
- Opportunity table shows "↑ ₹X.XX w.e.f. YYYY-MM-DD" badge when upcoming exists
- Price history panel badges future-dated rows "Upcoming" (orange) vs past "Current" (grey)

## mrp-increases route
Changed from `WHERE is_current = true` to `ROW_NUMBER() OVER (…DESC) = 1` on rows pre-filtered to `effective_date <= CURRENT_DATE`.

## Remaining gap
`/analysis/mrp-increases` always uses CURRENT_DATE — task #82 tracks wiring it to effectivePeriod.
