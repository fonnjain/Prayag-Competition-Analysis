# Production division mapping — recovery record

## Completed operation

| Reference | Verified value |
|---|---|
| Applied load batch | **90** |
| Preview ID | **4** |
| Applied time | **18 October 2026, 15:25:25 IST** |
| Applied changes | **294**, exact reviewed item-code/from/to triples |
| Mapping source | `Division_Mapping_from_ERP_RateList_v3.xlsx` |
| Mapping SHA-256 | `1bf4f5f7069bce442077735c5b5dc86aea3c7bdc0cbbf1b18153db3c89a5da87` |
| Independent 294-row restore XLSX SHA-256 | `4dca4333edcfd7b1ed5b2cf77c17677aa92d985aabc3b505301de8c227057042` |

The restored divisions in the recovery sheet are the **pre-apply** values,
including the original composite strings. It is not a new mapping source.

Evidence and recovery files:

- `generated-artifacts/p068/P068-production-apply-report.md`
- `generated-artifacts/p068/P068-production-restore-294-before-apply.xlsx`
- `generated-artifacts/p068/P068-production-restore-294-before-apply.csv`
- `generated-artifacts/p068/P068-recovery-and-verification.zip`

The report and ZIP were delivered to the user as downloadable assets.
Generated evidence is deliberately excluded from Git and deployment images.

## Standing operating boundary

**Do not apply the division mapping again. Do not invoke Undo on batch 90
merely to test its availability.** The accepted division data stays in place.
Use read-only table queries, not another Preview, for subsequent checks.
Preview creates pending/provenance records even when it proposes zero changes.

Undo's mechanism was proven against development's real full change set before
production. A future recovery operation needs an explicit decision based on
the actual failure; do not choose automatically between Undo and the restore
sheet.

The post-apply data assertions passed at **15:26:07 IST, 18 October 2026**:

| Division | Products |
|---|---:|
| Pipes & Fittings | 2,750 |
| PTMT & Plastic Fittings | 2,152 |
| CP Fittings / Faucets | 1,383 |
| Hardware | 288 |
| Sink | 235 |
| Ceramic Sanitaryware | 222 |
| CP (QUAA / FERN) | 161 |
| **Total** | **7,191** |

Composites: **0**. Exact codes, categories, other catalogue metadata, all
**14,302** MRP-history rows and all **3,770** competitor-price rows were
unchanged by this division-only operation.
