# Four Open Items — Verification and Implementation Report

## 1. Administrative access

### State found before this change

Commits landed after the original issue was recorded. The current server already applies:

- A full-workspace `requireAuth` and workspace-read guard before mounting the catalogue, import, sync, batch, and API-key routers.
- Inline `requireAdmin` on every write in `catalogImportExport`.
- A router-wide `requireAdmin` on `catalogSync`.
- Inline `requireAdmin` on import-batch upload, approval, and deletion.
- A router-wide `requireAdmin` on `apiKeys`.
- Inline `requireAdmin` on catalogue mutations while leaving catalogue reads available to ordinary authenticated users.

No authorization implementation change was needed. Direct full-router tests already prove:

- Anonymous administrative requests return **401**.
- Authenticated non-admin requests return **403**.
- Admin requests pass authorization and reach normal route validation.
- Ordinary users can read the catalogue, comparison filters, and analysis data.

### Endpoint classification

#### Catalogue import/export

Reads:

- `GET /catalog/mrp-loads/:batchId` — admin because pending-load audit data is administrative.
- `GET /catalog/export`
- `GET /catalog/competitor-brands`
- `GET /catalog/mrp-periods`

Writes or administrative staging:

- `POST /catalog/load-mrp`
- `POST /catalog/mrp-loads/:batchId/apply`
- `POST /catalog/mrp-loads/:batchId/discard`
- `POST /catalog/mrp-review-batches/:batchId/approve`
- `POST /catalog/mrp-review-batches/:batchId/cancel`
- `POST /catalog/preview-competitor`
- `POST /catalog/load-competitor`
- `DELETE /catalog/mrp-period/:date`
- `PATCH /catalog/mrp-period-date`
- `PATCH /catalog/competitor-period-date`

#### Catalogue sync

Reads:

- `GET /catalog/sync/status`
- `GET /catalog/sync/export`

Administrative staging/writes:

- `POST /catalog/sync/preflight`
- `POST /catalog/sync/apply`

The whole sync surface remains admin-only because it exposes production reconciliation state and apply tokens.

#### Import batches

Reads:

- `GET /catalog/import-batches`
- `GET /catalog/import-batches/:id`
- `GET /catalog/import-batches/:id/export`

Writes:

- `POST /catalog/import-batches`
- `POST /catalog/import-batches/:id/approve`
- `DELETE /catalog/import-batches/:id`

#### API keys

Read:

- `GET /keys`

Writes:

- `POST /keys`
- `POST /keys/:id/revoke`
- `DELETE /keys/:id`

The whole API-key surface remains admin-only because even key metadata is administrative.

#### Core catalogue

Reads retained for ordinary authenticated users:

- Product list/detail, filters, MRP sources, MRP provenance, and data-health endpoints.

Admin-only writes:

- Variant-provenance reconciliation
- Manual MRP changes
- Variant-price seeding
- Catalogue reset

## 2. PE-AL-PE numeric-column extraction

This parser defect was already fixed by an intervening commit and was verified rather than reimplemented.

The old header exclusion checked words such as `weight`, `kg`, `cost`, and `packing`. It missed the failing PE-AL-PE row because the numeric columns had blank headers. With no token to reject, the former mostly-numeric fallback selected the rightmost measurement (`0.552`) as price.

The current loader accepts a price column only when:

- Its header explicitly identifies MRP, price, Net, or rate; or
- A dated header identifies an effective-period price column.

Otherwise, numeric values to the right of a code are left unpriced and the row is reported for review.

The historical source layout inventory identifies the same risky shape in:

- `PE-AL-PE FITTINGS-2`
- `PPR PIPE`

The original workbooks containing those sheets are not among the current attached XLSX assets, so this identification comes from the retained source-rebuild inventory rather than a fresh binary scan. The fix is shape-based and covers any sheet with unlabeled numeric columns, not only those two names.

Regression tests use the exact `PEA-64B`/`PEA-325B` shape and prove that bare numeric columns produce no price, while an explicit MRP column is selected correctly.

## 3. Exact `newCodes`

The authoritative loader previously built `newCodes` from an early `INSERT ... DO NOTHING RETURNING` step and then performed a separate final upsert.

It now:

1. Captures the exact catalogue item-code set before the authoritative upsert.
2. Performs the final upsert.
3. Reads the exact final catalogue item-code set.
4. Reports `final − before`, sorted.

The report therefore uses the same final catalogue identities as the before/after row count. Integration tests assert:

- Exact set equality between `newCodes` and the final-state set difference.
- No duplicate reported codes.
- `newCodes.length === after.catalog_rows - before.catalog_rows`.
- `EP-GANESHA` is included.

## 4. MRP provenance

### Paths found

The active non-test omission was the legacy catalogue seed. It inserted MRP history and provenance events without a load batch.

Ordinary test-fixture omissions were found in 11 suites, including the market-gap, future-period, MRP-increase, opaque-code, price-finder, status, manual-MRP, and SINK fixtures. The `__MRP_REVIEW_*__` fixtures were already batch-backed.

### Closure

- The catalogue seed now creates an internal source snapshot and load batch using a SHA-256 of its checked-in price payload, then assigns that batch to every inserted history row and provenance event.
- A shared test helper creates explicit fixture batches.
- All ordinary fixture history inserts in the 11 affected suites now carry that batch ID and clean it up after dependent rows.
- Null linkage remains only for the isolated tests that deliberately exercise legacy detection and reconciliation.

### Invariant verification

Before and after the suite:

- Development: **14,092 history rows, 0 unbatched**
- Production: **14,089 history rows, 0 unbatched**

## Price immutability

The price/status fingerprints were identical before and after all changes and test execution:

- Development: `7fdd94601926d9413c797fd99fcba0db`
- Production: `b01416e832dc2eba48168d944f2b2e0c`

No price, gap, or ranking value was changed by this work.

## Verification

Passed:

- Shared-library and API type-checks.
- Full-stack authorization acceptance tests.
- Bare-numeric/PEA parser tests.
- MRP preview/apply lifecycle tests.
- Authoritative transaction suite: **4/4**.
- The repaired fixture suites that do not depend on historical development counts.
- Diff whitespace validation.

The serial broad run produced **137 passing tests** before the final authoritative fix; the authoritative suite then passed **4/4** on rerun. Four unrelated dataset-sensitive areas still contain five pre-existing failures:

- One future-period analysis expectation.
- One provenance-note test encountering duplicate historical authoritative checksums.
- Two SINK assertions pinned to older withdrawal/load-row counts.

These failures were not caused by price or ranking changes in this task and were not broadened into unrelated fixes.