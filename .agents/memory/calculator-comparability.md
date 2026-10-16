---
name: Calculator evidence comparability
description: Keep price-basis, physical-unit and colour-variant evidence distinct in calculator warnings.
---

Compare stored price basis with stored price basis and physical unit with physical unit. A composite display label is not a comparison key. Unknown evidence must not be treated as agreement, and a colour-variant warning is not a price-basis mismatch.

**Why:** Legacy competitor unit fields can contain a price-basis token such as MRP, while other imports record no unit or an explicit pipe length against Prayag's generic NOS. Calling every failure a different price basis hides these separate data-shape and evidence problems.

**How to apply:** Preserve raw metadata, use the same independent checks for the screen, export and read-only audits, and describe the actual failed check. Never infer pipe-length equivalence from NOS, convert prices, or repair stored metadata merely to suppress a warning.

Missing physical units and basis tokens in unit fields mean **unit not recorded**, shown as neutral information. Amber **units differ** requires two usable recorded units that disagree; show the competitor unit verbatim on the row.

**Why:** The user distinguishes absence of unit evidence from an actual disagreement; otherwise legacy metadata makes amber warnings too dense to be useful.

**How to apply:** Keep neutral notes separate from warning counts in both calculator summaries and exports. Report density under the actual composed company/personal bucket scope, not only across the unrestricted catalogue.
