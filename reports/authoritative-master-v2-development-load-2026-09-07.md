# Authoritative MRP Master v2 — Development Load Report

## Source and load identity

- File: `Prayag_MRP_Authoritative_v2_01Sep2026.xlsx`
- SHA-256: `e4463266dffdb44b5ae0c10ba5150cc786f6ea21e65619fab2dd57846e4fe23e`
- Download/receipt date: 2026-09-07
- Development load batch: 865
- Reason: Revised authoritative master from Prayag, superseding batch 15.
- Parsed product rows: 6,106
- Loaded price rows including colour variants: 6,256

## Database counts

| Measure | Before v2 | Immediately after v2 |
|---|---:|---:|
| Catalogue rows | 6,876 | 6,906 |
| Distinct catalogue codes | 6,876 | 6,906 |
| MRP-history rows | 13,602 | 14,097 |
| Distinct MRP-history codes | 6,321 | 6,351 |

Five pre-existing unbatched test-sentinel rows were subsequently removed. The verified development state is 14,092 MRP-history rows, 6,349 distinct history codes, and zero rows without a `load_batch_id`.

## Standard rows by effective period

| Effective date | Rows |
|---|---:|
| 2024-02-15 | 161 |
| 2026-02-01 | 1,616 |
| 2026-05-01 | 475 |
| 2026-08-01 | 865 |
| 2026-08-10 | 580 |
| 2026-09-01 | 2,409 |

The v2 workbook moved 465 existing products into the 10 August period:

- 396 moved from 2026-05-01.
- 69 moved from 2026-02-01.

Of the products now dated 10 August, 392 have a different resolved MRP from batch 15. Three additional MRP changes are in the 1 August period, for 395 resolved price changes overall.

## Thirty new loadable codes

`PF306`, `PF326`, `PF51`, `PF525`, `PF608`, `PF609`, `PF61`, `PF610`, `PF611`, `PF71`,
`PG306`, `PG326`, `PG51`, `PG525`, `PG608`, `PG609`, `PG61`, `PG610`, `PG611`, `PG71`,
`PP306`, `PP326`, `PP51`, `PP525`, `PP608`, `PP609`, `PP61`, `PP610`, `PP611`, `PP71`.

No code was removed from the loadable set.

## Exact-value checks

| Code | MRP | Effective date |
|---|---:|---|
| P10A12 | 7,354.00 | 2026-08-10 |
| BOS-108 | 1,990.00 | 2026-08-01 |
| P10A04 | 168.00 | 2026-08-10 |
| PF326 | 515.20 | 2026-08-10 |
| PF71 | 10,060.20 | 2026-08-10 |
| CCL-60-BSK | 1,190.00 | 2026-09-01 |

No workbook price differs from its two-decimal rounded value by more than half a paisa.

## Exclusions and discontinuations

- Reference-only excluded rows: 142
- Discontinued codes with `discontinued_from`: 233
- The 15 held-out `-VB` codes were not added by v2. They already existed in the development catalogue before this load and remained unchanged:
  `121-VB`, `124-VB`, `127-VB`, `129-VB`, `130-VB`, `132-VB`, `1322-VB`, `133-VB`, `134-VB`, `135-VB`, `1375-VB`, `144-VB`, `145-VB`, `147-VB`, `149-VB`.

## Preserved catalogue names

The load batch records 11 named source disagreements. Nine were identified during preflight; two more (`UH82-F`, `UH82-L`) became visible during the complete load and were added to the same explicit policy.

The current catalogue contains zero `TRIANGULER` names. The preserved codes are:

`CH72`, `CH72F`, `CH72QS`, `CH82`, `CH82F`, `UH-72`, `UH72-S`, `UH82`, `UH82-S`, `UH82-F`, `UH82-L`.

## Unaffected controls

- Hardware replacement audit batch: 866
- Hardware September rows: 285
- Hardware revisions/additions: 277 / 8
- `CCL-60-BSK` remains 1,190 at 2026-09-01.
- Sparsh Pearl has 150 distinct mappings and all 150 resolve to catalogue products (300 rows across its two periods).

## Production status

Development is loaded and verified. Production still requires publishing this loader version and uploading the exact verified v2 workbook through the administrator-only **Load MRP** form with download date 2026-09-07.