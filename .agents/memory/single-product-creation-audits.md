---
name: Single-product creation audits
description: Production-compatible audit semantics for manual product creation, undo, and deactivation.
---

Manual product creation and deactivation must use `operation_type = save`, distinguished by the audit series `Product creation` and `Product deactivation`. Undo remains `operation_type = reversal`.

**Why:** The production audit table has an established check constraint allowing only `save` and `reversal`. Expanding that constraint was not reliably reproducible through the schema push workflow and would create a deployment hazard without adding necessary behavior.

**How to apply:** When identifying a creation or deactivation audit, check both operation type and series. Do not introduce new operation-type values for these actions unless a tested production migration explicitly replaces the existing constraint.