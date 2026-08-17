#!/usr/bin/env tsx
/**
 * Generate a first-pass extraction fixture from a live Claude run.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... pnpm tsx scripts/generate-extraction-fixture.ts \
 *     <path-to-pdf> <output-fixture.json>
 *
 * After running, open the output JSON alongside the physical catalogue and
 * verify every price. Correct any misreads before committing the fixture.
 *
 * The output format matches the BaselineEntry interface in
 * catalogueExtraction.integration.test.ts:
 *   { cat_no, variant, expected_mrp }[]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFromPdf } from "../src/lib/pdfExtractor.js";
import SPARSH_PROFILE from "../src/lib/catalogue-profiles/sparsh-pearl.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const [pdfArg, outArg] = process.argv.slice(2);

  if (!pdfArg || !outArg) {
    console.error(
      "Usage: tsx scripts/generate-extraction-fixture.ts <pdf-path> <output-json>",
    );
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }

  const pdfPath = path.resolve(__dirname, "..", pdfArg);
  const outPath = path.resolve(__dirname, "..", outArg);

  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  console.log(`Reading PDF: ${pdfPath}`);
  const pdfBuffer = fs.readFileSync(pdfPath);

  console.log(`Extracting with model: ${(await import("../src/lib/pdfExtractor.js")).EXTRACTION_MODEL}`);
  console.log("This may take several minutes for a 100-page catalogue...\n");

  const { items: extracted, failedChunks } = await extractFromPdf(
    pdfBuffer,
    [], // no target-code filter — extract everything in the code families
    SPARSH_PROFILE.codeFamilies,
    (p) => {
      process.stdout.write(
        `  chunk ${p.chunk}/${p.totalChunks} (pp. ${p.startPage}–${p.endPage}) — ${p.totalItemsFound} items\n`,
      );
    },
  );

  console.log(`\nExtraction complete — ${extracted.length} items found`);

  if (failedChunks.length > 0) {
    console.warn(
      `\n⚠️  WARNING: ${failedChunks.length} chunk(s) failed extraction and were skipped:`,
    );
    for (const fc of failedChunks) {
      console.warn(`   - Pages ${fc.startPage}–${fc.endPage}: ${fc.error}`);
    }
    console.warn(
      "   Re-run the script or re-upload the PDF to recover the missing pages.\n",
    );
  }

  // Deduplicate: if the same cat_no+variant appears on multiple pages, keep
  // the first occurrence (earlier pages are usually the main listing).
  const seen = new Set<string>();
  const deduplicated = extracted.filter((item) => {
    const key = `${item.cat_no}|${item.variant ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`After deduplication: ${deduplicated.length} unique items`);

  // Sort by cat_no then variant for easier manual review
  deduplicated.sort((a, b) => {
    const c = a.cat_no.localeCompare(b.cat_no);
    if (c !== 0) return c;
    return (a.variant ?? "").localeCompare(b.variant ?? "");
  });

  const fixture = deduplicated.map((item) => ({
    cat_no: item.cat_no,
    variant: item.variant,
    expected_mrp: item.mrp,
  }));

  fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`\nFixture written to: ${outPath}`);
  console.log(
    "\n⚠️  IMPORTANT: Verify every price against the physical catalogue before committing.",
  );
  console.log(
    "   Correct any misreads — this file becomes the regression ground truth.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
