---
name: Public Price Finder access
description: Access-policy boundary for the anonymous Price Finder app and its read-only data routes.
---

Price Finder is the deliberate public exception in the Prayag workspace: visitors may browse and search its read-only catalogue and price information without signing in. Home, Product Database, Competition Analysis, import tools, administration, and all mutation-capable routes remain session-protected.

**Why:** The user wants counter-side price lookup available without a login or password, without exposing catalog management or competitive-analysis workspaces.

**How to apply:** Keep the public surface restricted to Price Finder's read-only lookup endpoints and UI. Any new mutation, administrative action, or sensitive data endpoint must stay behind session authentication (or use a separately designed public authorization policy). Retain the browser auth provider for optional signed-in context, but do not reintroduce an anonymous-user gate for Price Finder.