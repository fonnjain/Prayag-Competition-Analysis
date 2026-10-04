# P053 Step 2 — Header placement evidence

Development verification: 4 October 2026, Asia/Kolkata.

The bucket control is in the page header, on the same row as the page title,
right-aligned on every A–K screen. Actions, filters, summaries and metrics are
below that row.

## Named screenshots

Every PNG is a genuine authenticated development screenshot at 1366×768,
without scrolling. Each has one bucket control in its title/header row:

- A — Product Catalogue
- B — Product Details (loaded existing product 101)
- C — Market Comparison
- D — Mapping Review
- E — Price Finder
- F — Price Finder Product Comparison (loaded existing product 101)
- G — Competition Analysis
- H — MRP Generator Scenarios
- I — Matching MRP Workbench (no-scope state)
- J — Run Details (loaded existing run 1050)
- K — Compare Scenarios

Exact routes, titles, element bounds, timestamps and filenames are recorded in
`local-screenshot-manifest.json`. The browser verification also checked the
empty Product Comparison view, Prince-exposure view and unsaved Scenario Dialog.
Its earlier loading-state screenshots are supplementary; the eleven packaged
PNGs are the final captured views.

Development has no bucket lists, so these screenshots correctly show
**Bucket: None**. No list or run was created for verification. The verifier's
original None preference was preserved and its genuine session was revoked.

## Scope and protected data

Changes are presentation-only: shared header placement and page markup.
Bucket filtering, membership, handlers, export writers and protected database
logic were not changed.

Before/after read-only snapshots match for all recorded protected counts and
checksums:

| Environment | MRP history rows | Catalogue rows |
| --- | ---: | ---: |
| Development | 14,012 | 6,948 |
| Production | 14,302 | 7,191 |

Development MRP value SHA-256:
`4d3e971cc8d88750583741d995c51013a3c690c6a1537127cbee62f21d3401f2`

Production MRP value SHA-256:
`e4a7f5f570e8ae6ac4eb96cd472e88e4f579572b04a63e6c8ec3cb2c238ec458`

Catalogue full-row and classification checksums also match; see the two
protected-data JSON files for exact values and canonical SQL.

Shared-library and all three app type checks passed. All three affected app
production builds passed. The changed workflows are running.

## Production status

This is development evidence, not confirmation of the new production layout.
The user publishes the change; production A–K confirmation follows publication.
The existing production HO list, its name, type and 184 active products were
not renamed, reseeded or modified.