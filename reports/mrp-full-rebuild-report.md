# Full MRP History Rebuild — Development Database Readback

## Backup and load
- Backup table: mrp_price_history_backup_20260819_full_rebuild
- Backup rows: 13,463
- Loaded rows: 12,768
- Distinct item codes: 6,303
- Catalog rows upserted: 6,303
- Source withdrawals: 159; 158 remain scheduled after reconciling BD-40 to the explicit acceptance rule.
- Source conflicts: 79 rows, consolidated to 74 item-code flags in Data Health.

## Rows by effective date
| Effective date | Rows |
|---|---:|
| 2017-12-01 | 49 |
| 2022-01-01 | 106 |
| 2024-02-15 | 161 |
| 2024-05-01 | 1,284 |
| 2024-06-01 | 277 |
| 2025-01-15 | 292 |
| 2025-04-01 | 67 |
| 2025-07-01 | 56 |
| 2026-01-01 | 292 |
| 2026-01-15 | 555 |
| 2026-02-01 | 2,244 |
| 2026-03-01 | 277 |
| 2026-03-05 | 2,167 |
| 2026-05-01 | 1,704 |
| 2026-08-01 | 1,071 |
| 2026-09-01 | 2,166 |

The four unsourced periods (2024-01-01, 2025-06-01, 2026-01-20, and 2026-04-20) have zero rows.

## Acceptance results
1. PASS — 12,768 rows and 6,303 distinct codes.
2. PASS — zero rows in every forbidden unsourced period.
3. PASS — 148-LS: 385.56 today; 416.00 on 2026-09-01.
4. PASS — 148-LSB: 410.00 today; 148-LS is cheaper.
5. PASS — 123-Q: 375.52 today; 406.00 on 2026-09-01; no 405.57 row.
6. PASS — 911-D: 3,240 today; 3,490 on 2026-09-01.
7. PASS — BD-40: 3,990 today; 3,680 on 2026-07-31.
8. PASS — U21: 78.00 and C854: 44.40 on 2026-02-01.
9. PASS — C121: 36.00 on 2024-05-01.
10. PASS — 8 PTMT items under 50 on 2026-09-01; zero are -D / -DM sink codes.
11. PASS — all 150 Sparsh Pearl mappings resolve to catalog products.
12. PASS — scheduled withdrawals resolve no price from the stop date onward; 121-VB resolves 248.00 the day before its 2026-09-01 stop date.

## Catalog reconciliation
- 556 database products are absent from the rebuild catalog sheet and are now inactive rather than deleted. Their codes, divisions, and names are in the companion CSV.

## Gap readback
Using the application convention — (Sparsh MRP − Prayag MRP) / Prayag MRP — across 140 priced Sparsh mappings on 2026-08-19:
- Before: -8.48% median
- After: -0.99% median

This does not match the prompt’s illustrative +3% to +10.8% expectation. The report preserves the database-derived result rather than modifying data to fit that figure.
