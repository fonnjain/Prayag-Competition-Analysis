---
name: Workbook content identity
description: Durable rules for gating trusted spreadsheet imports after harmless XLSX re-saves.
---

Authorize trusted spreadsheet loads using a canonical content fingerprint built from normalized business values, not the XLSX byte hash. Record both identities in provenance: the content fingerprint decides whether parsing may proceed, while the byte SHA-256 identifies the exact file received.

**Why:** XLSX files are ZIP containers whose timestamps and compression order change when re-saved even when every cell value is identical. Byte-hash authorization rejects valid files and encourages operators to bypass the safety gate.

**How to apply:** Enumerate worksheet names from the file before filtering or parsing; never let a prompt-supplied expected list become the enumeration mechanism. Define the canonical row projection, normalization, numeric formatting, sort order, delimiter, encoding, expected row count, and expected aggregate alongside each trusted loader. When dates vary by worksheet, validate an explicit sheet-to-date contract and carry the date on each staged row. Fail closed for damaged or extended source structures, preview before Apply, and make same-fingerprint retries idempotent.

When one comparison master holds several competitors, dispatch parsing by the explicitly selected brand *before* running another brand's positional or date audit. Select the price column and its date from that brand's group; never treat the first numeric price or another group's audited position as its price. A grouped or brand-qualified workbook without a trusted parser must be refused rather than sent to the generic importer. Existing truly undated single-brand sheets retain an operator-supplied date, which must be identified as such rather than claimed to come from the file.

**Why:** An Apollo preview once triggered Prince's March date guard against Apollo's August column. The Prince guard was correct; invoking it before brand scoping was the defect. A wrong-brand fallback could assign one supplier's prices or date to another.

For multi-period previews, distinguish unique products from priced product-period pairs. Compare the requested total with the full period-aware load count, and stop on a discrepancy; never discard older periods to match a stated total.

**Why:** A Jindal workbook's stated total matched one period, but its three independently dated columns contained more priced pairs in total.

An absent XLSX formula cache is not proof of an absent price. Use a cached numeric result when present, or explicitly compute only a verified formula from the selected brand's own source cells; otherwise refuse with a formula-specific reason. State when results were recomputed rather than cached.

**Why:** Astral per-metre PPR formulas had valid source prices but no cached results. Treating data-only blanks as missing prices would incorrectly remove coverage.

Before applying a new competitor workbook, confirm the chosen price unit against existing competitors. If they differ, stop and report; do not select a different price column or convert prices without explicit approval.

**Why:** Prayag required the Astral PPR unit check as an apply gate. Opposite formula directions can conceal a per-metre/per-pipe mismatch, while legacy stored unit labels may be blank or say only "MRP".

**How to apply:** Verify the stored numeric prices against their own source columns/formulas, rather than treating "MRP" as a length unit. A confirmed mismatch blocks the entire approved batch until the user gives further instructions.