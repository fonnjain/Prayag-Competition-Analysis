---
name: MRP Generator safety boundary
description: Durable safety rules for deterministic price suggestions and revision handoff.
---

MRP Generator runs are immutable decision records, not price mutations. Missing required inputs must produce explicit exclusions. Once a change-limit or hold constraint becomes binding, later rules cannot relax it.

Selected suggestions may only create an existing MRP revision preview. Handoff must revalidate the exact current approved Standard row, value, and effective date; a single preview cannot mix effective periods. Applying the preview performs the same identity and stale-value checks again.

**Why:** A saved scenario can be rerun later against changed price history. Allowing direct writes, stale source rows, mixed periods, or silently missing data would make a deterministic recommendation appear authoritative while changing the wrong commercial baseline.

**How to apply:** Keep generation read-only. Preserve complete ordered traces and input snapshots. Route every accepted suggestion through the revision lifecycle with scenario/run provenance and reject stale, future-dated, mixed-period, or ineligible selections.

P011 policies use independently configurable master-category margin floors and five cumulative sales-value bands: A first 50%, B to 80%, C to 95%, D to 99%, and E remainder. Band F is reserved for no-sales catalogue products and is always excluded; never use percentile bands.

**Why:** Measured category margins vary too widely for one global floor, and sales value is highly concentrated, so percentile tiers group commercially incomparable products and misclassify no-sales products as low-sales products.

**How to apply:** Enable these controls only when the Sales API authenticates and supplies period, coverage, held-period, sales-value, quantity, and margin inputs. Recompute bands on the complete Sales snapshot for each run and preserve the period, policy version, band, competitive position, action, and applied category floor in immutable snapshots and traces.

Gross-margin floors translate to a minimum suggested MRP by first deriving per-unit BOM from the covered period, then computing `required realized sale = unit BOM / (1 - floor)` and `required MRP = required realized sale / (1 - observed discount fraction)`. Missing usable quantity, BOM, margin, or discount evidence excludes the product instead of estimating.

**Why:** Period-total BOM is not dimensionally comparable with a per-unit MRP; using it directly multiplies the floor by sales quantity. Preserving the observed discount is the deterministic way to convert the required realized sale back to list MRP.

**How to apply:** Use only Sales API rows with usable piece quantity; never substitute water-tank litres for pieces. Treat the computed minimum as binding, so later competitive or rounding rules cannot relax it.

Portfolio gross-margin targets are reports, not optimizers. If a policy misses its target, report the shortfall and rank remaining feasible capture headroom; never silently move additional prices to solve the portfolio target.

**Why:** Automatically solving to a portfolio number would produce recommendations that cannot be traced to one band, competitive position, and action rule.

**How to apply:** Compute current and proposed portfolio gross margin only over products with usable quantity, unit cost, and discount evidence. Report omissions explicitly and leave policy changes to the administrator.