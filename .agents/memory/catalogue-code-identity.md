---
name: Catalogue code identity
description: Why normalization cannot establish product identity, even for apparently unambiguous variants.
---

Item-code identity is exact only, including case, punctuation, and every space.
Distinct valid catalogue codes can collapse to the same normalized key.

**Why:** Verification against the live development catalogue exposed collisions
that a simplified fixture did not contain. Treating all normalized codes as
globally unique incorrectly blocked an otherwise valid scoped import.

**How to apply:** Preserve both products. Never use normalized, case-insensitive
or punctuation-insensitive fallbacks for source-to-catalogue identity, even when
a source looks unambiguous. Never merge or rename products to make a normalized
key unique. Fuzzy competitor matching may use normalization only as a ranking
signal, never as an equality decision.

Internal whitespace is business-significant, not merely an input-format defect.
The user confirmed that `TTS-01` and `TTS - 01`, and `DB-02L` and `DB-02 L`,
are genuinely different products. A shared normalizer is for comparison or
candidate lookup, never an equality test between distinct stored codes.

**Why:** Removing internal spaces can conflate different products and their
price histories even when there are currently no orphan competitor joins.

**How to apply:** Classification mappings use exact stored codes. Do not
re-point authoritative storage normalization or change what a loader stores
as part of consolidating lookup helpers.

Checking whether one production code has several conflicting source matches is
not sufficient: a source row may already be claimed by an exact product, or
several different production products may claim that same source row.

**Why:** The user withdrew an entire explicitly enumerated variant mapping after
both reverse-direction ambiguity cases appeared. Even a one-to-one looking
punctuation variation does not establish business identity.

**How to apply:** Do not revive variant-based mapping exceptions. Missing exact
codes remain unmapped and retain their current classification.
