# Prayag Competition Console

A mobile-friendly internal pricing-intelligence app for Prayag Polymers that answers, per product: is Prayag's price competitive vs rival brands, and what should the price be?

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
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
- DB schema (source of truth): `lib/db/src/schema/prayag.ts`
- Pricing/competitiveness engine: `artifacts/api-server/src/lib/engine.ts`
- Seeding + reset: `artifacts/api-server/src/lib/seed.ts` from `artifacts/api-server/src/seed/seed-data.json` (the original master comparison; reset restores it)
- API routes: `artifacts/api-server/src/routes/` (dashboard, products, recommendations, competitors, settings, importExport)
- Frontend: `artifacts/prayag-console/` (Dashboard, Recommendations, Import, Competitors, Settings)

## Architecture decisions

- Net-vs-MRP basis correctness: each competitor compares on its own basis (net/mrp/mixed). A product's status is computed on net if any visible net rival exists (with prayagNet present), else mrp. Per-cell diff% always compares against the Prayag price of that cell's basis.
- diff% convention: positive = Prayag cheaper (good). Status: leader (≤market_min), competitive (≤median), above_market (≤max), overpriced (>max), no_data.
- Recommendations: suggested = market_median×0.98, aggressive = market_min×0.98, both floored at kgCost×(1+minMargin%); marginConstrained flags when the floor raises the suggestion. kgCost is null in seed data (no cost column), so floors are inactive until cost is entered.
- The engine recomputes everything in-memory per request (897 products / 2304 comparisons — trivial), so edits and imports reflect instantly with no denormalized cache.
- Import matches competitor sheets by Prayag item code (overlap detection picks the code column); brand + basis are auto-detected from headers/filename. Seed data has no product names, so name-based matching is not used.

## Product

- Dashboard: KPIs (competitive share, leader/competitive/above/overpriced counts), competitor win-rate chart, category breakdown, and an editable comparison matrix.
- Recommendations: target price suggestions with margin-floor checks, filterable, exportable.
- Import: upload competitor Excel/CSV/PDF sheets; auto-match by code and report matched/unmatched counts.
- Competitors: hide/show columns, delete a competitor, reset all data to the original seed.
- Settings: minimum margin %.
- Export: comparison matrix and recommendations as CSV/XLSX.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
