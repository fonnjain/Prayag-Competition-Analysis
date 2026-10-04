---
name: Bucket-list product filtering safety
description: Display-only saved-product sets, export disclosure, and delayed Head Office seeding
---

Bucket lists are display-only saved product sets. They may not change any
catalogue classification, product, price, competitor data or Sales application.
They use one server-persisted active list per user across screens, not separate
remembered filters per page.

**Why:** The user identified a silently filtered report exported much later as
the central risk. Visible disclosure is more important than convenience.

**How to apply:** Every applicable product/comparison screen and every report
export must disclose the active list and its effect. Reuse the established admin
guard, normalised vocabulary comparison and approved Range division helper.
Capture and preserve catalogue classifications and MRP fingerprints in both
environments when implementing.

Head Office seeding is a separate step, not authorized by the supplied exclusion
workbook. The initial plumbing exclusions await Prayag rulings on A-464 and
PW55S before seeding.

**Why:** Pink competitor cells can indicate an incorrect pairing rather than
an instruction to exclude the Prayag product.

**How to apply:** Do not seed Head Office lists during the feature build or
silently resolve those two product decisions.