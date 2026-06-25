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

## Competitor comparison (diff% is INVERSE of the Console)
- Competitor prices live in `competitor_prices` (one row per competitor SKU; `matched_prayag_code` nullable, `match_status`). Loaded from seed on reset, plus a generic `POST /catalog/load-competitor` upload.
- **diff% convention here = `(PrayagCurrentMRP − CompPrice) / CompPrice × 100`, computed LIVE per request from current MRP — negative = Prayag cheaper = GREEN/good, positive = RED.** This is the *opposite sign* of the Competition Console's convention (there positive = Prayag cheaper). Do not copy the Console's formula.
- **Why:** the two apps genuinely use opposite sign conventions; mixing them silently flips every color and KPI.
- **How to apply:** never store diff%; join competitor rows to live current MRP via `normCode` and compute on the fly. Guard `competitorPrice > 0` (divide-by-zero) and null MRP → null diff.
- Canonical `match_status` enum is exactly `"matched"` | `"no match (review)"` — backend, PATCH validation, and the Mapping Review dropdown must all use these two. Mapping-review/review counts key off `status != "matched"`.
- Generic competitor upload is idempotent per competitor: it DELETEs that competitor's existing rows before inserting. Auto-match only trusts a fallback (non-header) code column if overlap ≥ max(5, 25% of rows), else leaves rows unmatched.

## Match confidence + side-by-side matrix
- Competitor rows carry an optional `match_confidence` (High/Medium/Low) text column. Seed source is the workbook's prebuilt Mapping sheet: High/Medium → matched (code set), Low/No-match → review (code null, Low keeps confidence). Exact-code uploads and manual PATCH matches default to "High".
- The provided Ashirvad↔Prayag mapping is **coarse/many-to-one**: ~1399 High+Medium mapping rows collapse to only ~373 distinct Prayag codes (many different competitor SKUs map to one Prayag code, e.g. several socket/coupler variants all → code 5721). This is the source data's nature, not a bug.
- **Side-by-side matrix** (`GET /catalog/comparison/matrix`) groups matched rows by `normCode` and keeps the **cheapest** competitor price per (Prayag code, competitor). Its `total` = distinct Prayag codes across all competitors (~431), which is correctly far smaller than the per-competitor matched-row counts (~1380 each).
- **Gotcha:** the comparison *list* endpoint caps `pageSize` at 200, so counting distinct codes from one page of `rows` undercounts wildly. Trust the matrix endpoint / DB for distinct-code counts, not a single list page.

## Fuzzy match suggestions (Mapping Review)
- `GET /catalog/mapping-review` embeds 1-3 `suggestions` per row (top Prayag catalog candidates) scored live in `artifacts/api-server/src/lib/suggest.ts`. Catalog candidates are built once per request and only the page's rows are scored — N×catalog is trivial. This is independent of `match_confidence` (the seeded High/Medium/Low column): suggestions are computed fresh for unmatched rows to help assign a code, confidence reflects existing/assigned matches.
- Scoring is a heuristic: weighted token overlap (digit tokens weight 2 — sizes/gauges are discriminative), category Jaccard, plus a size match boost. Catalog `size` is mostly null with the real size embedded in `productName`, so size matching falls back to substring search in the product text.
- **Limitation:** competitor descriptions are sparse ("Coupler (PN 16)") and sizes are bare numbers ("20"), so suggestions surface same-category candidates but can mis-rank (a pipe whose name contains "10 KG 20 mm" can outrank a coupler). Confidence labels (high≥55, medium≥35, low) communicate this; do not treat suggestions as authoritative.
- Accepting a suggestion in the UI calls the existing PATCH with `matchStatus:"matched"`; there is no separate accept endpoint.

