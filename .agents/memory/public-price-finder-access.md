---
name: Public Price Finder access
description: Access-policy boundary for the anonymous Price Finder app and its read-only data routes.
---

Price Finder is the deliberate public exception in the Prayag workspace: visitors may browse and search its read-only catalogue and price information without signing in. Home, Product Database, Competition Analysis, import tools, administration, and all mutation-capable routes remain session-protected.

**Why:** The user wants counter-side price lookup available without a login or password, without exposing catalog management or competitive-analysis workspaces.

**How to apply:** Keep the public surface restricted to Price Finder's read-only lookup endpoints and UI. Any new mutation, administrative action, or sensitive data endpoint must stay behind session authentication (or use a separately designed public authorization policy). Retain the browser auth provider for optional signed-in context, but do not reintroduce an anonymous-user gate for Price Finder.

The Price Calculator is also fully public, including manual discounts, summary,
share links and Excel export. Stored discount defaults are private: all signed-in
roles may read them, but anonymous visitors must not call that endpoint and it
must return 401 to an anonymous caller. Anonymous discount fields start at zero.

**Why:** The user explicitly approved a public counter/field calculator while
identifying the saved trade-discount table as confidential margin structure.

**How to apply:** Use optional authentication only to prefill signed-in defaults.
Never seed or update saved settings from calculator requests, and never gate
calculator functionality behind sign-in.