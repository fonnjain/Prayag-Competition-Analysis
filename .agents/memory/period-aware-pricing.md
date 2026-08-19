---
name: Period-aware pricing
description: Durable rules for resolving current prices, validity windows, and same-day revisions.
---

# Period-aware pricing

**Rule:** Treat effective dates—not denormalized current flags—as the authority for current Prayag and competitor prices. A current price is the latest eligible non-null priced revision on or before the requested date.

Validity is inclusive through the day before the earliest later non-null priced revision. No later revision means an open-ended window. Equal-price revisions remain visible with zero-percent change. When priced rows share an effective date, the highest-ID row wins and lower-ID rows do not form windows.

**Why:** Scheduled prices and corrected same-day imports make current flags stale or ambiguous. Null placeholders and superseded rows are audit records, not periods in which a price was quotable.

**How to apply:** Resolve current, validity end, and only the earliest next winning revision together. Use the resolved current rows for every headline gap; never mix a future price or stale snapshot into current-versus-current math.
