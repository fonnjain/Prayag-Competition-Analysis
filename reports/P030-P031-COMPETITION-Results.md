# P030 and P031 — COMPETITION Verification Reports

Prepared 23 September 2026  
Application: COMPETITION / prayag-price.com

---

# P030 — Verify what P029 classified

## Executive verdict

**Verdict (a): No field encodes joint type, fit type, or connection type.**

P029 did not copy a Ring Fit designation onto the Self Fit products because no such classification field exists in catalog_products. Part 2 did not run. Nothing was written or changed.

## Classification schema

| Field | Database type | Required | Permitted values |
|---|---|---:|---|
| product_name | text | No | Free text; no enumeration |
| division | text | No | Free text; no enumeration |
| category | text | No | Free text; no enumeration |
| series_range | text | No | Free text; no enumeration |
| size | text | No | Free text; no enumeration |
| uom | text | Yes | Free text; default NOS; no enumeration |
| kg_cost | double precision | No | Any valid numeric value; no enumeration |

There is no field for joint type, fit type, connection type, Ring Fit/Self Fit, or socket type. The database has no check constraint or enum restricting these text fields.

## Side-by-side catalogue values

| Field | U-11C Ring Fit | U-11CS Self Fit | U-11B Ring Fit | U-11BS Self Fit |
|---|---|---|---|---|
| Product name | UGD PIPE (6 MTR) SN-8 | UGD SELF FIT PIPE (6 MTR) SN-8 | UGD PIPE (6 MTR) SN-4 | UGD SELF FIT PIPE (6 MTR) SN-4 |
| Division | Pipes & Fittings | Pipes & Fittings | Pipes & Fittings | Pipes & Fittings |
| Category | UGD Pipe | UGD Pipe | UGD Pipe | UGD Pipe |
| Series | UGD Pipe | UGD Pipe | UGD Pipe | UGD Pipe |
| Size | NULL | NULL | NULL | NULL |
| UOM | NOS | NOS | NOS | NOS |
| KG cost | NULL | NULL | NULL | NULL |

The only field distinguishing the two joint types is product_name. Existing Self Fit names already explicitly include SELF FIT.

## P029 verification values

| Check | Actual value |
|---|---|
| Active Pipes & Fittings Uncategorized count | 3 |
| Uncategorized codes | 20, 25, 32 |
| Division on all ten Self Fit products | Pipes & Fittings — 10/10 |
| Series on all ten Self Fit products | UGD Pipe — 10/10 |
| UGD Pipe filter result | 20 active products |
| mrp_price_history count | 14,102 |
| mrp_price_history checksum | 2755603152dd835de5c533c039853fac |
| Competitor-price rows mapped to the ten | 7 |
| Needs Review/staging rows referring to the ten | 14 |
| Self Fit MRP equals sibling MRP | 10/10 equal |
| Codes 20, 25, and 32 | Untouched |

P030 made no write. MRP history before and after remained 14,102 rows with checksum 2755603152dd835de5c533c039853fac. The competitor mapping diff was empty.

## Prince prices retained

| Prayag code | Prince price |
|---|---:|
| U-11CS | ₹2,951.40 |
| U-13BS | ₹5,303.40 |
| U-13CS | ₹6,182.10 |
| U-14BS | ₹8,064.00 |
| U-14CS | ₹9,675.00 |
| U-15CS | ₹15,075.00 |
| U-16CS | ₹24,074.40 |

## Self Fit and sibling MRP equality

| Ring Fit → Self Fit | Ring Fit MRP | Self Fit MRP |
|---|---:|---:|
| U-11C → U-11CS | ₹2,987 | ₹2,987 |
| U-12C → U-12CS | ₹4,582 | ₹4,582 |
| U-13C → U-13CS | ₹6,322 | ₹6,322 |
| U-14C → U-14CS | ₹10,005 | ₹10,005 |
| U-15C → U-15CS | ₹15,805 | ₹15,805 |
| U-16C → U-16CS | ₹25,230 | ₹25,230 |
| U-11B → U-11BS | ₹2,196 | ₹2,196 |
| U-12B → U-12BS | ₹2,896 | ₹2,896 |
| U-13B → U-13BS | ₹4,790 | ₹4,790 |
| U-14B → U-14BS | ₹7,368 | ₹7,368 |

## All 20 UGD Pipe names

### SN-8

