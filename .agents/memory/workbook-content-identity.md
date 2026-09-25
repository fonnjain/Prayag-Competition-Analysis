---
name: Workbook content identity
description: Durable rules for gating trusted spreadsheet imports after harmless XLSX re-saves.
---

Authorize trusted spreadsheet loads using a canonical content fingerprint built from normalized business values, not the XLSX byte hash. Record both identities in provenance: the content fingerprint decides whether parsing may proceed, while the byte SHA-256 identifies the exact file received.

**Why:** XLSX files are ZIP containers whose timestamps and compression order change when re-saved even when every cell value is identical. Byte-hash authorization rejects valid files and encourages operators to bypass the safety gate.

**How to apply:** Enumerate worksheet names from the file before filtering or parsing; never let a prompt-supplied expected list become the enumeration mechanism. Define the canonical row projection, normalization, numeric formatting, sort order, delimiter, encoding, expected row count, and expected aggregate alongside each trusted loader. When dates vary by worksheet, validate an explicit sheet-to-date contract and carry the date on each staged row. Fail closed for damaged or extended source structures, preview before Apply, and make same-fingerprint retries idempotent.

When one comparison master holds several competitors, dispatch parsing by the explicitly selected brand *before* running another brand's positional or date audit. Select the price column and its date from that brand's group; never treat the first numeric price or another group's audited position as its price. A grouped or brand-qualified workbook without a trusted parser must be refused rather than sent to the generic importer. Existing truly undated single-brand sheets retain an operator-supplied date, which must be identified as such rather than claimed to come from the file.

**Why:** An Apollo preview once triggered Prince's March date guard against Apollo's August column. The Prince guard was correct; invoking it before brand scoping was the defect. A wrong-brand fallback could assign one supplier's prices or date to another.