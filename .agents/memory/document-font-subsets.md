---
name: Document font subsets
description: Unicode currency support must be verified in the actual embedded font subsets.
---

A font family name is not proof that its packaged subset contains the rupee
symbol or every character in product descriptions. Verify glyph coverage and
render the generated document, not just its page count.

**Why:** The Noto Sans Latin web-font subset lacks ₹ while extended Latin contains
it; extended Latin alone in turn lacks common punctuation. Either subset used
alone can silently lose otherwise ordinary export text.

**How to apply:** Use embedded fonts with deliberate fallback across subsets,
retain extractable Unicode text, and fail explicitly for unsupported characters.
Do not substitute a blank glyph or strip source text to make a PDF succeed.