| Ring Fit | Self Fit |
|---|---|
| U-11C — UGD PIPE (6 MTR) SN-8 | U-11CS — UGD SELF FIT PIPE (6 MTR) SN-8 |
| U-12C — UGD PIPE (6 MTR) SN-8 | U-12CS — UGD SELF FIT PIPE (6 MTR) SN-8 |
| U-13C — UGD PIPE (6 MTR) SN-8 | U-13CS — UGD SELF FIT PIPE (6 MTR) SN-8 |
| U-14C — UGD PIPE (6 MTR) SN-8 | U-14CS — UGD SELF FIT PIPE (6 MTR) SN-8 |
| U-15C — UGD PIPE (6 MTR) SN-8 | U-15CS — UGD SELF FIT PIPE (6 MTR) SN-8 |
| U-16C — UGD PIPE (6 MTR) SN-8 | U-16CS — UGD SELF FIT PIPE (6 MTR) SN-8 |

### SN-4

| Ring Fit | Self Fit |
|---|---|
| U-11B — UGD PIPE (6 MTR) SN-4 | U-11BS — UGD SELF FIT PIPE (6 MTR) SN-4 |
| U-12B — UGD PIPE (6 MTR) SN-4 | U-12BS — UGD SELF FIT PIPE (6 MTR) SN-4 |
| U-13B — UGD PIPE (6 MTR) SN-4 | U-13BS — UGD SELF FIT PIPE (6 MTR) SN-4 |
| U-14B — UGD PIPE (6 MTR) SN-4 | U-14BS — UGD SELF FIT PIPE (6 MTR) SN-4 |

## Creation-path finding

The bulk new-product input schema did not carry or require category. It accepted division and series and created the products with category = NULL. That is why the ten products entered the active Uncategorized bucket. P030 was read-only and did not change this creation path.

---

# P031 — Why past price periods are not showing

## Executive finding

mrp_price_history contains **14,102 rows**. The historical rows are present. The public product-detail display filters them out.

The cause is not a fixed six-period list. The public Price Finder product endpoint intentionally returns only the current price and the next future price. The dedicated Analysis price-history endpoint returns all historical rows.

No code or data was changed during P031.

## Effective-date comparison

| Effective date | Source rebuild | Database | Difference |
|---|---:|---:|---:|
| 2017-12-01 | 49 | 49 | 0 |
| 2022-01-01 | 106 | 106 | 0 |
| 2024-02-15 | 161 | 161 | 0 |
| 2024-05-01 | 1,284 | 1,284 | 0 |
| 2024-06-01 | 277 | 277 | 0 |
| 2025-01-15 | 292 | 292 | 0 |
| 2025-04-01 | 67 | 67 | 0 |
| 2025-07-01 | 56 | 56 | 0 |
| 2026-01-01 | 292 | 292 | 0 |
| 2026-01-15 | 555 | 704 | +149 |
| 2026-02-01 | 2,244 | 2,249 | +5 |
| 2026-03-01 | 277 | 277 | 0 |
| 2026-03-05 | 2,167 | 2,167 | 0 |
| 2026-05-01 | 1,704 | 2,024 | +320 |
| 2026-08-01 | 1,071 | 1,071 | 0 |
| 2026-08-10 | — | 590 | Additional period |
| 2026-08-19 | — | 1 | Additional period |
| 2026-09-01 | 2,148 | 2,435 | +287 |
| Total | 12,750 | 14,102 | +1,352 |

The extra 1,352 rows reconcile to later authoritative loads, variant rows, manual provenance, and new-product loads. The original history is not missing.

## Period-count distribution

| Periods per product | Source rebuild | Current database | Difference |
|---:|---:|---:|---:|
| 1 | 802 | 751 | -51 |
| 2 | 5,117 | 4,369 | -748 |
| 3 | 83 | 896 | +813 |
| 4 | 52 | 92 | +40 |
| 5 | 246 | 246 | 0 |
| 9 | 3 | 3 | 0 |
| Products | 6,303 | 6,357 | +54 |

Later loads added products and gave many existing products a third or fourth period.

## How period lists are built

### Analysis dashboard

The dashboard reads distinct effective dates directly from mrp_price_history, unions them with competitor dates, sorts descending, and renders all periods. There is no configured six-period list.

Decisive query:

    SELECT DISTINCT effective_date
    FROM mrp_price_history
    ORDER BY effective_date DESC

Code locations: artifacts/api-server/src/routes/analysis.ts:700–723 and artifacts/prayag-analysis/src/pages/dashboard.tsx:346–364.

### Dedicated price-history table

The price-history endpoint returns every approved Standard MRP row for the requested product, ordered by effective date and ID. It has no date floor, LIMIT, fixed period list, or stored is_current filter.

Code locations: artifacts/api-server/src/routes/analysis.ts:836–843 and artifacts/prayag-analysis/src/components/dashboard/OpportunitiesThreats.tsx:271–294.

### Public Price Finder product detail

The public endpoint selects only:

1. The latest price on or before today.
2. The earliest future price, if one exists.

