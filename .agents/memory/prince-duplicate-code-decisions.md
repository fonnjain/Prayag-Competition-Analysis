---
name: Prince duplicate-code decisions
description: Durable adjudication rules for the four Prince duplicate competitor codes decided under P034r2.
---

P034r2 replaces P034. `SIM100150 → A-414` is the retained mapping; `SIM100150 → A-464` is excluded. Both `SIM200032 → A-86A` and `SIM200032 → A-86B` are excluded. `SIM103500` and `SIM103501` are confirmed valid one-to-many mappings.

**Why:** P034 had the A-414/A-464 decision reversed. The source master still contains all rows, so deletions alone would be undone by the next load.

**How to apply:** Persist exclusions by normalized Prince-code + Prayag-code pair, never row number. Recheck them during staging and approval, report them as excluded by decision, and use confirmations to clear duplicate-anomaly staging status for the four valid SWR mappings.