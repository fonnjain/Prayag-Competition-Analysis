# Ashirvad as a Second Competitor

## Source adopted

- Workbook: `Ashirvad_Competitor_Mapping.xlsx`
- Approved SHA-256: `5dfa4fdcc76595e4e3c090734808a506d85eb3902137428263274272e2b0e499`
- Sheet: `competitor_mapping`
- Mapping rows: **669**
- Competitor: **Ashirvad**
- Effective date: **01 March 2025**
- Development import batch: **1728**

The trusted loader validates the exact workbook digest, row count, required fields, unique Prayag codes, unique Ashirvad codes, competitor name, effective date, positive competitor MRP, and existence of every Prayag code before writing.

`prayag_mrp_reference` and `gap_pct` are deliberately absent from the parsed row type. They cannot reach `catalog_products` or `mrp_price_history`, and they are not used to calculate live gaps.

## Load result

- Ashirvad competitor rows: **669**
- Distinct mapped Prayag codes: **669**
- Unmatched rows: **0**
- Gap-guardrail rejections: **0**
- Rows on any date other than 2025-03-01: **0**
- Sparsh Pearl mappings retained: **150 distinct codes**

The load is idempotent for the trusted Ashirvad period: uploading the same approved snapshot again replaces only Ashirvad’s 2025-03-01 rows and still leaves exactly 669.

## Prayag data guard

Before and after the permanent Ashirvad load:

| Table | Rows | Digest |
|---|---:|---|
| `catalog_products` | 6,906 | `aa5786e7923c906a442f4b880fde748d` |
| `mrp_price_history` | 14,092 | `098db892f5700e3c974d32fb2d742b15` |

No Prayag catalogue row or MRP-history row was created, updated, or deleted by the competitor load.

An earlier failed database-backed test run left seven `MKT-GAP-*` catalogue fixtures and eight linked MRP fixtures. Those exact test-prefixed rows and their single fixture batch were removed before the permanent load. The authoritative counts and digests above match the task’s original pre-load baseline exactly.

## Coverage and “No data”

The supplied brief describes an older 1,183-product plumbing boundary with 514 unmapped products. The current live catalogue has expanded:

- The eight exact named category labels now contain **1,234** products.
- Ashirvad maps **669 / 1,234**, or **54.2%**.
- **565** products in those eight current categories show **No data** for Ashirvad.
- Across every category currently under `Pipes & Fittings`, there are 2,459 products; 1,790 have no Ashirvad mapping.

Current exact-label coverage:

| Category | Current products | Mapped | No data |
|---|---:|---:|---:|
| CPVC Pipe | 40 | 40 | 0 |
| CPVC Fittings | 284 | 171 | 113 |
| UPVC Pipe | 52 | 40 | 12 |
| UPVC Fittings | 291 | 154 | 137 |
| AGRI Pipe | 123 | 67 | 56 |
| AGRI Fittings | 135 | 20 | 115 |
| SWR Pipe | 160 | 56 | 104 |
| SWR Fittings | 149 | 121 | 28 |

Missing mappings render as **No data** / **No data matched**, never as zero price, zero gap, or parity. This is visible in the verified Price Finder comparison for `PS-1`: Ashirvad has data and Sparsh does not, so both columns remain visible and Sparsh shows the no-data state.

## Date-aligned median gaps

Gap convention: positive means Ashirvad is more expensive and Prayag is cheaper. Each gap uses the approved Prayag Standard MRP in force on the Ashirvad effective date, not `prayag_mrp_reference`.

| Category | Comparable rows | Median gap | Prayag cheaper |
|---|---:|---:|---:|
| **Overall** | **664** | **+17.19%** | **517** |
| CPVC Pipe | 40 | +43.21% | 40 |
| CPVC Fittings | 169 | +50.00% | 166 |
| UPVC Pipe | 40 | +3.47% | 34 |
| UPVC Fittings | 154 | +11.78% | 112 |
| AGRI Pipe | 67 | **−5.45%** | 13 |
| AGRI Fittings | 20 | +10.07% | 14 |
| SWR Pipe | 56 | +2.13% | 33 |
| SWR Fittings | 118 | +16.45% | 105 |

Five mapped codes have no approved Standard Prayag MRP on or before 2025-03-01, so their historical gaps remain unavailable: `5106`, `5606`, `5706`, `C134`, and `C135`.

The two business-review flags remain material:

- **CPVC is not close:** Prayag is cheaper for every comparable pipe and 166 of 169 comparable fittings, with median gaps of +43.21% and +50.00%.
- **AGRI Pipe runs the other way:** Ashirvad is cheaper for 54 of 67 comparable products; the date-aligned median is −5.45%.

These date-resolved results differ from the workbook’s review-only reference figures. That is expected because the application resolves Prayag’s independently audited history at 01 March 2025.

## Multiple-competitor behavior

### Corrected assumptions

1. The spreadsheet import path had a dedicated trusted-master branch only for Sparsh.
2. The generic importer could treat review columns as candidates and apply the normal market-gap guardrail to this trusted source.
3. Catalogue comparison/list/summary/export filters treated `competitor` as one scalar value.
4. Analysis parsed repeated query values but did not split comma-separated brand selections.
5. Price Finder’s server and route-state allowlists omitted Ashirvad.
6. Product Database used one scalar competitor dropdown; “All” was the only way to see more than one.
7. Price Finder’s inline result silently showed the lowest competitor price as “best.”
8. Missing matrix cells used a dash, and some analysis charts converted missing gap values to zero.
9. Normal competitor surfaces showed dates but did not make an old current source prominent.

### Result

- Product Database has an accessible checkbox multi-select and can request Sparsh only, Ashirvad only, or both.
- Price Finder exposes Ashirvad in its competitor selection.
- Price Finder’s compact inline result now explicitly says **Closest** and selects by absolute gap.
- Price Finder product details still show every available competitor.
- Comparison and exports accept comma-separated competitors and preserve the competitor identity on every row.
- Analysis remains multi-select and now handles comma-separated selections.
- Missing values stay null and render as explicit no-data states rather than 0%.
- Ashirvad surfaces prominently show **Valid from 01 Mar 2025 · 18+ months old**.

### Live-data limitation

There is no current product mapped to both competitors:

- Ashirvad’s 669 mappings are plumbing products.
- Sparsh Pearl’s 150 distinct mappings are sanitaryware series.
- Live overlap: **0 products**.

The application and filters support both brands simultaneously, as verified by the two visible columns in Price Finder, but acceptance example 5 cannot show two real prices for one product until a future competitor dataset overlaps these product families.

## Verification

- Workbook SHA-256 matched exactly.
- Trusted parser tests: passed.
- Trusted real-route load/idempotency test: passed.
- Comparison price-window tests: passed.
- Price Finder integration tests: passed.
- Analysis filter parsing tests: passed.
- Focused API tests: **71 / 71 passed**.
- Shared libraries, API, Product Database, Price Finder, and Analysis type-checks: passed.
- API and all three affected frontend workflows restarted cleanly.
- Public Price Finder screenshot confirmed the Ashirvad date warning, real gap, and explicit missing Sparsh data.