---
name: Apollo pipe provenance
description: Why Apollo's pipe references cannot seed or verify an import by code alone
---

Apollo pipe references in the comparison workbook are locally assigned, not Apollo SKUs. Apollo's pipe PDF quotes product families, size and prices without pipe item codes; fittings do carry supplier codes. Unpriced pipe entries in the workbook represent coverage gaps, not unpriced supplier products. Check for numeric zero prices as well as blanks: the original source has CPVC rows with 0.00 that the initial blank-only tally missed.

**Why:** A generated pipe reference was previously mistaken for a supplier identity, and two pipe categories reused the same prefix. Treating that reference as a matching key could produce parallel duplicate rows on a later catalogue.

**How to apply:** Preserve explicit origin on priced code rows. Match verified internal pipe rows by a non-empty, unambiguous normalized description-and-size identity; supplier fittings by their supplier code. Never infer origin for legacy records, invent a code for an unpriced row, or report a successful first/double load without an approved Apollo-to-Prayag mapping and an isolated end-to-end test. Keep any unresolved supplier-code price conflicts separate from internal-code collision fixes.