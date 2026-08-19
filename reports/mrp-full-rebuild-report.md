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

### Canonical comparison definition

This readback and the live Competition Analysis dashboard use the same
definition in `artifacts/api-server/src/lib/analysis.ts`:

- **Population:** latest *confirmed matched*, priced competitor revision on or
  before the selected as-of date, per `(competitor, matched_prayag_code)`.
  The `match_status = 'matched'` predicate is applied before choosing the
  latest revision, so a later row sent back to review does not erase an
  earlier confirmed mapping. It must join to an active, non-discontinued
  Prayag catalog product with an approved, non-null MRP in force on that date.
  Null-price, unmatched, inactive, discontinued, future, and superseded rows
  are excluded.
- **Price basis:** `price_basis = 'Ex-GST'` rows are grossed up by their
  `gst_pct` (18% when absent). Legacy rows marked `Rate (ex-GST)` are also
  grossed up by 18%. MRP rows are used as listed. Per-metre normalization is a
  Product Database row-display aid only and never changes the official report
  aggregate.
- **Price period:** both prices are the latest eligible revisions on or before
  the same as-of date. A later scheduled MRP or competitor upload is not used.
- **Sign and rounding:** gap = `(competitor effective price − Prayag MRP) /
  Prayag MRP × 100`. Positive means Prayag is cheaper; negative means Prayag
  is costlier. Calculate each row at full precision, take the sample median,
  then round the displayed aggregate to one decimal.

The following PostgreSQL query is the reproducible database equivalent of the
dashboard calculation. Substitute the as-of date and competitor only; do not
change the joins, filters, or formula.

```sql
WITH params AS (
  SELECT DATE '2026-08-19' AS as_of_date, 'Sparsh Pearl'::text AS competitor
),
current_competitor AS (
  SELECT DISTINCT ON (cp.competitor, cp.matched_prayag_code)
    cp.id,
    cp.matched_prayag_code,
    cp.price,
    cp.unit,
    cp.price_basis,
    cp.gst_pct
  FROM competitor_prices cp
  CROSS JOIN params p
  WHERE cp.competitor = p.competitor
    AND cp.match_status = 'matched'
    AND cp.matched_prayag_code IS NOT NULL
    AND cp.price IS NOT NULL
    AND cp.effective_date <= p.as_of_date
  ORDER BY cp.competitor, cp.matched_prayag_code, cp.effective_date DESC, cp.id DESC
),
current_prayag AS (
  SELECT DISTINCT ON (h.item_code) h.item_code, h.mrp
  FROM mrp_price_history h
  CROSS JOIN params p
  WHERE h.review_status = 'approved'
    AND h.mrp IS NOT NULL
    AND h.effective_date <= p.as_of_date
  ORDER BY h.item_code, h.effective_date DESC, h.id DESC
),
comparable AS (
  SELECT
    cc.id,
    ((CASE
      WHEN cc.price_basis = 'Ex-GST'
        THEN cc.price * (1 + COALESCE(cc.gst_pct, 18) / 100.0)
      WHEN cc.price_basis IS NULL AND btrim(COALESCE(cc.unit, '')) = 'Rate (ex-GST)'
        THEN cc.price * 1.18
      ELSE cc.price
    END) - pr.mrp) / pr.mrp * 100.0 AS gap_pct
  FROM current_competitor cc
  JOIN catalog_products product ON product.item_code = cc.matched_prayag_code
  JOIN current_prayag pr ON pr.item_code = product.item_code
  CROSS JOIN params p
  WHERE product.is_active IS TRUE
    AND (product.discontinued_from IS NULL OR product.discontinued_from > p.as_of_date)
    AND pr.mrp > 0
)
SELECT
  count(*) AS comparable_skus,
  round(
    percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_pct)::numeric,
    1
  ) AS median_gap_pct
FROM comparable;
```

Using that definition across 140 priced Sparsh mappings on 2026-08-19:
- Before: -8.48% median
- After: -0.99% median

This does not match the prompt’s illustrative +3% to +10.8% expectation. The report preserves the database-derived result rather than modifying data to fit that figure.
