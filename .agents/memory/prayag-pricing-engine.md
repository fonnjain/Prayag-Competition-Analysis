---
name: Prayag pricing engine
description: Core competitiveness/recommendation rules for the Competition Console
---
Per-product competitiveness is recomputed in-memory each request from products + comparisons + settings (no denormalized cache; ~897 products is trivial).

- Each competitor compares on its own basis: net, mrp, or mixed (Avonplast). diff% = (comp - prayag)/prayag, **positive = Prayag cheaper**.
- Product status basis: net if any visible net rival exists AND prayagNet present, else mrp. Per-cell diff% always uses that cell's own basis.
- Status thresholds on shownPrice vs chosen-basis market: leader (≤min), competitive (≤median), above_market (≤max), overpriced (>max), no_data when no market.
- Recommendation: suggested = market_median×0.98, aggressive = market_min×0.98, both floored at kgCost×(1+minMargin%); marginConstrained flags when the floor raises the suggestion. Seed has kgCost=null so floors are inactive until cost entered.

**Import basis inference:** when a competitor sheet's price column has no explicit net/mrp header, infer basis by comparing imported price magnitude (median) against Prayag net vs mrp medians for the matched codes — do NOT default to net. Match is by Prayag item code only (no product names in data).
