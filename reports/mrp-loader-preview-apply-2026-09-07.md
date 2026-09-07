# MRP Loader Preview and Apply Report

## Result

The MRP loader now uses a durable two-step workflow:

1. **Preview upload** parses and validates the source once, detects duplicate checksums, and stores an immutable pending batch.
2. **Apply preview** writes that exact staged payload in one transaction after the reviewer confirms the displayed row and immediate-change counts.

Uploading alone does not create an MRP load batch and does not alter `catalog_products` or `mrp_price_history`.

## Preview contents

The retained preview shows:

- Move-triggered price changes that take effect immediately, first and prominently.
- Old/new values, effective periods, and largest absolute movements first.
- Revisions inside already-existing periods as a separate old/new list.
- Every source period, row count, new/existing status, and moved-in count.
- New product codes and catalogue products absent from the file.
- Discontinuation changes split into immediate and future.
- Protected-name conflicts.
- Rejected rows and a reason summary.
- A stated reason when nothing would change.

The preview URL contains its pending batch ID, so it can be reopened after reload. Applied and discarded previews remain viewable with actor and timestamp.

## Batch 17 replay

The signed v1 and v2 authoritative workbooks were replayed through the preview calculator:

- Standard product rows: **6,106**
- Price rows including variants: **6,256**
- Periods: **6**
- New products: **30**
- Rows moved into 2026-08-10: **495**
- Existing products changing price from those already-effective moves: **392**
- Same-period price revisions shown separately: **3**
- Protected-name conflicts: **11**

The six period counts are 2,409; 1,616; 865; 580; 475; and 161, matching production batch 17.

## Apply, discard, expiry, and idempotency

- Apply requires confirmation of the exact staged rows-to-write and immediate-price-change figures.
- Apply and Discard are mutually exclusive lifecycle transitions.
- A pending preview expires after 24 hours and cannot be applied.
- Discard records who discarded it and when; the preview remains available.
- Identical applied or still-pending source checksums are rejected before another pending batch is inserted.
- Expired pending records do not permanently block a fresh upload.
- Files whose parsed values already exist produce a disabled Apply action and a visible no-change explanation.
- The special discontinuation-correction workbook is rejected by this loader before mutation and directs the reviewer to its dedicated correction tool.

## Verification

- Focused API tests: **16 passed**
- Coverage includes upload-no-write, Apply-only-write, confirmation mismatch, pending and applied duplicates, no-change disabling, new-period marking, Discard retention, expiry, authoritative transaction behavior, and the batch-17 replay.
- API type-check: passed
- Product Database type-check: passed
- API and Product Database workflows restarted cleanly
- Browser console at the authenticated entry gate: clean