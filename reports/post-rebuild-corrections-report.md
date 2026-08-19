# Post-Rebuild Corrections — Development Database Readback

## Discontinuation correction
- Before correction: 158 products had a withdrawal date after the earlier BD-40 exception.
- Applied the workbook’s 61 unmark entries and its full 98-code confirmed list.
- After correction: 98 products have a non-null withdrawal date.
- BD-40 has no withdrawal date and resolves to 3,990.00 on 2026-08-19.
- Products live at 2026-09-01: 6,205.
- All 61 unmarked codes resolve to an approved price at or before 2026-09-01.
- All 150 Sparsh Pearl mappings still resolve to catalog products.

## Loader safeguard
The MRP importer now recognizes the authoritative discontinuation correction workbook. It derives confirmed withdrawals by code: every occurrence must be REMOVED; any live occurrence keeps that code live. It applies the complete manifest idempotently, so re-importing the same correction does not re-mark the 61 shared components.

## Single-row market-gap trace
- Pair: Prayag 134-V ↔ Sparsh Pearl RPS-2285.
- Dashboard display today: -4.9% (the UI renders the computed -4.94% to one decimal place).
- Prayag divisor: 1,262.35 from mrp_price_history, effective 2026-03-05, resolved live for the as-of date.
- Competitor amount: 1,200.00 from competitor_prices.price; its price_basis is null, so it is treated as MRP/as-is.
- Stored competitor_prices.prayag_mrp_at_compare snapshot: 1,262.35. It happens to match the live value but is not used by the dashboard gap calculation.
- Calculation: (1,200.00 - 1,262.35) / 1,262.35 = -4.94%.
- Source discrepancy retained for review: the supplied correction prompt states 1,388.00 for RPS-2285, while the database row stores 1,200.00. No figure was altered to force the expected result.

## Inactive catalog codes (556 total)
| Division | Count |
|---|---:|
| PTMT & Plastic Fittings | 231 |
| CP Fittings / Faucets | 165 |
| Pipes & Fittings | 155 |
| Hardware | 5 |

## Twenty most recently updated inactive codes
All twenty share the rebuild correction update timestamp, 2026-08-19 09:22:30 UTC:
1216D, 1216DMATT, 1217D, 1218D, 1218DMATT, 1220D, 1220DMATT, 1222D, 1222DMATT, 1223D, 1224D, 1224SD, 1224SDMAT, 1224XD, 1224XDMATT, 1225D, 1225DMATT, 1226D, 1226DMATT, 1230D.

The database currently has only five inactive Hardware codes, rather than the 277 mentioned as a possible source-sheet risk in the prompt. No inactive products were deleted.
