---
name: P042 Sales deletion proof
description: Safety boundary for deciding whether a catalogue product can be permanently deleted.
---

Require an authoritative, authenticated, per-code all-time Sales result **and** confirmed absence from the Sales catalogue before enabling product deletion. A fiscal-year snapshot, an empty response, a coverage field with unknown semantics, or an upstream timeout cannot establish that a code was never sold.

**Why:** The available Competition Sales client reads bounded fiscal-year snapshots. During the P042 investigation, direct calls to the known item endpoint timed out and its all-time/categorical contract could not be verified. Treating a successful limited-period response as "never sold" risks deleting genuine products and their complete MRP histories.

**How to apply:** Keep destructive lifecycle endpoints unmounted and their UI hidden while this proof is unavailable. When an authoritative contract becomes available, verify its coverage and failure semantics before enabling deletion; then lock/recheck all local references in the apply transaction and add critical-path tests. Retirement is distinct from deletion and must preserve price history.