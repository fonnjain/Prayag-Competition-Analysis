---
name: Logout revocation boundary
description: Success and failure semantics for the workspace's custom cookie/bearer sessions
---

Logout succeeds only after server-side revocation is confirmed. Retain the session identity until sending the revoke request; support bearer-only clients as well as cookies. On an unconfirmed revoke, show an explicit retry error rather than claiming successful logout or redirecting.

**Why:** Removing local credentials previously hid the logged-in UI without invalidating the server-backed bearer. This is a security boundary, not just navigation or browser-storage cleanup.

**How to apply:** Keep this contract consistent across the workspace apps sharing custom session authentication. Regression evidence must replay the old bearer after actual UI logout with cookies absent. Production rollout needs its own approval; development verification is not production remediation.