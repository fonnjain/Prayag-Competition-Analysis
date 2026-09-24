---
name: P042 Sales deletion proof
description: Safety boundary for the three-valued Sales check in permanent product deletion.
---

The deletion check is three-valued: `sold` and `unknown` refuse deletion; only `never_sold` may pass the Sales check, still subject to the other local checks. Do **not** use `catalogue_status` as a gate: it comes from a periodically synced Competition snapshot, not independent Sales-catalogue proof. The fiscal-year Sales API supplies no authoritative year inventory and withholds FY2024–25 monthly data, so a negative answer from that API alone is `unknown`. An authenticated, complete all-time register response may establish `never_sold` when available.

**Why:** The available fiscal-year client reads bounded snapshots; it cannot prove that it searched every year or held month. Treating a partial result, timeout, or stale catalogue flag as "never sold" risks deleting genuine products and their price history. The later Competition-side contract explicitly removed catalogue-snapshot membership from the deletion decision, superseding the earlier proposed catalogue-absence prerequisite.

**How to apply:** Keep the destructive delete endpoint unmounted while a complete negative answer and atomic rechecks are unavailable; a read-only Sales check may show the coverage reason. Do not add a force flag or override. Once an authoritative contract is live, verify its complete coverage, pagination and failure semantics; then lock/recheck local references in the delete transaction and add critical-path tests. Retirement is distinct from deletion and preserves price history.