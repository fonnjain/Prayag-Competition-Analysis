---
name: Bucket-list product filtering safety
description: Display-only saved-product sets, export disclosure, and delayed Head Office seeding
---

Bucket lists are display-only saved product sets. They may not change any
catalogue classification, product, price, competitor data or Sales application.
They use one optional server-persisted personal list per user across screens,
not separate remembered filters per page, plus at most one company-wide Head
Office list.

**Why:** The user identified a silently filtered report exported much later as
the central risk. Visible disclosure is more important than convenience.

**How to apply:** Every applicable product/comparison screen and every report
export must disclose the active list and its effect. Reuse the established admin
guard, normalised vocabulary comparison and approved Range division helper.
Capture and preserve catalogue classifications and MRP fingerprints in both
environments when implementing.

The Head Office layer always restricts first; the optional personal layer
restricts its survivors. Product and quote predicates compose independently
with intersection, never by merging definitions under one Included/Excluded
mode. Neither an admin nor a personal Included list can restore company
exclusions. Anonymous Price Finder also receives the company restriction, but
never a personal list or private enforcement history.

**Why:** The user explicitly made enforcement company-wide and forbade user
bypass. Treating two Included lists as a union, or dropping the company rule
when signed out, would violate that boundary.

**How to apply:** Only existing Everyone lists are eligible; enforce/release
need admin authority and typed reasons. Keep immutable event-time definitions,
resolved scope and counts so later edits cannot rewrite the explanation of an
old report. Confirm edits affecting an in-force list, including linked
originals; require release before deletion. Show company then personal in
headers/exports, and compute last-quote loss once over the combined predicates.
Show no inactive enforcement placeholder outside its management tab.

Saved names may literally be `Excluded` or end in `— Excluded`. Treat the name
as a name, never as type metadata. The interface shows name, type and effect as
separate elements; quieter controls must still make an active filter obvious.
Export disclosures remain full even when the on-screen control is shortened.
Use a quoted raw name and explicitly labelled type/effect parts in exports;
the user subsequently approved correcting the duplicated export wording too.

**Why:** The user reported duplicate type text in the global banner and stressed
that a silently filtered report is still the central risk.

**How to apply:** Preserve raw saved names and explicit type fields. Keep one
shared control and consistent Included/Excluded colours across screens, without
changing resolution or interpreting name suffixes. Preserve legacy disclosure
recognition for re-uploading old files, as well as the new labelled format.

Production bucket verification must not activate any list or change saved
preferences. Leave active-state visual checks requiring a selection to the user.

**Why:** The user explicitly prohibited production list activation and preference
changes during read-only confirmation.

**How to apply:** Inspect the existing state without selecting or clearing a
list. Do not treat a screenshot request as permission to write a preference.

Competitor rules filter prices without changing source products. Preserve each
screen's existing no-competitor display rule; do not add synthetic no-price rows.
Disclose the newly lost-last-quote count on every A–K screen and export as
“N products have no competitor price under this filter”; hide this line at zero.
The count excludes products that already lacked quotes and products removed
by the product bucket. Recompute every competitor-price
count, average, position, coverage measure and ranking from surviving quotes;
do not include a placeholder as a price or competitor SKU.

**Why:** The user corrected the earlier row-preservation requirement: filtered
products must behave like the thousands already omitted for lacking competitors,
but the new loss must be visible. Totals must never retain excluded quotes.

**How to apply:** Keep product membership and competitor-price selection
separate. Support additive competitor scopes using stored brand spellings and
the existing division/category vocabulary. Do not rewrite products, prices,
mappings, classifications or saved pricing-run evidence to apply a display filter.

Every A–K bucket control belongs in the page header, right-aligned on the same
row as the page title, visible without scrolling at 1366×768. No alternative
filter-bar or below-actions placement is allowed, including loading/empty/error
states and generator subviews.

**Why:** Production verification found three placements. The user replaced the
earlier two-placement allowance with this single rule, explicitly without exceptions.

**How to apply:** Reuse the shared title/control header layout. Keep subtitles,
actions, filter bars, summaries and metrics below that row; never duplicate the
control inside them. Verify all eleven screens by screenshots at the target size.

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

Editable rule ownership and resolved preview effects are separate.

**Why:** A correct aggregate preview can still show misleading inherited chips
or lose removable local chips when its combined rule list is treated as ownership.

**How to apply:** Derive removal controls from local definitions, inherited
labels from a real parent, and counts from the resolved union. Semantic
fingerprints must not be reused as positional rendering guards.