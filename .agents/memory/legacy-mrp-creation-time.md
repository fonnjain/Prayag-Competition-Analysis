---
name: Legacy MRP creation-time provenance
description: How to label history rows whose original creation time cannot be established.
---

For retrospective MRP provenance, record the original creation time as unknown unless a trustworthy row-specific creation audit exists. Do not equate a price effective date, load date, or reconciliation time with the time the history row was created.

**Why:** The user explicitly chose “Record creation time as unknown” for legacy rows with no recorded timestamp. Existing history has no row creation timestamp; filling the gap with a plausible date would falsely state provenance.

**How to apply:** Keep the timestamp field nullable and distinguish the person performing the reconciliation from the original actor. Only associate a creation audit if it identifies the exact history row and represents the row’s initial insertion, not a later price correction.