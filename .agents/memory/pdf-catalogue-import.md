---
name: PDF catalogue import — staging system
description: Architecture decisions for the PDF catalogue import flow (task #60). Covers extraction, matching, staging, approve/discard, and price basis.
---

# PDF Catalogue Import Architecture

## Extraction
- Claude vision only (`claude-sonnet-4-5`) with `document` blocks (base64 PDF chunks ≤ 25 pages via pdf-lib).
- DO NOT use pdfjs text extraction for image-only catalogues — ₹ glyph is misread.
- Retry once on JSON parse failure (2s delay).
- Synchronous extract during POST /catalog/import-batches (no SSE/polling).
- Extraction takes 30–90 s; user sees a spinner.

## Code families (Sparsh Pearl Vol 6.2)
- Hardcoded in `artifacts/api-server/src/routes/importBatches.ts` as `SPARSH_CODE_FAMILIES`.
- Profile JSON at `artifacts/api-server/src/lib/catalogue-profiles/sparsh-pearl.json` (metadata only; code families in the route for now).

**Why:** Dynamic profiles for other brands are a follow-up (task not yet created).

## Matching engine (`lib/catalogueMatcher.ts`)
- Three signals: code (exact after normCode), size/variant (HARD GATE — reject if both sides specify a size that disagrees), description (word-overlap, soft flag).
- Alias table: `competitor_code_aliases`. Seeds 8 Sparsh Pearl aliases on first POST for that competitor.
- Alias match → always `needs_review` (user confirms the renumbering).
- WMP-188 case: master code WMP-188 (3 Mtr) aliased to WMP-189 in catalogue.

## Price basis
- New columns `price_basis` and `gst_pct` on `competitor_prices`.
- `effectivePrice()` in `lib/analysis.ts`: explicit basis takes priority, then falls back to checking the `unit` string (legacy compatibility, no backfill needed).
- Sparsh Pearl catalogues import as 'MRP' basis (no GST inflation).

## Staging tables
- `import_batches`: one row per upload, status: pending → approved | discarded.
- `competitor_price_staging`: extracted+matched items; nothing touches competitor_prices until approve.
- `competitor_code_aliases`: code renumbering aliases, unique on (competitor, old_code).

## Approve action
- Commits `ok` + `needs_review` rows only. `not_found` and `new_product` are skipped.
- Deletes existing rows for (competitor, effectiveDate) before inserting new ones.
- Writes desc+size matches back as aliases so future imports auto-detect the renumbering.
- Calls `recomputeCurrentFlags()` after transaction.

## Routing
- PDF → POST /catalog/import-batches → navigate to /import-review/:batchId
- Excel/CSV → POST /catalog/load-competitor (unchanged)
- Review screen at /import-review/:id in prayag-product-db app.

## TypeScript
- DB package exports via source `.ts` (no build step). Pre-existing api-zod dist issue (task #61) causes type errors in api-server tsc --noEmit but does NOT affect runtime (server uses esbuild bundle).
