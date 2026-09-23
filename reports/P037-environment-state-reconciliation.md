# P037 environment state reconciliation

Read-only snapshot. No synchronization or mutation was performed.

## Snapshot window
- Development: 2026-09-23 13:06:38.840619 UTC
- Production: 2026-09-23 13:06:44.712848 UTC
- Separation: 5.872 seconds

## Counts and existing database checksums
| Environment | MRP rows | MRP checksum | Catalog products | null load_batch_id |
|---|---:|---|---:|---:|
| Development | 14,012 | fe8c5b25df301e1067914e4d0e9af089 | 6,946 | 0 |
| Production | 14,252 | df86f87bd7fd189379508a0f4c786a96 | 7,141 | 243 |

## MRP reconciliation
- Development-only rows by code/date: 3
- Production-only rows by code/date: 243
- Net: production has 240 more rows
- Shared code/date rows with different price state: 343 (development decimals vs production whole-rupee values for the 5 March 2026 set)
- All 243 production-only rows are exactly the 243 production rows with NULL load_batch_id: 240 dated 2026-08-10 and 3 dated 2026-09-01.

## Catalog product code reconciliation
- Development-only codes: 36
- Production-only codes: 231
- Net: production has 195 more products

## Copy/reseed conclusion
Development is not a full copy of production. The latest real cross-environment catalog-domain sync was development to production, not production to development: bundle 2af927e902f83ed6533203cc48459a8119c3232c20b4414f5988bf074a205703, created 2026-08-19 11:27:26.018 UTC and applied in production from 11:44:50.480250 to 11:44:54.086 UTC by ceo@prayagindia.com. There is no recorded production-to-development reseed date. The sync scope is itself only the catalog domain, not the full application database.

See the CSV for every code/date and product-code difference.
