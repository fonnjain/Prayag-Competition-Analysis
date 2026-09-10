---
name: Single-row price edit safety
description: Transaction and reversal rules for interactive Prayag or competitor price corrections.
---

Serialize interactive price edits by product and price series. The one-row price mutation, current-flag recomputation, and immutable audit insert must share one database transaction.

**Why:** A convenient single-row editor makes concurrent corrections and reversals more likely. If recomputation or auditing occurs after commit, the API can report failure after changing live prices. An old reversal can also overwrite a newer correction unless the target value is checked.

**How to apply:** Lock the exact correction row and use a transaction-scoped product/series lock when no row exists yet. Require exactly one target-row mutation. Undo only while the target still equals the audited new value, keep the original audit, and record one uniquely linked reversal.