---
name: Catalogue code identity
description: Why whitespace-normalized catalogue codes are not globally unique identities.
---

Exact stored item codes take priority over normalized matching. Distinct valid
catalogue codes can collapse to the same whitespace-normalized key.

**Why:** Verification against the live development catalogue exposed collisions
that a simplified fixture did not contain. Treating all normalized codes as
globally unique incorrectly blocked an otherwise valid scoped import.

**How to apply:** Preserve both products. Prefer exact source-to-catalogue identity;
allow a normalized fallback only when it is unambiguous. Refuse unresolved
ambiguous source rows, and never let unrelated collisions block a scoped import.
Do not merge or rename products to make normalization unique.

Internal whitespace is business-significant, not merely an input-format defect.
The user confirmed that `TTS-01` and `TTS - 01`, and `DB-02L` and `DB-02 L`,
are genuinely different products. A shared normalizer is for comparison or
candidate lookup, never an equality test between distinct stored codes.

**Why:** Removing internal spaces can conflate different products and their
price histories even when there are currently no orphan competitor joins.

**How to apply:** Classification mappings use exact stored codes. Do not
re-point authoritative storage normalization or change what a loader stores
as part of consolidating lookup helpers.
