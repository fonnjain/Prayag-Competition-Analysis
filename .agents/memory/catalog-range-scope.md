---
name: Approved product Range scope
description: Prayag's approved Range scope, optionality, and deferred Sink/category decisions
---

Prayag explicitly approved optional Range only for the exact stored divisions
“CP Fittings / Faucets”, “CP (QUAA / FERN)” and “PTMT & Plastic Fittings”.
Dev-only “PTMT”, combined division values, Pipes, Hardware and Ceramic are excluded.
Laboratory sinks stay in Ceramic; no Sink division may be invented or inferred.

**Why:** Many approved CP/PTMT products legitimately have no Range. New or
renamed divisions are not automatically known to Sales and can disappear from
Sales reporting. The user expressly deferred division cleanup and category
correction rather than authorizing it with the label change.

**How to apply:** Preserve existing hidden ranges, division spellings and
Sales contracts. Add any future Sink scope only after its division and Sales
mapping have been explicitly approved. Require a reviewed list before relabeling.

The authoritative master's `series` means Category outside the three approved
Range divisions, and Range inside them. Outside those three, Category = Range
is correct, not evidence of a loader error.

**Why:** Prayag clarified these source semantics after a missing-Category guard
incorrectly blocked prices for the whole existing catalogue.

**How to apply:** Existing catalogue products receive prices only; preserve all
existing catalogue fields. Missing Category in the master does not refuse an
existing product. Show supplied classification differences as “classification
differs — not changed”, with both values. For new non-Range products, source
series supplies Category and Range is omitted. Refuse new CP/PTMT products
without an explicit genuine Category individually with “new CP/PTMT product
needs a category: create it in the product editor”. Keep combined-division
products in a separate review; do not infer division aliases.