# Calculator search ranking and disclosure

## Boundaries

Price Finder's existing ranker, query variants and candidate field definitions
are shared through the formatting library. Both handlers use the same ranking
and SQL candidate-condition helper. The Calculator never calls the Price Finder
endpoint and never applies company or personal buckets. Price Finder retains
its existing eligibility, filtering, bucket scope and authentication behavior.

Normalized hints rank suggestions only. `exactProduct` still comes from raw
stored item-code equality. Picker acceptance is explicit.

The direct-search server default and client rendering ceiling are both 300.
This accommodates the known code families without adding pagination. Every
completed direct search discloses its server `totalCount`; capped results say
“Showing the first 300 of N matching products — refine your search.” The notice
is above the scrollable options, not hidden after them. Browse uses the same
ceiling and disclosure. Exact-code suggestions retain their small limit because
exact identity is returned separately.

## Automated verification

- Formatting tests: ranking classes, retained synonyms/voice variants,
  numeric-aware ties and result-disclosure formatting.
- Actual Calculator and Price Finder handlers, using a disposable private
  database schema: identical order over identical eligible candidates;
  first-ten prefix class and prefix-before-substring order; server total before
  limit; broader category matching; anonymous/admin equivalence; Calculator
  remains unbucketed while Finder enforces the same exclusion; direct search
  unchanged after a browse request.
- Existing exact-code, free-entry no-write and official aggregate invariants
  remain in the calculator suite.
- Frontend tests cover row-local state, one imported ranker, server-total
  binding, removal of the lower client cap, and actual server-rendered status
  markup with a larger-than-cap total.

The PS assertions intentionally test the code-prefix class, not fixed SKU
positions. Preserving the established Finder order was explicitly approved.

## Development browser observations — 23 October 2026

- Calculator `PS`, limit 300, as-of 2026-10-23: 176 returned / 176 total.
  Broader shared field matching makes this different from the former code/name
  search's 147 candidates. All first-ten codes begin with PS. All 176 options
  were observed rendered, with “Showing all 176 matching products.”
- A genuine development-admin session and anonymous requests returned identical
  complete ordered PS results and totals. Only the login/session was created;
  browser non-GET/HEAD traffic was blocked.
- Row 2 selected 3272 through PTMT / Collapsible Waste Pipe. Row 3's PS results
  equalled Row 1's, and PS-1 could be selected in both rows.
- Literal `TTS - 01` returned that exact stored identity separately from the
  near suggestion `TTS-01`; the row stayed unselected until explicit acceptance.
- Finder `PS` retained its observed order and existing 142 results / 157
  candidate total. That pre-existing candidate-versus-positive-score total
  discrepancy was not changed.

### Unresolved browser verification

Read-only API query `1`, limit 300, returned HTTP 200 with 300 results and
`totalCount=4533`. The browser automation timed out while entering this query,
including a bounded targeted retry. It could not isolate application input/
rendering delay from observation-tool overhead. Therefore the 300-option
large-result UI and live truncation notice are **not browser-verified**.
Do not claim this state passed or infer a proven application defect from the
timeout. The API and rendered-notice unit assertions passed independently.

Shared-library and changed API/Finder typechecks pass. Code generation succeeded;
its appended project-wide check encounters the already-existing animation DOM/
window/document type errors. No production changes or publishing were performed.