Current price logic:

    effective_date <= CURRENT_DATE
    ORDER BY effective_date DESC, id DESC
    LIMIT 1

Upcoming price logic:

    effective_date > CURRENT_DATE
    ORDER BY effective_date ASC, id DESC
    LIMIT 1

Code locations: artifacts/api-server/src/routes/priceFinder.ts:842–863 and artifacts/prayag-price-finder/src/pages/home.tsx:1090–1154.

The public product screen is therefore not a price-history screen.

### Historical MRP and revision views

The revision workflow is organized around one selected existing effective date. It is not a general history browser. Revision uploads require a locked effective date and reject rows carrying another date. The MRP Generator’s historical model displays generated historicalSeries entries, not the raw catalogue history table.

## is_current audit

The investigated display paths do not use stored mrp_price_history.is_current as their source of truth. History status is derived from effective date, the requested as-of date, and the highest ID for duplicate dates.

Stored is_current remains in compatibility recomputation code:

- artifacts/api-server/src/lib/catalog.ts:22–29
- artifacts/api-server/src/lib/catalogSync.ts:791–807
- artifacts/api-server/src/routes/catalogImportExport.ts:4046–4128

These paths reset or recompute the flag; they do not hide historical periods in the investigated screens.

## Known-product comparison

### TTS-01

| Date | Database MRP |
|---|---:|
| 2024-05-01 | ₹34 |
| 2025-01-15 | ₹34 |
| 2026-01-01 | ₹34 |
| 2026-01-15 | ₹34 |
| 2026-02-01 | ₹34 |
| 2026-03-05 | ₹34 |
| 2026-05-01 | ₹36 |
| 2026-08-01 | ₹36 |
| 2026-09-01 | ₹36 |

The source expectation says ₹34 for 1 September, but the database contains ₹36 from authoritative batch 865.

- Public product detail: one current row — ₹36 from 2026-09-01.
- Dedicated price-history table: all 9 rows.

### Product 451

| Date | MRP |
|---|---:|
| 2025-01-15 | ₹690 |
| 2026-01-01 | ₹690 |
| 2026-01-15 | ₹790.40 |
| 2026-05-01 | ₹730 |
| 2026-08-01 | ₹730 |

- Public product detail: ₹730 from 2026-08-01.
- Dedicated price-history table: all 5 rows.

### Product 453

| Date | MRP |
|---|---:|
| 2025-01-15 | ₹340 |
| 2026-01-01 | ₹370 |
| 2026-01-15 | ₹380 |
| 2026-05-01 | ₹430 |
| 2026-08-01 | ₹430 |

- Public product detail: ₹430 from 2026-08-01.
- Dedicated price-history table: all 5 rows.

### Product 1179

| Date | MRP | Source |
|---|---:|---|
| 2026-03-05 | ₹589.56 | All-periods rebuild |
| 2026-09-01 | ₹638 | Authoritative master v2 |

The rebuild had one row. A later authoritative load added the second period.

- Public product detail: ₹638 from 2026-09-01.
- Dedicated price-history table: both rows.

## Revision-upload investigation

### Most recent revision upload

Revision batch 18:

- File: MRP_Revision_Upload_Template_1787838250278.xlsx
- SHA-256: c5f4ecb5f5d1fc66ac8ab5c588028a29e7a853e280cb885fc2363f010729c8ca
- Uploaded: 27 August 2026
- Actor: deepakj@prayagindia.com
- Rows in file: 343
- Changed: 0
- No-op: 343
- Rejected: 0
- Effective date represented: 2026-03-05
- Final status: discarded

It wrote no prices and cannot explain missing display periods.

### Most recent mrp_load_batches row

Batch 1495 is the P029 classification audit. It records 10 correction rows but has zero linked MRP rows. It is not a price load.

### Most recent batch that inserted MRP rows

Batch 1301:

- File: New_Products_-_Prayag.xlsx
- SHA-256: b50914c28bdbf81c54dd8f2c1eb5d0660a125f65ff837b8ecbe096b84ba4b73b
- Downloaded/loaded: 17 September 2026
- Actor: replit-agent-p019@local
- Inserted: 10
- Updated: 0
- Effective date: 2026-08-10
- Upload/load date stored separately: 2026-09-17

The inserted products were U-11BS, U-11CS, U-12BS, U-12CS, U-13BS, U-13CS, U-14BS, U-14CS, U-15CS, and U-16CS. The rows were added alongside history and did not replace existing same-period rows.

## P031 conclusion

**Rows are present but filtered by the display being used.**

The public Price Finder product-detail endpoint intentionally returns only current and next MRP records through LIMIT 1 queries. It never returns superseded history. The dedicated Analysis price-history endpoint already returns all historical rows without a date floor, stored-current filter, or row limit.
