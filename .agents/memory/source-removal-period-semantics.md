---
name: Source removal period semantics
description: Rules for reconciling literal REMOVED markers with historical MRP rows during official workbook loads.
---

A numeric MRP in the same revision as a `REMOVED` marker is historical context, not evidence that the product remains live. Only a strictly later real price proves reintroduction; a live source occurrence in the same complete snapshot also keeps a shared code live.

**Why:** Source price lists can retain a last payable MRP alongside a withdrawal marker. Treating that same-period price as a reintroduction makes withdrawn products reappear, while ignoring later prices hides genuine reintroductions.

**How to apply:** Preserve removal observations from parsed source sheets, reconcile them with approved Standard-price history during the load transaction, and never globally clear withdrawal flags for a normal source upload. Versioned correction manifests still use the dedicated correction upload route.