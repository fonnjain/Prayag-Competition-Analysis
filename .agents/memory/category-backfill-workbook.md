---
name: Category backfill workbook boundary
description: The supplied category workbook may be older than the live catalog and should not be treated as a complete catalog snapshot.
---

The category workbook used for the Price Finder backfill contained 6,330 products, while the live catalog contained 6,736 products. All 5,883 workbook rows with categories matched and were applied; the remaining live blank categories include the workbook's 447 uncategorized rows plus 406 newer catalog rows absent from the workbook.

**Why:** Treating an older workbook as a full replacement would silently invent or overwrite classifications for products it does not contain.

**How to apply:** Before the next category import, compare workbook item codes with the live catalog and explicitly decide how to classify newer unmatched products.

Do not assign categories to legacy catalog rows that have no MRP-history records. Keep those rows for referential integrity, but mark them inactive and require both an active catalog record and a non-null current MRP in Price Finder queries.

**Why:** These retained rows can be referenced by historical or future data but are not currently sellable products. Categorizing them would make unpriced items visible to counter-side lookup.

**How to apply:** Characterize no-MRP rows before changing them; report any competitor references separately. Do not delete them unless every foreign-key and historical-data dependency has been intentionally removed.