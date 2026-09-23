---
name: PPR pipe unit restatement
description: Durable period and unit semantics for the 90 PPR pipe products corrected under P033r3.
---

The 90 PPR pipe products are priced per 3-metre pipe. Their valid history consists of 2026-02-01 and 2026-08-10 only. The 2026-05-01 rows were a spurious period and must be deleted rather than restated or derived.

**Why:** Prayag confirmed that the source workbook defines only February and August. The May rows came from a superseded master and mixed February per-metre values with nine unrelated per-pipe values, so no authoritative May period exists.

**How to apply:** Preserve February and August values from the authoritative workbook, never compute them by multiplying stored prices, and treat any attempt to recreate or infer a May PPR period as a source-data error. Corrections must remain one reversible admin action with full deleted-row snapshots.