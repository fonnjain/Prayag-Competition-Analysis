---
name: Category backfill workbook boundary
description: The supplied category workbook may be older than the live catalog and should not be treated as a complete catalog snapshot.
---

The category workbook used for the Price Finder backfill contained 6,330 products, while the live catalog contained 6,736 products. All 5,883 workbook rows with categories matched and were applied; the remaining live blank categories include the workbook's 447 uncategorized rows plus 406 newer catalog rows absent from the workbook.

**Why:** Treating an older workbook as a full replacement would silently invent or overwrite classifications for products it does not contain.

**How to apply:** Before the next category import, compare workbook item codes with the live catalog and explicitly decide how to classify newer unmatched products.