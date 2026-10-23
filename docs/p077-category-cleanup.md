# Category cleanup — development result and read-only production investigations

## Scope and outcome

Production was SELECT-only. No division Preview, staging, production Apply, or publish was run.
Development: **195 Category-only changes**: 189 case-only corrections across 20 groups and six confirmed descriptor corrections.
The 1,131 figure is the population of the 20 groups, not the number of edits.
The transaction asserted the exact IDs, exact item codes, divisions, before-categories, full before-state and final change set.
Only `category` was assigned; even `updated_at` was left unchanged. Non-Category catalogue bytes and both price tables stayed identical.

## §0 — current write path

`authoritativeMrpMaster.ts` derives Category from `series` for new non-Range products. Existing products return early with classification differences reported, not written.
The new-product write plan already calls the shared spelling guard. Reviewed names are now explicit and division-scoped there, including the separately confirmed 0.75-mm alias.
No item-code normalization, blanket title-casing, division changes, Series changes or competitor-category corrections were introduced.
Signed inverse values remain exact: conflicting spelling restoration is rejected rather than silently rewritten.

## Sales consumer check

Consumer: **fonnjain/Prayag-Distributor-Ananlysis**, main source tree `38293aa7c5a2d4f9423623c6f4865f38ba48f6b4`.
This is repository-source verification, not proof that this revision is the deployed Sales build; the Sales database was not queried and no refresh was triggered.

| Feed / field | Source | Sales consumer and behavior | Impact of this cleanup |
|---|---|---|---|
| `/api/v1/products`, JSON `category` | `catalog_products.category`, passed through by Competition `catalog.ts` | Sales `lib/mrp/authorityClient.ts`: SourceRow/AuthoritativeProduct/normaliseAuthoritativeProduct do not read or retain Category; current catalogue taxonomy is local enrichment | No Category join, group, filter or mapping in this consumer; none of the 20 ALL-CAPS labels is a key here |
| `/api/v1/comparison`, JSON `category` | `competitor_prices.category`, not catalogue Category | Sales `lib/competitionClient.ts` passes it through; `routes/competitorPrice.ts` upserts `competitor_price.category`, filters `category = $n`, orders by category; `CompetitionPricePage.tsx` builds a distinct category picker and displays the string | Exact-string filter exists, but its source table is unchanged byte-for-byte. No effect from this catalogue-only merge |

No coordinated Sales edit is indicated by these reviewed consumers. Recheck the deployed Sales revision before production execution if it differs from the reviewed source.

## Part A — rows changed, development only

| Previous Category | Kept Category | Changed |
|---|---|---:|
| ASPIRE 52 | Aspire 52 | 8 |
| ORBIT 53 | Orbit 53 | 4 |
| AQUA 54 | Aqua 54 | 4 |
| OCEAN 55 | Ocean 55 | 4 |
| POLO 60 | Polo 60 | 4 |
| BLAZE 62 | Blaze 62 | 4 |
| MARCUS 68 | Marcus 68 | 4 |
| MACASA 76 | Macasa 76 | 4 |
| SAGA 79F | Saga 79F | 11 |
| 800 Series 304 Super Steel (0.75) | 800 Series 304 Super Steel (0.75 Mm) | 6 |
| EVIAN 87 | Evian 87 | 4 |
| LAGUNA 93 | Laguna 93 | 4 |
| VINCENT 66 | Vincent 66 | 2 |
| CYGNUS 71 | Cygnus 71 | 2 |
| URBONA 78 | Urbona 78 | 2 |
| NIAGARA 81 | Niagara 81 | 2 |
| EUROPA 90 | Europa 90 | 2 |
| VIRGO P66 | Virgo P66 | 2 |
| SILENT FITTINGS | Silent Fittings | 30 |
| UPVC PIPE | UPVC Pipe | 12 |
| SWR PIPE | SWR Pipe | 80 |
| **Total** | | **195** |

### The 21st pair

Official PTMT workbook: `NEW_PTMT_MRP_w.e.f._List_as_on_01st_Sep,_2026_1787217406638.xlsx`, sheet `SINK`. Rows 32–40 head the single bowls as `800 SERIES / 304 / SUPER STEEL / (0.75 MM)`; rows 76–78 head the double bowls as `800 SERIES 304 SUPER STEEL (0.75)`.
Both state the same 800-series, 304-grade, 0.75-thickness family; the double-bowl heading omits only the thickness unit. Category is merged; single/double bowl product names and the exact stored Series remain different and untouched.
Affected codes: `842-D`, `842-DM`, `850-D`, `850-DM`, `850-XD`, `850-XDM`.

## Full-row integrity proof

MD5 is over every row's PostgreSQL `to_jsonb(row)::text`, ordered by integer id and joined with LF (`chr(10)`).
These are full-row audit hashes, not the older value-only MRP or classification checksum recipes.

Development before: **23 Oct 2026 15:50:41 IST**; after: **23 Oct 2026 16:01:36 IST**.

