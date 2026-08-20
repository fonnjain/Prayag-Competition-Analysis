---
name: Catalog baseline audits
description: How to handle a supplied MRP row-count baseline that conflicts with the live development catalogue.
---

Do not delete MRP history merely to force a supplied baseline count. First reconcile the known invalid-source key set and preserve rows that are not proven invalid by an official source manifest.

**Why:** A prior supplied expected total did not match the development catalogue, while the documented phantom sink keys had already been removed. Treating the target total as authoritative would have required deleting unproven price history.

**How to apply:** When counts diverge, compare the explicitly documented bad keys and the source-period data first. Report an unresolved baseline difference with its audit evidence; only make a data deletion when a source workbook or correction manifest identifies the exact affected rows.