---
name: MRP provenance constraint order
description: Required order for reconciling legacy null batch links and enforcing non-null provenance.
---

Do not publish a `NOT NULL` constraint for MRP history batch links while production still has legacy nulls. First publish the nullable reconciliation flow, preview production, wait for explicit approval of the affected count, apply through the admin flow, verify zero nulls, and only then add the constraint as a separate later schema change.

**Why:** A premature constraint migration would fail on existing production rows or invite an unsafe forced migration. The user expressly required a separate approval before the production data write.

**How to apply:** Check the live null count and pending schema diff before each publish. Never replace production data with development data to achieve the constraint.