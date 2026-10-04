---
name: Export round-trip verification
description: Acceptance evidence for re-uploadable files and persisted display filters
---

Decode CSV evidence as UTF-8 text and remove an optional BOM before parsing it
as a string. Do not force SheetJS `codepage: 65001` on a BOM-bearing buffer.

**Why:** Forced codepage handling corrupted the leading quoted cell and Unicode
in an export-disclosure test. BOM-bearing and non-BOM CSV bytes need different
buffer detection; explicit UTF-8 text avoids a false formatter regression.

**How to apply:** Keep original download bytes untouched. Decode only the
verification copy, specify its CSV delimiter, and read XLSX as a binary buffer.

Test every re-uploadable export with its exact downloaded bytes, including disclosure rows, through the actual importer. Check recovered identities, prices, and diagnostics—not only successful HTTP status or presence of a banner.

**Why:** The user explicitly raised this requirement before implementation and repeated it after download-only checks missed the gap. CSV and XLSX can behave differently because spreadsheet readers coerce their cell types differently. Disclosure rows must not become fictitious invalid product rows.

**How to apply:** Cover both file formats and each normal re-upload contract. Distinguish report-only downloads from supported upload templates. Compare against a no-disclosure control when identifying whether a failure was introduced by metadata.

Include non-ASCII disclosure text in CSV round-trip tests.

**Why:** SheetJS can decode a UTF-8 CSV Buffer as a legacy code page when no encoding is supplied; an em dash and middle dot then become mojibake. The same banner matches correctly in XLSX but fails recognition in CSV.

**How to apply:** Verify the encoding contract using emitted bytes, not an already-decoded string. Silently ignore recognised metadata without deleting worksheet rows, so source-row provenance remains accurate.

Full-reload acceptance must include the initial visible aggregate counts as well as restored preference, banner, API population, and drilled-in prices.

**Why:** A genuine reload preserved the selected filter and scoped API responses but displayed full-catalogue division counts initially.

**How to apply:** Do not declare reload filtering complete based only on a persisted banner or a later category navigation.