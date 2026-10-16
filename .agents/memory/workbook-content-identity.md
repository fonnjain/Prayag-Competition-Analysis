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

Code-token canonicalization must respect the standing exact-code identity rule;
do not fold punctuation, whitespace or case into a workbook authorization token.

**Why:** Changing identity semantics changes the content digest even for the
same reviewed workbook bytes and unchanged price values. Treating that mismatch
as a changed price source, or bypassing it with a normalized lookup, is unsafe.

**How to apply:** Verify the exact previously reviewed source bytes before
reissuing a content digest under an exact-code serialization. Keep the byte
provenance unchanged; never rewrite historical batch identities or stored codes.

**Why:** A Jindal workbook's stated total matched one period, but its three independently dated columns contained more priced pairs in total.

An absent XLSX formula cache is not proof of an absent price. Use a cached numeric result when present, or explicitly compute only a verified formula from the selected brand's own source cells; otherwise refuse with a formula-specific reason. State when results were recomputed rather than cached.

**Why:** Astral per-metre PPR formulas had valid source prices but no cached results. Treating data-only blanks as missing prices would incorrectly remove coverage.

Before applying a new competitor workbook, confirm the chosen price unit against existing competitors. If they differ, stop and report; do not select a different price column or convert prices without explicit approval.

**Why:** Prayag required the Astral PPR unit check as an apply gate. Opposite formula directions can conceal a per-metre/per-pipe mismatch, while legacy stored unit labels may be blank or say only "MRP".

**How to apply:** Verify the stored numeric prices against their own source columns/formulas, rather than treating "MRP" as a length unit. A confirmed mismatch blocks the entire approved batch until the user gives further instructions.

Audit units across every selected sheet, not only PPR. Read the already-correct dated per-pipe column without converting adjacent per-metre values, and preserve each row's actual pipe length on mixed-length sheets.

**Why:** Prayag explicitly extended the Astral correction to every sheet. These workbooks include 5-m pipes and short SWR lengths as well as 3-m and 6-m pipes; forcing one unit per worksheet would misstate valid prices.

**How to apply:** Compare each represented length against existing stored/source evidence. Where there is no existing comparator, report that exception and the source-based unit choice honestly rather than claiming a verified match.

Prayag accepted Jindal PE-AL-PE fittings as **"each, no comparator, accepted on analysis"**. Preserve that qualification rather than relabelling the decision as a verified comparison against an existing competitor.

**Why:** The user confirmed these are individual fittings and supplied an independent 24% median spread, which did not indicate a 3x/6x unit mismatch.

**How to apply:** Keep this acceptance attached to the approved workbook's provenance; do not generalize it to other Jindal categories or later workbooks without checking their units.

Re-evaluate catalogue-based refusals in the destination environment. An approved development total is not a target to force onto production; load eligibility depends on the destination's actual catalogue.

**Why:** Prayag explicitly required reconsidering an Astral code refused only because it was absent from development, since production has a different catalogue.

**How to apply:** Retain genuine source-code/price refusals, independently check destination catalogue membership, report any resulting count difference, and compare production's pipe-price median gaps with the accepted development results before declaring the data live. A material discrepancy must be reported, not silently converted or concealed.