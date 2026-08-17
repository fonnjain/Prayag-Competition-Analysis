---
name: PDF catalogue import
description: How the Sparsh Pearl PDF catalogue is extracted and staged — profile-based page selection, coverage verification, retry logic, and auth.
---

# PDF catalogue import

## Auth fix
Raw `fetch()` calls in `import-competitor.tsx` and `import-review.tsx` bypassed `@workspace/api-client-react`'s Bearer token system. Fix: `getAuthHeaders()` helper (reads `prayag_sid` from localStorage) injected into every fetch call on those pages.

## Profile-based extraction (current approach — DO NOT revert to full PDF)
The full Sparsh Pearl catalogue is 108 pages / ~12 MB. Only 16 pages carry mapped products. `catalogueProfile.ts` defines the profile type and helpers:
- `profilePages(profile)` → sorted deduplicated page list from seriesMap
- `extractPages(src, pages1Based)` → sub-PDF Buffer + pageMap (index → original 1-based page)
- `widenedPages(base, margin, pageCount)` → widened set for low-coverage retry
- `seriesWithNoItems(profile, foundPrefixes)` → series names with no items extracted

`pdfExtractor.ts` uses the profile when provided:
1. Builds a 16-page, ~2 MB sub-PDF (vs 108 pages, ~12 MB)
2. Sends to Claude in ONE request (16 pages < MAX_PAGES_PER_REQUEST = 25)
3. Translates page numbers: `originalPage = pageMap[chunk.startPage - 1 + reportedPage - 1]`
   (model reports 1-based position within the chunk mini-PDF; we translate to original catalogue page)
4. Computes coverage = resolved targets / total targets
5. If coverage < 95%: widens by ±2, retries once; warns if still < 95% naming empty series

## Model
`claude-opus-5` — all chunks were failing with "Unexpected end of JSON input" before the profile fix.
The diagnostic logging (chunk response content_blocks, types, first 200 chars) remains in place.
If the model returns no text block, it's treated as 0 items (not a failure).

## Coverage in response
`rowCounts` JSON extended with `pagesSent`, `pagesWidened`, `coverage` (0.0–1.0).
SSE `done` event includes `coverageWarning` string (non-null when coverage < 95%).

## Staging / approve flow
- POST /catalog/import-batches: SSE stream (stages to competitor_price_staging)
- GET /catalog/import-batches/:id: batch + staged rows
- POST /catalog/import-batches/:id/approve: commits to competitor_prices
- Aliases are seeded from SPARSH_ALIASES in importBatches.ts on each upload

## Profile file
`artifacts/api-server/src/lib/catalogue-profiles/sparsh-pearl.json`
16 pages: 18, 19, 24, 25, 26, 27, 34, 35, 38, 39, 64, 65, 83, 84, 96, 97

## Key constraint
The production `.replit.app` URL uses the last-deployed `dist/index.mjs`. After code changes, the user must test via the Replit dev preview (not `.replit.app`) until the app is redeployed.
