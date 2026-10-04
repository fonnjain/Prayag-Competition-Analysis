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

The approved scope is inventory A–K only. Maintenance/audit surfaces L–T stay
unfiltered and say “Bucket lists do not apply here.” Machine APIs and signed
full-catalogue snapshots also remain unfiltered.

**Why:** The user explicitly narrowed filtering to browse/comparison/report
surfaces; maintenance membership must not silently shrink.

**How to apply:** Keep the boundary explicit when adding routes or exports.
Distinguish immutable full-scope audit counts from filtered display totals.

Bucket browse/editor pages belong in Price Finder and both require sign-in.
Anonymous Price Finder prices remain public, without an active bucket. Do not
carve a bucket exception into the Product Database access gate.

**Why:** This was the user's explicit page-placement and access decision.

**How to apply:** Preserve that separation in navigation, route guards and
future authentication changes.

Membership archives must never resurrect a parent removal in a linked child.
Saved pricing runs may be projected for display but must not be repriced or
rewritten when a bucket changes.

**Why:** Inheritance follows current parent membership; buckets are display-only,
not a second pricing-policy or historical-run writer.

**How to apply:** Treat inherited membership as inherited, preserve immutable
run evidence, and aggregate visible frozen results without reevaluating prices.

Head Office seeding is a separate step, not authorized by the supplied exclusion
workbook. The initial plumbing exclusions await Prayag rulings on A-464 and
PW55S before seeding.

**Why:** Pink competitor cells can indicate an incorrect pairing rather than
an instruction to exclude the Prayag product.

**How to apply:** Do not seed Head Office lists during the feature build or
silently resolve those two product decisions.