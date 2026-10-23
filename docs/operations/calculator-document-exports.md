# Calculator Excel and PDF exports

## Scope

Presentation-only revision of calculator exports. Arithmetic, unit-first rounding,
raw product identity, provenance and unrestricted quoting scope are unchanged.
No migration, price load, catalogue update, classification change or production
operation is part of this work.

## In the app

Open Calculator → Final Summary:

- **Export Excel** downloads `Comparison`, `Summary`, `Data`, in that order.
- **Download PDF** generates an A4 text document. It does not invoke browser print,
  so no browser header/footer setting is required.
- Both actions retain the existing read-only export endpoint. The optional
  `format` request field is `xlsx` (the backwards-compatible default) or `pdf`.
  Evidence is re-resolved on the server; client-supplied totals are never trusted.

### Excel

`Comparison` has the ten reference columns, grouped product rows, indented
competitors, signed meaning-coloured percentages and the explicit Source column.
The amber assertion banner is above the table; disclosures are below it. The
header is frozen and repeats when printed landscape, fit-to-width. Gridlines are
hidden. Ordinary quotes retain reference widths
`11,42,13,8,13,6,15,17,9,34`; larger numeric values widen their columns rather
than displaying `####`.

`Summary` contains basket facts, same-subset brand totals, the unabridged coverage
sentence below each brand, the denominator explanation and a clean product/brand
matrix. The matrix no longer interleaves per-brand provenance columns.

`Data` preserves all 32 original audit columns, in order, including both
overridden app values, both provenance states, ad-hoc flags and separate warning
and information fields. It has explicit widths, a styled frozen header and an
autofilter. Currency and percentages remain numeric cells with Indian currency
formatting and `0.0%` respectively.

### PDF

The document includes date/counts, the assertion banner, product comparisons,
Source values, row evidence notes, edited prices' overridden app MRPs, same-subset
brand totals/coverage, and disclosures. Signed differences are green for a higher
competitor and red for a lower competitor. Product blocks are measured before
page placement, so a page break never splits one.

Fonts are embedded from declared package dependencies; no network access or
workstation font installation is required. Latin, extended Latin (including ₹),
Greek and Cyrillic subsets are available. Unsupported characters are refused
with an explicit Excel alternative rather than silently disappearing. A product
block longer than a whole A4 page is also refused explicitly rather than clipped.

## Verification

- Full workspace typecheck passed; API typecheck passed after the final test-only
  assertions were added.
- API calculator suite: **17 passed**. Finder regressions: **53 passed**.
  Formatting regressions: **7 passed**.
- The golden fixture was extracted from the supplied reference workbook's Data
  sheet, independently of the new formatter. All 32 headers and all 160 data
  fields reconcile. Numeric tolerance of `1e-12` accommodates the reference's
  serialized floating-point percentages; no calculation formula was changed.
- Reference basket: PS-1 / PS-2, five comparisons, four competitors, quantity 20,
  our total **₹3,636.00**, six App prices and one Entered price.
- Brand subtotal pairs, differences, position counts, coverage denominators and
  every product/brand matrix value are explicitly checked against reference
  figures.
- Explicit widths on every used column, frozen styled headers, print settings,
  autofilter, source states and percentage/currency formats are checked on the
  serialized/reopened workbook.
- A separate below-our-price fixture asserts a negative red percentage.
- The reference PDF is **one A4 portrait page**, contains extractable values and
  evidence notes, and contains no URL, encoded calculator state or app chrome.
- A ten-block PDF fixture verifies that product starts and their final competitor
  notes stay on the same pages.
- Singular/plural assertion wording and the singular unit-warning disclosure are
  checked.
- The automated whole-session proof now exercises both export formats with
  basket-local competitors/products and edited MRPs. Complete row bytes of
  `catalog_products`, `competitor_prices`, `mrp_price_history`,
  `discount_settings`, stored brand vocabulary, Finder coverage and official
  analytics responses remain identical before and after.
- After restarting both relevant workflows, real development HTTP exports
  returned 200 for XLSX and PDF. A basket-only 92 MRP / 33.33% / quantity 7
  independently reopened as **429.38** in both formats.
- Calculator app preview loads without browser errors.

Generated examples and no-write evidence are under ignored
`generated-artifacts/p075/`. The examples reproduce the supplied reference
basket; they are not assertions about current production pricing.

Production was not changed or published as part of this work.
