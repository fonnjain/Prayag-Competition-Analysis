---
name: Names-only catalogue corrections
description: Durable safety boundary for bulk and single product-name corrections.
---

Product-name corrections are a separate names-only path. Bulk logical input contains only item code, old name, and new name; context and price-like workbook columns never enter the service. Single edits accept only item code, old name, new name, and reason.

**Why:** A stale workbook MRP previously blocked a valid rename even though the rename path must never write prices. Input-price equality is not the safety property; transactional invariants are.

**How to apply:** Keep bulk and single edits on the same audited preview/apply/undo path. Within apply and undo transactions, compare deterministic count-plus-checksum evidence for affected MRP history and exact competitor/Needs Review snapshots. Refuse and roll back if any evidence changes. Single edits may rename discontinued products, warn rather than block on duplicate names, and must enforce optimistic old-name concurrency.