## Competitor price basis is NOT normalized
- Different competitors can quote on different bases: Prayag + Ashirvad are MRP, but Astral is "Rate (ex-GST)". There is no per-row basis field — the basis label is stashed in `competitor_prices.unit` (e.g. "Rate (ex-GST)") purely for display/export transparency.
- diff% and all KPIs compare Prayag MRP directly against the competitor price **with no basis adjustment**. This is intentional: each mapping workbook's own `price_diff` column already computes `PrayagMRP − CompPrice` directly (no GST gross-up), so we match the provider's intent.
- **Why:** changing the comparison to gross-up ex-GST → MRP-equivalent would silently diverge from the source file's numbers and surprise the user. Adding a new competitor is a pure data change (append to `competitor-seed.json`); no schema/API/frontend edits needed because the generic shape + multi-competitor UI already exist.
- **How to apply:** when adding a competitor, follow the High/Medium→matched (code must exist in catalog via `normCode`), Low→review-keeps-Low, No-match→review-null rules; set `unit` to the file's `price_basis`. Caveat for any future cross-competitor analytics: they are not basis-comparable (MRP vs ex-GST).
- **Gotcha:** the seed JSON is imported at api-server startup, so after editing `competitor-seed.json` you must restart the api-server workflow AND then `POST /catalog/reset` (which runs `loadCatalogSeed` = full wipe+reseed of catalog+competitor from the JSONs) for the DB to pick up new rows. Reset is the only path that reloads seed data.
- **Multi-brand source file → seed mapping:** the authoritative competitor data is a single workbook with `Prayag` + `Mapping` sheets; `Mapping` stacks all brands (currently Ashirvad/Astral/Hindware) keyed by `competitor`. Column map to seed: `competitor_group`→category, `competitor_product`→description, `competitor_size_inch`→size, `competitor_price`→price, `price_basis`→unit but **MRP stays null** (only non-MRP labels like "Rate (ex-GST)" are stored, for the GST-transparency caption). Status rules: High/Medium → matched **only if** `normCode(prayag_code)` exists in catalog else review; Low → review keeps Low; "No match"/blank → review null. **Prince is NOT in this workbook** — it lives only in the seed, so regenerating from the workbook must preserve existing Prince rows and replace only the workbook's brands.
- **Hindware is segment-level only** (sanitaryware/branded faucets: basins, toilets, urinals): most rows are "No match"; matched ones map many competitor SKUs to one Prayag code at TYPE level (e.g. several basins → code 4790), so its diff% is a coarse segment comparison, not SKU-equivalent. Treat Hindware comparisons as directional.

## Per-metre length normalization (effective diff is authoritative)
- Length-based SKUs are normalized to a common per-metre basis before comparing: feet→metre via `1 ft = 0.3048`; pack lengths ("3 Mtr"/"6 Mtr") divide price by length. Prayag MRP is per-piece but scales linearly with pack length, so per-metre is valid. Computed LIVE, additive — no schema change.
- `'` in a size means **inch, not feet**; only the words ft/feet/foot mean feet. Multi-length forms like "3 & 5 mtr" (& / and / , / +) are **ambiguous**, not a single length → flagged for manual review, excluded from KPIs and ranking.
- Each row carries both raw (`diffPct`/`prayagCheaper`) and per-metre `effectiveDiffPct`/`effectivePrayagCheaper`. **`effective*` is the authoritative comparison; raw is display-only.** They diverge only when Prayag and the competitor quote on *different* length bases.
- **Why:** any filter/KPI that branches on the raw `prayagCheaper` silently ignores normalization and can return wrong rows (caught in review: `expensiveOnly` was filtering on raw `prayagCheaper`).
- **How to apply:** any server filter, KPI, or color decision on length-comparable rows must use `effectivePrayagCheaper`/`effectiveDiffPct`, never raw. Frontend badge green = `diffPct <= 0` (≤0 = Prayag cheaper). The unused `/matrix` endpoint is intentionally left non-normalized.

## Filters gotcha
- The same category name can appear under multiple divisions; dedupe category names before rendering the Select or you get duplicate React keys/values. Backend filter param is a category *name*, so dedup is also semantically correct.

## Consolidated MRP loads (per-row effective dates)
- The seed loaded all prices with a single blanket `effective_date = 2026-05-01`. Real MRP files carry **per-row** effective dates that differ by division (e.g. PTMT 2026-04-20, Hardware 2026-03-01, CP/Pipe/Sanitary 2026-05-01).
- **Limitation:** the in-app Load MRP route applies ONE effective date to the whole upload and auto-creates new products with null metadata. It does NOT read per-row dates. For a structured consolidated file (columns item_code/product_name/division/category/mrp/price_basis/effective_date/...), a dedicated loader is needed instead of the UI.
- **How a consolidated load was done:** one-off esbuild-bundled node script importing `@workspace/db` + xlsx, INSERT with `onConflictDoNothing` on `(item_code, effective_date)` (idempotent — re-run inserts 0), match existing by `normCode` (trim+upper+strip-spaces), create only truly-new codes, then recompute is_current. Bundle needs the `createRequire` banner or xlsx's dynamic `require("stream")` fails.
- **is_current = latest effective_date (NOT latest load_date).** Consequence: if a product was already seeded at 2026-05-01, a file row dated 2026-04-20/03-01 is preserved but does NOT become current. This is correct per spec but surprises users who expect "newest load wins".
- **Persistent pending after a full load are real data gaps, not bugs:** catalog-only codes absent from the MRP file — conflict-split variants (`145-LSB-V1`/`-V2` where the file uses the original `145-LSB`), "Series" placeholder rows, and spacing near-duplicates (`DB-02 L` vs `DB-02L`, both normalize equal so only one gets history).
