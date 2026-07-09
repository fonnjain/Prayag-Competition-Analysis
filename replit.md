# Prayag Polymers — Pricing Intelligence Hub

A mobile-friendly internal multi-app hub for Prayag Polymers: a master product catalog with MRP history, and a live competition-analysis dashboard that answers, per product: is Prayag's price competitive vs rival brands?

## Apps

- `prayag-home` (`/`) — launcher page linking to the other apps
- `prayag-product-db` (`/product-db/`) — master catalog, MRP history, bulk MRP uploads, data health
- `prayag-analysis` (`/analysis/`) — live competitive pricing dashboard (coverage, positioning, opportunities)
- `api-server` (`/api`) — shared Express backend for all apps

(The legacy Competition Console app was fully removed on 2026-07-09 — its artifact, API routes, engine/seed code, and DB tables no longer exist.)

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run test` — API server test suite
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- API contract (source of truth): `lib/api-spec/openapi.yaml` → run codegen to regenerate hooks (`lib/api-hooks`) + zod schemas (`lib/api-zod`)
- DB schema (source of truth): `lib/db/src/schema/catalog.ts` (catalog_products, mrp_price_history, competitor_prices, code_conflicts, accept_batches, discount_settings)
- Analysis engine: `artifacts/api-server/src/lib/analysis.ts` (live-computed per request)
- Catalog seed: `artifacts/api-server/src/lib/catalogSeed.ts` from `artifacts/api-server/src/seed/catalog-seed.json` + `competitor-seed.json`
- API routes: `artifacts/api-server/src/routes/` (health, catalog, catalogImportExport, comparison, analysis)
- Frontends: `artifacts/prayag-home/`, `artifacts/prayag-product-db/`, `artifacts/prayag-analysis/`

## Architecture decisions

- Analysis basis: competitor prices are ex-GST; comparisons use ex-GST×1.18 vs Prayag MRP; comparability gate excludes null-price and unmatched rows; green = Prayag cheaper.
- MRP history is append-only with a unique-index backstop; current price flagged via `is_current`.
- diff% convention: positive = Prayag cheaper (good).
- Competitor import guardrail: auto-matched imports reject price gaps vs Prayag MRP outside roughly −80%..+100%; verified manual re-uploads bypass it.
- Analysis recomputes everything live per request over the existing tables (a few hundred rows — trivial), so edits and imports reflect instantly.
- competitor_prices.price is nullable (quote rows without a price); null-price rows count toward coverage but are non-comparable. Never store price=0.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
