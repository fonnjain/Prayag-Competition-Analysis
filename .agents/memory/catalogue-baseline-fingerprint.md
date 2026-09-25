---
name: Catalogue baseline fingerprint
description: Exact historical product-catalogue MD5 recipe needed to compare against the P045 baseline.
---

**Rule:** The historical P045 catalogue digest is `md5(string_agg(row_to_json(catalog_products)::text, '|' ORDER BY id))` over the complete selected product-row set. This recipe reproduced the previously reported `f927316a60c39d418e6d0754de08c555` only when two leaked price-editor test products were excluded; using a different selection of columns, delimiter, or ordering produces an incomparable digest.

**Why:** The old fingerprint was supplied without its formula. A new, reasonable-looking MD5 over product fields gave a different value even for the historical 6,946-row subset, making it easy to misdiagnose two extra rows as unrelated product changes.

**How to apply:** For future catalogue comparisons, use the exact recipe and state the selected row set. Keep the live catalogue and the historical fixture-excluded comparison separate. Do not delete test products merely to make the old hash reappear without explicit approval.