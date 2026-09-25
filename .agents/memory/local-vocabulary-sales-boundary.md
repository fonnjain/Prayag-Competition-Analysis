---
name: Local vocabulary Sales boundary
description: Policy for adding Competition divisions that Sales does not recognize.
---

Allow an administrator to add a new division, but make the Sales reporting consequence explicit before confirmation and retain a visible list of locally added divisions still unknown to Sales. Do not automatically add or map the value on the Sales side. Categories do not receive that warning because the supplied Sales mapping contract uses division names. Treat exact Sales division names as mapped; near-duplicate normalization is for rejecting vocabulary duplicates, not for asserting that Sales recognizes a spelling.

**Why:** The user requested a business choice between blocking creation and warning. Warning plus a persistent gap list allows catalogue preparation without silently implying a new division will flow into Sales reports; Sales mapping needs deliberate separate approval.

**How to apply:** When changing new-product classification or Sales integration, preserve this warning and unknown-to-Sales queue until a separately verified Sales-side mapping is approved. The fixed Sales map was supplied in the request; independently inspect current Sales data/source before asserting that a future mapping update has reached production.