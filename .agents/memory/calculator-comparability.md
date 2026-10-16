---
name: Calculator evidence comparability
description: Keep price-basis, physical-unit and colour-variant evidence distinct in calculator warnings.
---

Compare stored price basis with stored price basis and physical unit with physical unit. A composite display label is not a comparison key. Unknown evidence must not be treated as agreement, and a colour-variant warning is not a price-basis mismatch.

**Why:** Legacy competitor unit fields can contain a price-basis token such as MRP, while other imports record no unit or an explicit pipe length against Prayag's generic NOS. Calling every failure a different price basis hides these separate data-shape and evidence problems.

**How to apply:** Preserve raw metadata, use the same independent checks for the screen, export and read-only audits, and describe the actual failed check. Never infer pipe-length equivalence from NOS, convert prices, or repair stored metadata merely to suppress a warning.
