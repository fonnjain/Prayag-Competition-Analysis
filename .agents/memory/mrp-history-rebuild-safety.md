---
name: MRP history rebuild safety
description: Durable rules for replacing Prayag price history from official all-period workbooks.
---

For source-of-truth MRP rebuilds, back up and verify the whole history table before replacing it; do not repair missing periods by adding isolated price rows.

**Why:** Price-history drift can include wrong effective dates and incomplete periods, so a clean official period load is more reliable and auditable than piecemeal corrections.

**How to apply:** Keep historical backup tables intact. If the development schema is behind the checked-in Drizzle schema, add only missing non-destructive columns rather than forcing a schema push that proposes deleting a verified backup table. Recompute current flags after the load and verify date-effective product withdrawals at query time.