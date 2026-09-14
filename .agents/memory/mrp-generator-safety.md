---
name: MRP Generator safety boundary
description: Durable safety rules for deterministic price suggestions and revision handoff.
---

MRP Generator runs are immutable decision records, not price mutations. Missing required inputs must produce explicit exclusions. Once a change-limit or hold constraint becomes binding, later rules cannot relax it.

Selected suggestions may only create an existing MRP revision preview. Handoff must revalidate the exact current approved Standard row, value, and effective date; a single preview cannot mix effective periods. Applying the preview performs the same identity and stale-value checks again.

**Why:** A saved scenario can be rerun later against changed price history. Allowing direct writes, stale source rows, mixed periods, or silently missing data would make a deterministic recommendation appear authoritative while changing the wrong commercial baseline.

**How to apply:** Keep generation read-only. Preserve complete ordered traces and input snapshots. Route every accepted suggestion through the revision lifecycle with scenario/run provenance and reject stale, future-dated, mixed-period, or ineligible selections.

Future Sales-dependent rules must use independently configurable master-category margin floors. Volume tiers must use A/B/C cumulative sales-value contribution (80% / next 15% / remainder) or explicit sales-value thresholds; never percentile bands. Products without sales or usable margin remain excluded.

**Why:** Measured category margins vary too widely for one global floor, and sales value is highly concentrated, so percentile tiers group commercially incomparable products and misclassify no-sales products as low-sales products.

**How to apply:** Keep these controls visible but unavailable until the Sales API supplies period, coverage, held-period, sales-value, quantity, and margin inputs. Preserve the selected period and applied category floor in run snapshots and traces once enabled.