| Development table/projection | Rows | Before MD5 | After MD5 |
|---|---:|---|---|
| catalog_products — full rows | 6,948 | `4a60b2935be946477e02bde1312c95b7` | `1fc1b5cf4645c7fb23a4195dbed30c3f` |
| catalog_products — all fields except Category | 6,948 | `99c56b4c189b96213c2c6c9a957b868b` | `99c56b4c189b96213c2c6c9a957b868b` |
| mrp_price_history — full rows | 14,012 | `541ebec5ffe84237e4d7c3df60be814c` | `541ebec5ffe84237e4d7c3df60be814c` |
| competitor_prices — full rows | 3,770 | `7cdb07c0170c9d3e0d5827e892562a52` | `7cdb07c0170c9d3e0d5827e892562a52` |

Production before: **23 Oct 2026 15:50:44 IST**; after: **23 Oct 2026 16:01:41 IST**.

| Production table | Rows | Before = after MD5 |
|---|---:|---|
| catalog_products | 7,191 | `a3eda5f2926cd38355b41919a05f5450` |
| mrp_price_history | 14,302 | `d9020aa16c6bfe68cbe9570e2cf2f961` |
| competitor_prices | 3,770 | `15aeeb499dce1549d06ef92ff383a9cc` |

## Part B — the three bare-number codes, no changes

**The malformed-size-cell hypothesis is not supported by the original workbook.**
The original sheet explicitly calls column AE `CAT NO.` under the merged `TANK NIPPLE` heading AE2:AF2. Column AF is `MRP`.

| Stored code | Original row | CAT NO. cell | MRP cell/value | Current price lineage |
|---|---:|---|---|---|
| `20` | 5 | AE5 = 20 | AF5 = ₹184 | Batch 1; effective 2026-02-01 |
| `25` | 7 | AE7 = 25 | AF7 = ₹216 | Batch 1; effective 2026-02-01 |
| `32` | 8 | AE8 = 32 | AF8 = ₹326 | Batch 1; effective 2026-02-01 |

Workbook: `MRP w.e.f. 01st Feb, 2026 Pipe & Fitting.xlsx`, sheet `PE-AL-PE FITTINGS-2`.
The original bytes inside the supplied MRP archive match the registered batch SHA-256 exactly:
`03afec64dd7fa66d5108c1099054e74ee86fca39bee0a1f0134c283ec97528c9`.
The all-period rebuild repeats these as codes at rows 3379, 3406 and 3425, with blank product names, showing the omissions were already present in the rebuild payload.

**Creation attribution limitation:** all three catalogue rows were created 19 Aug 2026 14:32:09 IST; the registered price batch 1 has loaded_at 15:43:08 IST that day.
The catalogue rows have no source_files or catalogue-creation batch link. Batch 1 proves current price provenance, not which original operation created the catalogue rows. That original creation batch cannot be proved from the retained links.
Finding: genuine source catalogue entries for Tank Nipple with missing descriptive metadata; no evidence here supports deletion. Name, category, prices and rows were left unchanged.

## Part C.1 — 96 PTMT sink-family products

All 96 exact codes are absent from the v3 workbook's `mapping` sheet. Exact matches only; spaces, punctuation and case were not normalized.
The mapping loader retains a product's existing division if its exact code has no mapping. These omissions therefore support the reported explanation.
**ERP Item Type / would map to Sink:** unknown for every one of these 96; the supplied mapping has no ERP row for them. Their names/categories make them review candidates, not verified ERP assignments.
The workbook attachment lists every code, name, category, division, exact mapping membership and this explicit unknown status.
No division was changed. The stored Sink population remains 235 (124 current-price products); any broader Sink population or revised coverage needs a separately approved mapping pass.

| Production Category | PTMT candidates |
|---|---:|
| 1200 Series 304 Super Steel (1.00 Mm) | 35 |
| 304 Super Steel (0.85 Mm) | 27 |
| 800 Series 304 Super Steel (0.75 Mm) | 5 |
| 800 Series 304 Super Steel (0.75) | 4 |
| 900 Series 304 Super Steel (0.85 Mm) | 18 |
| Sink Fittings | 7 |

## Part C.2 — cross-division minorities

**31 minority candidates are listed in the workbook with names, Series, size, UOM, lifecycle status and available ERP mapping evidence.** A separate context sheet lists the other products in the same reported categories.
Most Ceramic minorities are explicitly basins/closets, e.g. 4673 is a wash basin (445 × 310 × 135 mm) under Orbit 53. A shared collection name alone is not evidence of the wrong division.
The three CPVC-category CP rows are TTS-01/TTS-02/TTS-03, named TEFLONE TAPE. 492-W/493-W under Showers & Accessories are ABS soap dispensers. These deserve category/business-rule review rather than an automatic division move.
Cisterns and their accessories occur across divisions with distinct product descriptions; no majority-vote reclassification was performed.

## Verification

- Project-wide `pnpm run typecheck`: passed.
- Category/spelling targeted suites: 62 tests passed.
- Standard `pnpm test`: 81 tests passed (7 shared formatting, 53 Finder, 21 API).
- Two stale legacy test expectations about normalized item-code identity were corrected to the standing exact-code contract; no production identity code was changed.
- API workflow restarted once after the code batch.
- No production publish or application data write occurred.
