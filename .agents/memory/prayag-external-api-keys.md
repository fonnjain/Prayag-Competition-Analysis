---
name: Prayag external API keys
description: How the X-API-Key external /api/v1 surface works and its security posture.
---

External read-only API lives at `/api/v1/*`, guarded by `X-API-Key`. Keys are random `pryg_` secrets shown once at creation; only SHA-256 hashes stored in `api_keys` (prefix kept for display). Revoke = soft (is_active=false, kept for audit); delete = hard.

**Rule:** `/v1` endpoints must stay an explicit GET-only allowlist that rewrites onto internal handlers — never mount whole internal routers under `/v1`, or the key would grant writes (catalog reset, imports).

**Why:** internal management endpoints (`/api/keys` CRUD and everything else) are unauthenticated by design — the whole hub has no login. An API key must therefore never widen access beyond read-only fetches. If the user ever adds login, put `/api/keys` behind it first.
