---
name: P042 Sales deletion proof
description: Safety boundary for deciding whether a catalogue product can be permanently deleted.
---

Require an authoritative, authenticated, per-code all-time Sales result **and** confirmed absence from the Sales catalogue before enabling product deletion. A fiscal-year snapshot, an empty response, a coverage field with unknown semantics, or an upstream timeout cannot establish that a code was never sold. The source-reviewed external Sales API requires one request per fiscal year, provides no authoritative fiscal-year inventory, and currently withholds FY2024–25 under a monthly-attribution hold. `catalogue_status` comes from a periodically synced Competition snapshot, not independent Sales-catalogue proof; do not use `absent` as a delete gate.

**Why:** The available Competition Sales client reads bounded fiscal-year snapshots. Direct calls to the known item endpoint timed out; source-reviewed documentation later established that there is no all-time mode and a held fiscal year makes a negative answer impossible even if other requests succeed. Treating a successful limited-period response or a stale synced catalogue flag as "never sold" risks deleting genuine products and their complete MRP histories.

**How to apply:** Keep destructive lifecycle endpoints unmounted and their UI hidden while this proof is unavailable. When an authoritative contract becomes available, verify its complete year inventory, held/unavailable periods, pagination and failure semantics before enabling deletion; then lock/recheck all local references in the apply transaction and add critical-path tests. Retirement is distinct from deletion and must preserve price history.