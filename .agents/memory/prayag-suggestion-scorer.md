---
name: Prayag suggestion scorer (match quality)
description: How the unmatched-competitor → catalog suggestion engine is tuned, and why.
---

# Prayag suggestion scorer

The fuzzy suggestion engine proposes catalog matches for unmatched competitor
rows. Three independent channels: text (product-type wording), category
similarity, and size.

## Catalog size lives in the product name, not the `size` column
The Prayag catalog `size` column is mostly null. The real nominal size is
embedded in the product name (e.g. "COUPLER 75 mm - 2.5 KG", "... 1/2 inch 15
mm", reducers "20x15 mm"). Parse the **last `<num> mm` group** to get the
canonical size. Competitor sheets carry a bare nominal number ("75", "1/2\"").
- **Why:** size matching must be exact, not a substring scan — `"200"` contains
  `"20"`, so a substring match made a 200 mm coupler look like a 20 mm one.
- **How to apply:** size is parsed at candidate-build time as a fallback and
  also persisted (seed insert + an idempotent startup backfill). `normSize`
  strips the `mm` unit and unifies `x`/×/spaces/quotes/unicode-fraction so
  catalog `"20 mm"` and competitor `"20"` compare equal.

## Keep category/division OUT of the text channel
The text channel must be **description-vs-productName only**. Category and
division are already scored by their own channel.
- **Why:** folding structural words ("agri", "fittings") into the text channel
  double-counts category and drowns the one discriminating product-type word
  ("coupler" vs "pipe"). With them included, a wrong-type but right-size **pipe**
  outranked a right-type **coupler** — the exact failure this engine must avoid.
- **How to apply:** in `suggest.ts`, comp text tokens come from `description`
  only; candidate text tokens from `productName` (+ parsed size) only.

## Token weighting: words beat numbers
Plain alphabetic tokens weigh 2; any token containing a digit weighs 1. Units /
ratings (`mm kg mtr sch sdr pn class oz ml tin isi mark` …) are stopwords.
- **Why:** product-type words decide a match; incidental numbers (a "10 KG"
  pressure rating, a gauge) and units are noise — the dedicated size channel
  already handles the real dimension.
