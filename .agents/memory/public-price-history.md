---
name: Public Price Finder history boundary
description: Access and reuse rules for full MRP history on the otherwise-public Price Finder.
---

The Price Finder remains anonymous for current and upcoming prices, but full MRP history is visible only to signed-in users. The history UI must consume the protected Analysis price-history contract rather than introducing another history query.

**Why:** Full historical pricing is commercially sensitive, while the public current-price lookup is intentional. Reusing the Analysis contract also prevents history ordering, approval, variant, and provenance rules from diverging.

**How to apply:** Keep anonymous product and comparison routes read-only and public. Put any full-history UI behind authenticated state and fetch it from the protected Analysis endpoint. Preserve the shared next-gap resolver for future comparisons so both sides resolve at one date.