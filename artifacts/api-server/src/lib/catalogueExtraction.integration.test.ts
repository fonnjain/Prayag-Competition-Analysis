/**
 * Sparsh Pearl Vol 6.2 — extraction regression test.
 *
 * This is a LIVE integration test: it sends real PDF pages to Claude and
 * compares extracted MRPs against a hand-verified fixture. It is skipped
 * automatically when either prerequisite is missing so normal `pnpm test`
 * is unaffected.
 *
 * Prerequisites:
 *   1. Place the PDF at:
 *        src/lib/fixtures/sparsh-pearl-vol62.pdf
 *      (git-ignored — do not commit the binary)
 *
 *   2. Populate the fixture at:
 *        src/lib/fixtures/sparsh-pearl-vol62-baseline.json
 *      with hand-verified { cat_no, variant, expected_mrp } entries.
 *      Run `pnpm tsx scripts/generate-extraction-fixture.ts` to produce a
 *      first-pass fixture from a live run, then verify each price manually.
 *
 *   3. Set ANTHROPIC_API_KEY in the environment.
 *
 * Run individually:
 *   ANTHROPIC_API_KEY=sk-... pnpm vitest run catalogueExtraction.integration
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFromPdf, EXTRACTION_MODEL } from "./pdfExtractor.js";
import SPARSH_PROFILE from "./catalogue-profiles/sparsh-pearl.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");
const PDF_PATH = path.join(FIXTURES, "sparsh-pearl-vol62.pdf");
const BASELINE_PATH = path.join(FIXTURES, "sparsh-pearl-vol62-baseline.json");

export interface BaselineEntry {
  /** Exact catalogue code as printed (uppercase). */
  cat_no: string;
  /** Variant qualifier, e.g. "45 Degree", "1 Mtr". Null if none. */
  variant: string | null;
  /** Hand-verified MRP in ₹ (integer, no ₹ symbol, no /-). */
  expected_mrp: number;
}

const hasPdf = fs.existsSync(PDF_PATH);
const hasKey = !!process.env.ANTHROPIC_API_KEY;
const hasBaseline =
  fs.existsSync(BASELINE_PATH) &&
  (JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as BaselineEntry[])
    .length > 0;

const skip = !hasPdf || !hasKey || !hasBaseline;
const skipReason = !hasPdf
  ? `PDF not found at ${PDF_PATH}`
  : !hasKey
    ? "ANTHROPIC_API_KEY not set"
    : "Baseline fixture is empty — run generate-extraction-fixture.ts first";

describe.skipIf(skip)(
  `Sparsh Pearl Vol 6.2 extraction regression (model: ${EXTRACTION_MODEL})`,
  () => {
    /**
     * Single long-running test: one full extraction run for the whole PDF.
     * Broken into soft assertions so we see ALL failures, not just the first.
     */
    it(
      "resolves every baseline entry with the expected MRP",
      async () => {
        const pdfBuffer = fs.readFileSync(PDF_PATH);
        const baseline = JSON.parse(
          fs.readFileSync(BASELINE_PATH, "utf8"),
        ) as BaselineEntry[];

        const targetCodes = [...new Set(baseline.map((e) => e.cat_no))];

        console.log(
          `[regression] Running extraction — ${baseline.length} baseline entries, ` +
            `${targetCodes.length} unique codes, model: ${EXTRACTION_MODEL}`,
        );

        const { items: extracted, failedChunks } = await extractFromPdf(
          pdfBuffer,
          targetCodes,
          SPARSH_PROFILE.codeFamilies,
          (p) => {
            console.log(
              `[regression] chunk ${p.chunk}/${p.totalChunks} ` +
                `(pp. ${p.startPage}–${p.endPage}) — ${p.totalItemsFound} items so far`,
            );
          },
        );

        console.log(`[regression] Extraction complete — ${extracted.length} items found`);
        if (failedChunks.length > 0) {
          console.warn(
            `[regression] WARNING: ${failedChunks.length} chunk(s) failed extraction: ` +
              failedChunks.map((fc) => `pp. ${fc.startPage}–${fc.endPage}`).join(", "),
          );
        }

        // Index extracted items for fast lookup: "CAT_NO|variant" → mrp
        const extractedIndex = new Map<string, number>();
        for (const item of extracted) {
          const key = `${item.cat_no}|${item.variant ?? ""}`;
          extractedIndex.set(key, item.mrp);
        }

        // Also build a variant-agnostic fallback index for codes with no variant
        const extractedByCode = new Map<string, number>();
        for (const item of extracted) {
          if (!extractedByCode.has(item.cat_no)) {
            extractedByCode.set(item.cat_no, item.mrp);
          }
        }

        const failures: string[] = [];

        for (const entry of baseline) {
          const key = `${entry.cat_no}|${entry.variant ?? ""}`;
          const mrp =
            extractedIndex.get(key) ??
            (entry.variant === null ? extractedByCode.get(entry.cat_no) : undefined);

          if (mrp === undefined) {
            failures.push(
              `NOT FOUND: ${entry.cat_no}${entry.variant ? ` (${entry.variant})` : ""} — expected MRP ${entry.expected_mrp}`,
            );
          } else if (mrp !== entry.expected_mrp) {
            failures.push(
              `WRONG MRP: ${entry.cat_no}${entry.variant ? ` (${entry.variant})` : ""} — got ${mrp}, expected ${entry.expected_mrp}`,
            );
          }
        }

        if (failures.length > 0) {
          console.error(`[regression] ${failures.length} failure(s):\n${failures.join("\n")}`);
        } else {
          console.log(`[regression] All ${baseline.length} entries matched ✓`);
        }

        expect(failures, `${failures.length} extraction failure(s):\n${failures.join("\n")}`).toEqual([]);
      },
      // PDF extraction takes ~90 s per 25-page chunk; allow 10 min for a
      // 108-page catalogue (5 chunks).
      600_000,
    );
  },
);
