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

Neither production nor development had any one-character item code in the
read-only catalogue check on 23 October 2026. Direct search and exact-code
lookup therefore wait for two characters (and nonblank input). Both raw and
debounced values must pass admission; dropping back to one character hides stale
cached results and their notice immediately. This does not trim or normalise
the actual query or identity. Browse remains unchanged.

One-character exact entries still settle locally and can be explicitly added
as ad-hoc products with a description. Skipped lookups can never borrow a stale
exact product or near match. Revisit this guard if catalogue policy later admits
single-character codes.

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

### Resolved large-result browser verification

The earlier observation-tool timeouts did not establish an application hang.
A standalone Node Playwright run using the installed Nix-aware Chromium wrapper
successfully measured the real, already-published production dropdown before
the two-character guard was implemented:

- Viewport 390×844 CSS pixels; mobile, touch, DPR 2.
- CDP CPU slowdown 6×; Slow 4G: 150 ms latency, downstream 200,000 B/s,
  upstream 93,750 B/s. This is an emulated phone-class profile, not a physical
  handset claim.
- Live source `82b6103e0adc7dc44dd6a701d1c8d43c10071465`.
- At 2026-10-23 07:58:20 UTC, query `1` returned 300 of **4,739**; all 300
  option nodes rendered with the exact server-total disclosure.
- Input to painted options: **1,485.9 ms**, including debounce and network.
  Response end to painted options: **644.3 ms**.
- The former 4,533 total was from development, not production.
- Production PS also rendered all 176 matches with a first-ten PS-prefix class.
- Basket-local ad-hoc competitor/product and App / Edited / Entered states
  passed. Astral showed amber `Unit: per 3-m pipe`; the one-off competitor showed
  the neutral `Competitor unit not recorded.` note.

Sanitized runtime evidence is in ignored `generated-artifacts/p074/phone-q1.json`
and accompanying screenshots. No non-GET/HEAD browser requests occurred.

The film DOM type correction separately restores the full workspace
`pnpm typecheck`. The two-character guard is a subsequent source change; the
production measurements above are explicitly for the earlier live build.
