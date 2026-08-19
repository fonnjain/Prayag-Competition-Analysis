# Post-rebuild corrections v4 — verification report

## Scope

This report records the development database verification after the v4
corrections package. It distinguishes immutable source-load facts from the
current rows still linked to each source batch.

## Price history and source provenance

- **MRP history rows:** 12,750
- **Distinct item codes:** 6,303
- **Unlinked history rows:** 0
- **PTMT source checksum:** `5da96e39cac40ede1480be4013554753cbdf4589ff0b5f77a7be43bfe13c8db0`

| Official source | Recorded rows | Linked now | Removed after load |
| --- | ---: | ---: | ---: |
| Pipes & Fittings | 3,981 | 3,981 | 0 |
| PTMT & Plastic Fittings | 4,309 | 4,291 | 18 |
| CP Fittings / Faucets | 3,076 | 3,076 | 0 |
| Ceramic Sanitaryware | 532 | 532 | 0 |
| Hardware | 554 | 554 | 0 |
| CP (QUAA / FERN) | 316 | 316 | 0 |

The 18-row PTMT difference is intentional: v4 removed source-invalid
September SINK rows. The original batch's `row_count` remains 4,309 as a
historical load fact, while Data Health now shows both this recorded figure and
the 4,291 rows currently linked to it.

## Pricing and discontinuation checks

- The 18 invalid September SINK rows are absent.
- `616-D` remains available in historical data at **₹2,490** before
  2026-09-01 and is not returned for 2026-09-01.
- `BD-40` remains live at **₹3,990**.
- **98** products have a confirmed discontinuation date.
- **6,205** products are live on 2026-09-01.
- The SINK source correction schedules 18 variants (nine standard codes and
  nine Matt twins); the other 80 discontinuations are separately confirmed.

### Inactive codes by division

| Division | Inactive codes |
| --- | ---: |
| PTMT & Plastic Fittings | 231 |
| CP Fittings / Faucets | 165 |
| Pipes & Fittings | 155 |
| Hardware | 5 |

### 20 most recently updated inactive codes

All 20 share the 2026-08-19 09:22:30 UTC update timestamp and are in
PTMT & Plastic Fittings:

`1216D`, `1216DMATT`, `1217D`, `1218D`, `1218DMATT`, `1220D`, `1220DMATT`,
`1222D`, `1222DMATT`, `1223D`, `1224D`, `1224SD`, `1224SDMAT`, `1224XD`,
`1224XDMATT`, `1225D`, `1225DMATT`, `1226D`, `1226DMATT`, `1230D`.

## Sparsh Pearl verification

- **150** current Sparsh Pearl price rows are matched and resolve to a Prayag
  product.
- The separate code-alias register contains 7 verified catalogue renumbering
  aliases; this is not the same metric as the 150 price mappings.

### `134-V` / `RPS-2285` market-gap trace

| Field | Verified value |
| --- | ---: |
| Competitor | Sparsh Pearl |
| Competitor code | `RPS-2285` |
| Mapped Prayag code | `134-V` |
| Competitor price | ₹1,200 |
| Competitor effective date | 2026-03-05 |
| Prayag MRP used by the live dashboard | ₹1,262.35 |
| Prayag MRP effective date | 2026-03-05 |
| Future Prayag revision | ₹1,364 on 2026-09-01 |
| Live signed gap | **−4.94%** |

The live gap is calculated as `(₹1,200 − ₹1,262.35) / ₹1,262.35`; the
September ₹1,364 revision is not used before its effective date.

## Manual correction traceability

Manual MRP edits now require a reviewer-provided reason. Each correction creates
a dedicated internal provenance batch (separate from official workbook sources)
with a stable SHA-256 fingerprint, load date, reviewer identity when available,
and the correction reason. Same-date corrections transfer the price row into
that manual batch rather than silently retaining workbook provenance.

## Test triage and final validation

The previous suite failures were resolved as follows:

- The duplicate-claim matcher test now expects the intentional
  `needs_review` safeguard rather than allowing one catalogue item to claim two
  master products.
- Empty/non-text Claude responses are confirmed as recoverable no-item results,
  not failed PDF chunks.
- SINK expectations now reflect the v4 source correction: 11 legitimate live
  sub-₹50 PTMT prices, 18 scheduled SINK variants, and 80 other confirmed
  discontinuations.
- Manual correction provenance and the PTMT batch divergence have dedicated
  regression coverage.

Final automated verification: **264 tests passed; 1 test intentionally
skipped**. Workspace type-check and both affected production builds passed.