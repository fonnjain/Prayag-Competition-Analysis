---
name: Catalog baseline audits
description: How to handle a supplied MRP row-count baseline that conflicts with the live development catalogue.
---

Do not delete MRP history merely to force a supplied baseline count. First reconcile the known invalid-source key set and preserve rows that are not proven invalid by an official source manifest.

**Why:** A prior supplied expected total did not match the development catalogue, while the documented phantom sink keys had already been removed. Treating the target total as authoritative would have required deleting unproven price history.

**How to apply:** When counts diverge, compare the explicitly documented bad keys and the source-period data first. Report an unresolved baseline difference with its audit evidence; only make a data deletion when a source workbook or correction manifest identifies the exact affected rows.

Production-only single-product-editor additions can be legitimate. Prayag
explicitly accepted the audited set of fifty production price rows created on
2026-09-25/26 after their editor provenance was demonstrated.

**Why:** Environment totals need not match when real users have added products
in production. A count difference alone is not evidence of leaked fixtures.

**How to apply:** Retain approved editor additions. Reconcile provenance and
the exact row set before describing future differences as corruption; never
delete real production creations to force development/production parity.