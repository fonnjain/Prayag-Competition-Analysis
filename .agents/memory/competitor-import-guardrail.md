---
name: Competitor import price-gap guardrail
description: Why auto-matched competitor imports must reject far-out price gaps, and how the verified manual reupload path differs.
---

# Competitor import price-gap guardrail

Auto-matched competitor imports (`POST /catalog/load-competitor` in
`artifacts/api-server/src/routes/catalogImportExport.ts`) must NOT blindly trust a
file's `matched_prayag_code` just because the code exists in the catalog. After
confirming the code exists, compute the gap vs Prayag's current MRP using the SAME
basis as the analysis engine:

`gap% = (effectivePrice(unit, price) - prayagMrp) / prayagMrp * 100`
(positive = competitor more expensive; `effectivePrice` grosses up only when
`unit === "Rate (ex-GST)"`, see `lib/analysis.ts`).

If gap% is outside ~`[-80, +100]`, downgrade the row to
`match_status = "no match (review)"` and clear `matched_prayag_code` /
`match_confidence`. Skip the check when current MRP is missing or `<= 0`.

**Why:** the original data bug was a Prince "PPR Welding Set" priced ₹1,32,690
auto-matched (by category+type+size heuristic) to Prayag PG42, a ₹12.70 Coupler —
a +1,000,000% gap. A realistic equivalent-product gap for pipes & fittings is
roughly -60%..+50%; anything far outside almost always means the wrong products
were linked (big assembly vs tiny fitting, or per-box vs per-pc).

## Verified-sheet reload: header variations

The verified "HighMatch" competitor sheets are NOT all identical. A reload loader
must map columns by header name with these equivalences (case-insensitive):
`group` → category (pipes brands use `category`, sanitaryware use `group`);
`price_basis` → unit (value is usually "MRP", treated as-is); `competitor_product`
→ description; `competitor_mrp` → price; `prayag_item_code` → matched_prayag_code;
`match_status` defaults to "matched" and `match_confidence` to "High" when the
column is absent (Parryware/Sparsh/Ashirvad omit `match_status`). There is **no**
`competitor_code` column in `competitor_prices`, so the sheet's competitor SKU is
dropped on load. Build the Prayag side from `0_Prayag_Master_Upload` (catalog +
mrp tabs); fall back to the sheet's `prayag_description`/`prayag_mrp` only for codes
missing from the master. The full sanitaryware set (13 brands) legitimately shows
large positive median gaps (Astral/Truflo/Parryware/Ashirvad ~+22–24%); pipes run
roughly −34%…+10%. These are real, not mapping errors.

**How to apply:** the guardrail belongs only on the auto-matched import path.
Human-verified bulk reuploads (the "HighMatch" files, loaded verbatim via a direct
DB load) are trusted and intentionally bypass it — even though a handful of their
matched rows (e.g. premium-brand Reducer Bushings) legitimately exceed the band.
Expect the guardrail to add some manual-review workload for categories with
naturally wide spreads; thresholds are deliberately loose to limit false positives.
