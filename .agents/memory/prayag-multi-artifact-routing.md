---
name: Prayag multi-artifact routing & cross-app links
description: How the Prayag web apps are split across proxy subpaths and how to link between them.
---

Prayag is a multi-app hub, intentionally NOT merged. Web artifacts behind the shared proxy:
- `prayag-home` (launcher) at `/`
- `prayag-product-db` (Product Database) at `/product-db/`
- `prayag-analysis` (Competition Analysis) at `/analysis/`
All share one `api-server` at `/api`.
(The legacy Competition Console at `/console/` no longer exists — do not reintroduce console links or assume its routes/tables are present.)

**Cross-app navigation rule:** links from one artifact to another MUST be plain `<a href="/product-db/">` / `<a href="/analysis/">` with EXACT absolute proxy paths — full-page navigation. Do NOT use `import.meta.env.BASE_URL` (that's per-app and would resolve wrong) and do NOT use the wouter router (client-side routing can't cross artifacts).

**Why:** each app is a separate Vite build with its own `BASE_PATH`/wouter base; the global proxy routes by path prefix. Router/BASE_URL links stay inside the current artifact and silently break cross-app jumps.

**How to apply:** intra-app links use wouter + BASE_URL as normal; inter-app links use raw absolute `<a href>`. Moving an app's subpath = edit its `artifact.toml` (previewPath, services.paths, BASE_PATH) via verifyAndReplaceArtifactToml + restart its workflow; no code change needed because vite base reads BASE_PATH and wouter base reads BASE_URL.
