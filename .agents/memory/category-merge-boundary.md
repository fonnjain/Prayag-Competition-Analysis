---
name: Category spelling merge boundary
description: Approved scope and approval rules for Category duplicates versus copied Range labels
---

Category spelling correction is separate from correcting Category values copied
from Range. Duplicate groups containing range-copy evidence must wait for the
Range-correction decision and receive no proposed spelling merge. Do not
partially merge a mixed group merely because one spelling has no Range.

Equality alone is not range-copy evidence outside the three exact approved Range
divisions: the master's series genuinely supplies Category there. Do not hold
Pipes, Hardware or Ceramic spelling groups merely because Category equals Range.
Within the approved scope, semantic review is still separate from a spelling merge;
“looks_like” recommendations are not approval to change stored values.

**Why:** The user expressly separated spelling cleanup from semantic
reclassification. Merging a value that should not be a Category would require
another relabeling and change category counts twice.

**How to apply:** Require Prayag's reviewed decision list before a later
Category-only preview/apply/undo. Preserve product identity, divisions, stored
Range and prices. Range and division spelling duplicates are report-only.
The unapproved merge workflow requires its own explicit approval. Never run Apply
as part of building or demonstrating that workflow; exercise write paths in
disposable schemas with private sequences.

**Blocking condition:** Category is included in the Sales catalogue feed.
No future merge may be applied until an explicit reviewed approval and a
Sales-side check confirm its effect. Record this prerequisite in any future
application merge code comments; a spelling guard is not merge approval.

**Why:** The user agreed that changing a Category affects Sales consumers,
not just Competition filters.

**How to apply:** Do not infer Sales compatibility from unchanged feed field
names. A prevention-only guard must reuse the shared vocabulary normalizer
without bulk rewriting existing spellings. Active CP products with capitalised
range names in Category and empty Range belong to semantic correction review,
not an automatic spelling merge.

The Sales check must name the consumer and field, distinguish pass-through or
discarding from grouping and exact-string joins/filters/mappings, and identify
which approved spellings are referenced. Distinguish catalogue Category from
competitor-row Category; they are separate feeds. A repository-source check is
not proof of the deployed Sales revision.

**Why:** The user requires the actual downstream dependency to decide whether a
case-only correction is safe or needs a coordinated Sales change.

Spelling prevention applies to newly created product codes only. Loads do not
fill null Category/division or replace an existing Category/Range/division.
For new products, match within the exact stored division and prefer the spelling
with more active products even when the submitted spelling exactly matches a
less-used alternative. Ties stop for review.

**Why:** The user approved prevention only, with P049's existing-product
classification boundary taking priority; equivalent text is not merge approval.

**How to apply:** Show input, proposed spelling, and every stored candidate/count
before normal administrator approval. Recheck the preview against current
counts. Signed corrections and historical undo snapshots must remain exact:
reject a spelling conflict instead of rewriting the signed or inverse value.