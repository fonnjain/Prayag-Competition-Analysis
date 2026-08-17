# Test fixtures

## sparsh-pearl-vol62.pdf

The binary catalogue PDF (git-ignored). Place it here before running the
extraction regression test.

Path expected by the test:
```
artifacts/api-server/src/lib/fixtures/sparsh-pearl-vol62.pdf
```

## sparsh-pearl-vol62-baseline.json

Hand-verified ground truth for the extraction regression test. Each entry:

```jsonc
[
  // cat_no  — exact catalogue code (uppercase)
  // variant — small qualifier printed after the code ("45 Degree", "1 Mtr", …)
  //           null if the tile has no variant text
  // expected_mrp — integer MRP in ₹, no ₹ symbol, no /-
  { "cat_no": "ED-950", "variant": null, "expected_mrp": 467 },
  { "cat_no": "ED-951", "variant": "45 Degree", "expected_mrp": 555 }
]
```

**How to populate:**

1. Place the PDF at the path above and set `ANTHROPIC_API_KEY`.
2. Run the generator to produce a first-pass baseline from a live extraction:
   ```
   pnpm --filter @workspace/api-server tsx scripts/generate-extraction-fixture.ts \
     src/lib/fixtures/sparsh-pearl-vol62.pdf \
     src/lib/fixtures/sparsh-pearl-vol62-baseline.json
   ```
3. Open the generated JSON alongside the physical catalogue and verify every
   price. Correct any misreads. This file is the regression ground truth.
4. Commit `sparsh-pearl-vol62-baseline.json` (not the PDF).

**Running the test:**

```
ANTHROPIC_API_KEY=sk-... pnpm --filter @workspace/api-server vitest run catalogueExtraction.integration
```
