---
name: ERP division classification policy
description: Business meaning of composite divisions, the Sink division, and ERP mapping boundaries.
---

Pipe-joined divisions in the authoritative master represent which source sheets
contained a code, not commercial membership. The user rejected the proposed
multi-division membership model: each product has one business division, to be
assigned from a reviewed ERP-derived mapping.

**Why:** Source-sheet provenance leaked into classification; interpreting it as
commercial membership would preserve the wrong meaning in a new schema.

**How to apply:** Do not add membership tables or union-based division queries
to remediate these composites. Mapping omissions retain the existing division
and must be reported, not inferred.

Sink is a separate product division by business instruction dated 2026-10-16.
Its definition is ERP Master Group SINK: Item Types SINK, FLOOR TRAP and PLATE
RACK, including floor traps and plate racks deliberately. It has no separate
MRP workbook; its price source remains the PTMT workbook.

**Why:** Product classification and price-source division are different concepts.
The ERP-derived mapping is not a price source: the rate list has no effective
dates and its figures disagree with authoritative dated workbooks.

**How to apply:** Keep the product-division vocabulary separate from official MRP
sources. Division remediation must not read or change prices, change categories,
or act on EXCLUDE rows. Check saved division scopes before apply; require the
reviewed preview, provenance batch and guarded undo workflow.

The approved ERP exceptions retain the FERN line in CP (QUAA / FERN), manhole
covers in Pipes & Fittings, and the ball-cock/cistern-internals family in PTMT &
Plastic Fittings.

**Why:** The user rejected inconsistent ERP typing within these families.
Manhole covers are drainage products, not ceramic sanitaryware; the FERN and
ball-cock classifications follow consistent family identity and the existing
catalogue rather than isolated ERP outliers.

**How to apply:** Preserve these business exceptions when reviewing future ERP
mappings. Explicitly enumerated punctuation/case variants do not establish that
two stored products are identical. In particular, a mapping row calling a spaced
TTS code the same as an unspaced code must not override the known product-identity
distinction or silently expand an approved reclassification scope.

Production division remediation requires a real, explicitly scoped canary apply
and guarded Undo before the bulk apply. Push the reviewed code to GitHub before
production writes.

**Why:** The user requires exact production restoration and proof that no other
row changed; mocked browser writes alone are not production Undo evidence.

**How to apply:** Record the actual original values, apply only the authorized
canary codes through the app, then verify exact restoration and reversed history.
If the published loader cannot express that scope, stop rather than applying the
full mapping or bypassing its global final-state guards.
