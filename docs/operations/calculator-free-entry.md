# Calculator free-entry acceptance — 18 October 2026

## Delivered scope

Only the Price Calculator UI, its calculator-only endpoints, its shared pure
arithmetic and generated API contracts were changed. The common evidence
resolver retains scoped behavior by default; only calculator calls opt out.
The request-scope middleware exempts only `/price-finder/calculator/*`.
Price Finder, analytics and administrative loaders retain their existing rules.

- Editable own/competitor MRPs, app-prefilled values, App / Edited / Entered
  states, overridden app-value disclosure and one-click revert.
- Deliberate one-off competitors; stored brands offered first. Recorded Astral
  and one-off Astral remain different basket identities.
- Exact-code catalogue lookup and ad-hoc products with required descriptions,
  no inferred division/category, and visible Ad-hoc grouping.
- Existing inactive/no-price catalogue codes retain their actual metadata and
  need an Entered price. They are not reactivated or relabelled as unknown SKUs.
- Full-catalogue/full-competitor quoting, with the replacement scope disclosure.
- Unverified-price banners, provenance counts, named ad-hoc competitors and the
  ad-hoc share of every coverage denominator.
- Two-sheet Excel export with provenance columns, overridden app values,
  ad-hoc flags, unit notes and the unverified banner at the top of both sheets.
- Existing unit-first rounding and compared-product-only percentages preserved.
- URL/share round trips preserve exact codes, raw entries and provenance flags.
- No price promotion, product/brand registration or database save action exists.

## Verification

| Check | Result |
|---|---|
| Calculator API suite, private disposable schema | **11 passed** |
| Price Finder tests, including calculator arithmetic and state | **37 passed** |
| Shared-library typecheck | **Passed** |
| API package typecheck | **Passed** |
| Price Finder package typecheck | **Passed** |
| Development desktop/mobile browser journey | **Passed after the focused fix below** |
| Real downloaded Excel inspected | **Passed** |
| Full workspace `pnpm typecheck` | **Blocked by pre-existing `pricing-logic-film` DOM/animation typings** |

The workspace gate was not weakened, and unrelated video files were not
changed. The full-workspace check must not be reported as passing.

The browser verified editing/reverting A-10A, known-first Astral selection,
separate recorded/one-off Astral rows, neutral versus amber units, an ad-hoc
product, summary counts/coverage, real Excel download, URL reload, zero-MRP
validation and the 390×844 layout.

The first browser pass found that `TTS - 01` existed but was inactive with no
MRP history. The ordinary active-product resolver omitted it after exact-code
selection. Calculator-only metadata resolution now preserves this known
identity without reviving an ineligible app price. A focused second check
verified:

- `TTS - 01`, description `Teflon Thread Seal (10 mtr. L) 12mm`;
- actual division/category `PTMT & Plastic Fittings` / `PTMT Taps`;
- no Ad-hoc badge; blank Entered MRP;
- entered 92, discount 33.33%, quantity 7 → net **61.34**, total **429.38**;
- summary: one known product, Entered 1, ad-hoc products 0;
- no borrowing of the distinct `TTS-01` record or its app price.

## No-write evidence

The API test snapshots every source-table row before and after a complete
session with edited MRPs, an unpriced catalogue product, an ad-hoc product,
ad-hoc competitors, search/evidence requests and Excel export. Exact serialized
rows match for catalogue, competitor prices, MRP history and discount settings.
This application has no separate competitor master; its distinct stored
price-row brand vocabulary is also asserted unchanged.

Independent **development** source-table snapshots around the real browser
session match:

| Value | Before: 16:57:02 IST | After: 17:08:00 IST |
|---|---|---|
| Catalogue rows | 6,948 | 6,948 |
| Catalogue full-row MD5 | `bd8663df186ff23af7acd84c770cea26` | same |
| MRP rows | 14,012 | 14,012 |
| MRP full-row MD5 | `2e3dbe125a5643fc1ff7c7a0a26da055` | same |
| Competitor rows | 3,770 | 3,770 |
| Competitor full-row MD5 | `0319cc8e7c9b1d54711d38daff2c6044` | same |
| Stored brand-vocabulary MD5 | `c80ae3a92d5690779651e97674b93e1f` | same |

These are same-query before/after verification hashes, not replacements for
older canonical source-fingerprint recipes.

No production data or saved bucket preferences were changed. No division
mapping Preview, Apply or Undo was invoked.

## Explicitly deferred

Do not capture asserted competitor prices as market intelligence. That needs
a separately approved review queue, attribution trail and source policy.
The legacy Apollo/Ashirvad unit repair/backfill, development-fixture cleanup,
division-guard relaxation and category spelling/backfill work remain outside
this change. Nothing in free entry authorizes any of those data mutations.
