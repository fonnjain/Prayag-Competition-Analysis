---
name: Catalogue baseline fingerprint
description: Canonicalization boundaries for historical catalogue and MRP value fingerprints.
---

**Rule:** The historical catalogue digest is `md5(string_agg(row_to_json(catalog_products)::text, '|' ORDER BY id))` over the complete selected product-row set. This recipe reproduced the previously reported `f927316a60c39d418e6d0754de08c555` only when two leaked price-editor test products were excluded; using a different selection of columns, delimiter, or ordering produces an incomparable digest.

**Why:** The old fingerprint was supplied without its formula. A new, reasonable-looking MD5 over product fields gave a different value even for the historical 6,946-row subset, making it easy to misdiagnose two extra rows as unrelated product changes.

**How to apply:** For future catalogue comparisons, use the exact recipe and state the selected row set. Keep the live catalogue and the historical fixture-excluded comparison separate. Do not delete test products merely to make the old hash reappear without explicit approval.

The separate MRP value-only SHA uses exact IEEE-754 bits, JSONB row strings,
bytewise sorting and LF joins, not decimal price text or whole-row JSON.

**Why:** Many plausible serializations produce different hashes for identical
stored values. Provenance-only changes must not alter the value digest.

**How to apply:** Find the existing MRP value-checksum definition in the reports
before querying; reuse it verbatim. Never guess a recipe or replace a published
fingerprint with a new serialization because its count matches.