---
name: Sanitaryware colour-variant pricing
description: Rules for the variant column added to mrp_price_history; every query that should only see Standard prices must filter it explicitly.
---

## Schema
- `mrp_price_history.variant TEXT NOT NULL DEFAULT 'Standard'`
- Unique index: `(item_code, effective_date, variant)` — three columns, not two.
- All pre-existing rows have `variant = 'Standard'`; sanitaryware colour rows have `variant IN ('Ivory', 'White with Jet', 'Pink / Green / Blue')`.

## recomputeCurrentFlags
`DISTINCT ON (item_code, variant)` — each colour gets its own `is_current = true` row.
The canonical implementation is in `artifacts/api-server/src/lib/catalog.ts`; two inline copies (catalogSync.ts and catalogImportExport.ts period-delete transaction) must stay in sync.

## Standard-only queries — required AND clause
Every query that resolves Prayag prices for comparison, analysis, or display must include `AND variant = 'Standard'` (or the Drizzle equivalent `eq(mrpPriceHistoryTable.variant, 'Standard')`). Files affected at time of implementation:
- analysis.ts, comparison.ts, catalog.ts, catalogImportExport.ts, priceFinder.ts

**Why:** After the schema change a DISTINCT ON (item_code) without the variant filter could return a colour-variant row instead of the Standard price, silently corrupting competitor-gap calculations.

## Manual correction upsert (catalog.ts)
The `onConflictDoUpdate` target must be the three-column index: `[itemCode, effectiveDate, variant]`. The inserted row must include `variant: 'Standard'`. The post-correction readback must add `eq(variant, 'Standard')` to avoid snapshotting a colour-variant MRP into competitor gaps.

## Price Finder API additions
- `colourVariantCount` (integer) on search/browse results — count of distinct non-Standard variants with a current approved price.
- `/price-finder/product/:itemCode` response includes `variants[]` — per-variant current + upcoming MRP (excludes Standard, which is shown in the main MRP card).

## Loader idempotency
`ON CONFLICT (item_code, effective_date, variant) DO NOTHING` makes re-runs safe. Use a script (Python + openpyxl → executeSql) when loading from Excel; the UI import flow only handles the sheet-detection path in parseSheet.

## persistParsedRows key
Changed from `byCode` (Map keyed by item_code) to `byCodeVariant` (Map keyed by `ITEMCODE__VARIANT`). The catalog_products insert/update must be guarded by a `processedItemCodes` set so a single product record isn't written N times (once per colour).

## Acceptance baselines (post-load, 2026-08-19)
- Total rows: 13,048 (12,750 Standard + 298 colour)
- Distinct codes: 6,303 (unchanged)
- analysis_products: 140, comparison_rows: 6,222, price_finder_products: 10,522 (all unchanged)
