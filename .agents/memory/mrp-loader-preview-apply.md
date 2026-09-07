---
name: MRP preview and apply
description: Safety rules for staging, reviewing, applying, discarding, and expiring MRP uploads.
---

Uploading an MRP workbook must never alter catalogue products, MRP history, periods, discontinuations, or resolved prices. It creates an immutable pending preview; only an explicit Apply may write.

**Why:** A production authoritative upload changed hundreds of already-effective prices immediately without giving the reviewer a decision point. The higher-blast-radius loader must have at least the same gate as manual price revision.

**How to apply:** Detect duplicate source checksums before staging. Persist the validated parsed payload and decision summary for 24 hours. Apply that exact payload in one transaction only after confirming rows to write and immediate price changes. Preserve applied, discarded, and expired previews for audit.

For authoritative masters, keep move-triggered immediate price changes separate from revisions inside an already-existing effective period.

**Why:** The September 2026 v2 replay contains 392 existing products whose prices change because rows move into the already-effective 10 August period, plus three historical revisions inside the existing 1 August period. Combining them obscures the operational impact the reviewer is approving.

**How to apply:** Feature the move-triggered count first, but show same-period revisions separately with old/new values. Continue using each authoritative row's embedded effective date rather than the form date.