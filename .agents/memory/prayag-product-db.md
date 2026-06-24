---
name: Prayag Product Database app
description: Durable design rules for the standalone catalog/MRP-history app (separate from the Competition Console).
---

# Prayag Product Database

Standalone web app (artifact `prayag-product-db`, previewPath `/product-db/`) sharing the same api-server + single OpenAPI spec as the Competition Console. Catalog tables are namespaced (`catalog_products`, `mrp_price_history`, `code_conflicts`) to avoid colliding with the Console's `products`.

## Append-only MRP history
- Every MRP load INSERTs new `mrp_price_history` rows; old rows are never UPDATEd/DELETEd.
- Current MRP = latest `effective_date` row per `item_code`, marked `is_current=true` (recomputed after each load).
- Duplicate guard: one price row per `(item_code, effective_date)`. App-level dedup skips same code+date; a DB `uniqueIndex` on `(item_code, effective_date)` is the race-safe backstop.
- **Why:** the whole point of the app is auditable price history; losing old MRP defeats it. The unique index closes the concurrency gap the app-level check can't.
- **How to apply:** any new write path touching `mrp_price_history` must INSERT (never mutate prior rows) and tolerate the unique-constraint violation as "duplicate skipped", not a 500.

## React Query invalidation
- Invalidate with the generated Orval key helpers (`getGetCatalog*QueryKey()`), never hardcoded path strings.
- **Why:** a hardcoded `"/api/catalog/health"` typo silently no-ops invalidation (real key is `/api/catalog/data-health`); helpers stay correct across spec changes and Orval prefix-matches.
- **How to apply:** after any catalog mutation (load-mrp, reset), invalidate products + filters + data-health keys via the helpers.

## Filters gotcha
- The same category name can appear under multiple divisions; dedupe category names before rendering the Select or you get duplicate React keys/values. Backend filter param is a category *name*, so dedup is also semantically correct.
