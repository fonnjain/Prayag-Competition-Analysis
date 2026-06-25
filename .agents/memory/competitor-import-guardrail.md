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

**How to apply:** the guardrail belongs only on the auto-matched import path.
Human-verified bulk reuploads (the "HighMatch" files, loaded verbatim via a direct
DB load) are trusted and intentionally bypass it — even though a handful of their
matched rows (e.g. premium-brand Reducer Bushings) legitimately exceed the band.
Expect the guardrail to add some manual-review workload for categories with
naturally wide spreads; thresholds are deliberately loose to limit false positives.
