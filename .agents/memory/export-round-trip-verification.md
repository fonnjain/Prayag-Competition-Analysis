---
name: Export round-trip verification
description: Acceptance evidence for re-uploadable files and persisted display filters
---

Test every re-uploadable export with its exact downloaded bytes, including disclosure rows, through the actual importer. Check recovered identities, prices, and diagnostics—not only successful HTTP status or presence of a banner.

**Why:** The user explicitly raised this requirement before implementation and repeated it after download-only checks missed the gap. CSV and XLSX can behave differently because spreadsheet readers coerce their cell types differently. Disclosure rows must not become fictitious invalid product rows.

**How to apply:** Cover both file formats and each normal re-upload contract. Distinguish report-only downloads from supported upload templates. Compare against a no-disclosure control when identifying whether a failure was introduced by metadata.

Full-reload acceptance must include the initial visible aggregate counts as well as restored preference, banner, API population, and drilled-in prices.

**Why:** A genuine reload preserved the selected filter and scoped API responses but displayed full-catalogue division counts initially.

**How to apply:** Do not declare reload filtering complete based only on a persisted banner or a later category navigation.