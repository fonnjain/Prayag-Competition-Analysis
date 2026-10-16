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
