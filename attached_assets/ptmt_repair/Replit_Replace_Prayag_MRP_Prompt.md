# Replit Prompt — Replace the Prayag MRP data (dev + production)

The Prayag MRP currently in `mrp_price_history` is contaminated: for PTMT, **packing quantities were loaded instead of prices**. This replaces Prayag's price data from a single clean, verified file. Competitor data is not touched.

> Upload `Prayag_MRP_Master_AllPeriods.xlsx`, then paste everything below (from **GOAL**) into the Replit AI Agent.

---

## GOAL

Replace all Prayag MRP data in `mrp_price_history` (and top up `catalog_products`) from the uploaded file, in **dev first, then production**. Competitor tables (`competitor_prices`, `competitor_price_staging`, `import_batches`, `competitor_code_aliases`) must not be modified.

### Why this is needed

The PTMT source workbook's `MASTER` sheet has columns `OLD MRP` (col 4), `NEW MRP` (col 5), **`PACKING` (col 6)**. The loader took the packing column. Evidence: item `121-B` has NEW MRP **244** but the database holds **108** (its master-box packing figure); `121-C` has NEW MRP **264** but the database holds **66**. Across the table, **1,680 items** currently carry an MRP under ₹50, of which **1,313 are PTMT** — in the clean file only **18** PTMT items are genuinely under ₹50.

---

## 1. The uploaded file

`Prayag_MRP_Master_AllPeriods.xlsx` — built from **every sheet** of the six official dated Prayag MRP files (not just the MASTER sheets — the "Without Brass" fitting ranges and other sub-range sheets are included), with packing/qty/diff columns explicitly excluded.

| Sheet | Contents |
|---|---|
| `catalog_products` | **6,330 items** — `item_code`, `product_name`, `division` |
| `mrp_price_history` | **13,485 rows** — every period per item: `item_code`, `division`, `product_name`, `mrp`, `price_basis`, `effective_date`, `is_current`, `status`, `increase_pct_vs_prev` |
| `current_mrp` | **6,262 rows** — one per item: `mrp_current` + `effective_date`, plus `mrp_upcoming` + `upcoming_date` where a future revision exists |
| `validation` | Counts and spot-check values |

`status` is one of `Previous`, `Current`, `Upcoming`. **`Upcoming` rows are future-dated** (e.g. PTMT w.e.f. 01 Sep 2026) and carry `is_current = FALSE` — load them, but they must not drive today's comparisons.

## 2. Replace Prayag price data only

1. **Back up first.** Copy the existing `mrp_price_history` to `mrp_price_history_backup_20260817` (or export it) before deleting anything, so the change is reversible.
2. **Delete all rows** from `mrp_price_history`. Do **not** touch any competitor table.
3. **Load** the `mrp_price_history` sheet as-is: one row per item per period, preserving `effective_date`, `is_current`, and `price_basis = 'MRP'`.
4. **Top up `catalog_products`** from the `catalog_products` sheet — upsert on `item_code` (insert missing, refresh `product_name` and `division`). Do not delete existing catalog rows: competitor mappings reference them by `item_code`.
5. **Report orphans** — `mrp_price_history` rows whose `item_code` has no `catalog_products` match, and `competitor_prices` rows whose `matched_prayag_code` has no match. List the codes; do not auto-delete.

## 3. Resolve the current price by date, not by the stored flag

`is_current` is a stored boolean that goes stale — nothing flips it when a future period comes into force. After loading, resolve prices **by date at query time**:

```sql
SELECT DISTINCT ON (item_code) mrp, effective_date
FROM mrp_price_history
WHERE item_code = ... AND effective_date <= :asOf
ORDER BY item_code, effective_date DESC, id DESC
```

`:asOf` = the selected period filter, defaulting to `CURRENT_DATE`. Apply the same pattern to `competitor_prices` per (competitor, matched_prayag_code). Keep `is_current` only as a denormalised convenience, never as the source of truth.

This matters immediately: **PTMT's 01 Sep 2026 revision is 2 weeks away.** On 1 September the correct Prayag price changes by itself, with no re-import and no flag recompute.

## 4. Guard the loader so this cannot recur

When importing any MRP file:

- **Reject any column whose header matches** `/box|pcs|packing|qty|coupon|diff|%age|weight/i`. Prices come only from columns whose header contains `MRP` or a date.
- After import, report **how many items fell below ₹50 per division**. If that exceeds ~2% of a division, **stop and flag the import** instead of committing it. Expected clean baseline: PTMT 12/2,050 · CP 1/1,489 · Sanitaryware 0/218 · Hardware 2/280 · Pipes & Fittings 293/2,293.
- Pipes & Fittings genuinely has ~293 items under ₹50 (small CPVC elbows, couplings, flanges — e.g. `C41` Coupling ½" at ₹14.80). **Do not treat low value alone as an error**; only the sudden jump in count signals a bad column.

## 5. Order of work

1. Apply in **dev**. Run the validation below.
2. Only once dev passes, apply the identical steps in **production**, with its own backup taken first.
3. Report row counts before and after for both environments.

---

## Validation (must pass before production)

| Item | Expected current MRP |
|---|---|
| `121-B` | **244.08** (w.e.f. 2026-04-20) — not 108 |
| `121-C` | **263.52** (w.e.f. 2026-04-20) — not 66 |
| `CNS-15` | **1020** (w.e.f. 2026-08-01) |
| `U21` | **78** (w.e.f. 2026-02-01) |
| `C854` | **44.40** (w.e.f. 2026-02-01) |

Also confirm:

- `mrp_price_history` holds **13,485** rows across **6,330** items; **4,902** items have more than one period.
- Items with MRP < ₹50 drop from **1,680** to about **308**, and PTMT specifically from **1,313** to **12**.
- No competitor table row counts changed.
- Querying with `asOf = 2026-09-01` returns the 01 Sep PTMT prices **without any re-import**; querying with today's date does not.
- Re-export the Sparsh Pearl review: `WC-182` should show Prayag MRP **144** and a gap near **+5%**, not +115.7%.
