---
name: MRP fixture provenance
description: Provenance rules for MRP history writers, application seeds, and database-backed tests.
---

Every active application writer and ordinary integration-test fixture must create or reuse an explicit MRP load batch and assign its ID to every history row it inserts.

**Why:** Several database-backed tests and the legacy catalogue seed could create rows without provenance. Interrupted suites left sentinel rows that made the global unbatched count unreliable even when normal load paths were correct.

**How to apply:** Treat a fixture load batch as part of setup and delete dependent provenance/history before deleting the batch in teardown. The catalogue seed creates an internal source snapshot and batch. Null linkage remains available only for isolated tests of legacy detection/reconciliation; never use it for ordinary fixtures or active writers.