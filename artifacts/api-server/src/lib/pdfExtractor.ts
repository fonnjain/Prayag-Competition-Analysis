/**
 * PDF catalogue extractor using Claude vision.
 *
 * Catalogue discovery is deliberately read twice, page by page. A code-set or
 * price disagreement receives one final adjudication read of that page. This
 * prevents a silent single-pass omission from appearing as a clean import.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import {
  type CatalogueProfile,
  extractPages,
  profilePages,
  seriesWithNoItems,
  widenedPages,
} from "./catalogueProfile.js";

export const EXTRACTION_MODEL = "claude-opus-5" as const;
/** Bump when extraction/reconciliation behaviour changes. */
// Keep the shared extractor provenance stable for every competitor except
// Apollo. Apollo's positional-size enrichment has its own version so changing
// it does not invalidate otherwise identical competitor uploads.
export const EXTRACTOR_VERSION = "pdf-code-discovery-v2" as const;
export const APOLLO_EXTRACTOR_VERSION = "pdf-code-discovery-v3" as const;
/** Bump when the model instructions change. */
export const PROMPT_REVISION = "catalogue-extraction-r2" as const;

const COVERAGE_THRESHOLD = 0.9;
const MAX_BYTES_PER_REQUEST = 28 * 1024 * 1024;
// Page reads are independent. A small pool keeps a multi-page catalogue usable
// without flooding the vision API or turning one upload into 34 serial waits.
const PAGE_READ_CONCURRENCY = 3;

export interface ExtractedItem {
  cat_no: string;
  variant: string | null;
  mrp: number;
  product_name: string;
  /** Original 1-based catalogue page number. */
  page: number;
  /** Independent reads that found this code; finalPass is stored separately. */
  discoveryPasses: number[];
  /** True when a third, page-only read selected the final value. */
  adjudicated: boolean;
}

export interface PdfBatchProvenance {
  fileSha256: string;
  fileSizeBytes: number;
  extractorVersion: string;
  catalogueProfileRevision: string | null;
  promptRevision: string;
  model: string;
  pagesRequested: string | null;
}

/** Creates auditable, versioned metadata before an uploaded PDF is read. */
export function buildPdfBatchProvenance(
  pdfBuffer: Buffer,
  profile?: CatalogueProfile,
): PdfBatchProvenance {
  return {
    fileSha256: createHash("sha256").update(pdfBuffer).digest("hex"),
    fileSizeBytes: pdfBuffer.length,
    extractorVersion: EXTRACTOR_VERSION,
    catalogueProfileRevision: profile?.revision ?? null,
    promptRevision: PROMPT_REVISION,
    model: EXTRACTION_MODEL,
    pagesRequested: profile ? JSON.stringify(profilePages(profile)) : null,
  };
}

export interface ExtractionProgress {
  chunk: number;
  totalChunks: number;
  startPage: number;
  endPage: number;
  pagesInChunk: number;
  itemsFound: number;
  totalItemsFound: number;
  pass: 1 | 2 | 3;
}

export interface FailedChunk {
  chunkIndex: number;
  startPage: number;
  endPage: number;
  error: string;
}

export interface ExtractionResult {
  items: ExtractedItem[];
  failedChunks: FailedChunk[];
  pagesSent: number;
  /** Immutable initial page list selected by the catalogue profile. */
  pagesRequested: number[];
  /** Additional page-only reads added by the mapped-target coverage fallback. */
  pagesSupplemental: number[];
  pagesWidened: boolean;
  coverage: number;
  passesRun: number;
  pagesAdjudicated: number[];
  codesFoundBothPasses: number;
  codesFoundOnePassOnly: number;
  itemsAdjudicated: number;
  modelCalls: number;
  elapsedMs: number;
}

interface PageRead {
  items: Omit<ExtractedItem, "discoveryPasses" | "adjudicated">[];
  failure?: FailedChunk;
  modelCalls: number;
}

interface ReconciledRead {
  items: ExtractedItem[];
  failedChunks: FailedChunk[];
  pagesAdjudicated: number[];
  codesFoundBothPasses: number;
  codesFoundOnePassOnly: number;
  itemsAdjudicated: number;
  modelCalls: number;
}

function mergeReconciledReads(
  primary: ReconciledRead,
  supplemental: ReconciledRead,
): ReconciledRead {
  return {
    items: [...primary.items, ...supplemental.items],
    failedChunks: [...primary.failedChunks, ...supplemental.failedChunks],
    pagesAdjudicated: [...primary.pagesAdjudicated, ...supplemental.pagesAdjudicated],
    codesFoundBothPasses:
      primary.codesFoundBothPasses + supplemental.codesFoundBothPasses,
    codesFoundOnePassOnly:
      primary.codesFoundOnePassOnly + supplemental.codesFoundOnePassOnly,
    itemsAdjudicated: primary.itemsAdjudicated + supplemental.itemsAdjudicated,
    modelCalls: primary.modelCalls + supplemental.modelCalls,
  };
}

function normCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function itemKey(item: { cat_no: string; variant: string | null }): string {
  return `${normCode(item.cat_no)}|${item.variant?.trim().toUpperCase() ?? ""}`;
}

function buildStaticPrompt(targetCodes: string[], codeFamilies: string[]): string {
  const targetList =
    targetCodes.length > 0
      ? `Target catalogue codes to find (these are the only known codes needing prices):\n${targetCodes.map((code) => `  - ${code}`).join("\n")}\n`
      : "";

  return `${targetList}Code families we care about: ${codeFamilies.join(", ")}

EXTRACTION RULES:
1. Grid pages: each tile has a Cat No. and "MRP : ₹ NNN/-".
2. Hero pages: read the small price block as well.
3. Table pages use "Cat No. | Sizes | MRP in ₹ | S.Box | M.Box".
4. A tile can have TWO codes, each with its OWN price. Extract both separately.
5. Capture the qualifier after the code as "variant".
6. Bind every MRP to its own tile or row; never borrow a neighbouring price.
7. Strip ₹ and /- from prices. Return only the numeric value.
8. Return only relevant code families. Do not invent codes from nearby artwork.
9. This request contains exactly ONE source page. Set "page" to 1.

Return ONLY a JSON array. No prose, no markdown fences. Schema:
[
  { "cat_no": "ED-950", "variant": null, "mrp": 467, "product_name": "Bib Cock with Flange", "page": 1 }
]

If no relevant items are found, return: []`;
}

function parseItems(
  text: string,
  originalPage: number,
): Omit<ExtractedItem, "discoveryPasses" | "adjudicated">[] {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned) as unknown[];
  if (!Array.isArray(parsed)) throw new Error("Extractor response must be a JSON array");

  return parsed
    .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null)
    .map((value) => ({
      cat_no: String(value.cat_no ?? "").trim().toUpperCase(),
      variant: value.variant ? String(value.variant).trim() || null : null,
      mrp: Number(value.mrp),
      product_name: String(value.product_name ?? "").trim(),
      page: originalPage,
    }))
    .filter((item) => item.cat_no && Number.isFinite(item.mrp) && item.mrp > 0);
}

function sameCodeAndPrices(
  first: Omit<ExtractedItem, "discoveryPasses" | "adjudicated">[],
  second: Omit<ExtractedItem, "discoveryPasses" | "adjudicated">[],
): boolean {
  const firstByKey = new Map(first.map((item) => [itemKey(item), item.mrp]));
  const secondByKey = new Map(second.map((item) => [itemKey(item), item.mrp]));
  if (firstByKey.size !== secondByKey.size) return false;
  for (const [key, price] of firstByKey) {
    if (secondByKey.get(key) !== price) return false;
  }
  return true;
}

function codeSet(items: Omit<ExtractedItem, "discoveryPasses" | "adjudicated">[]): Set<string> {
  return new Set(items.map((item) => normCode(item.cat_no)));
}

async function readPage(
  pdfBuffer: Buffer,
  originalPage: number,
  staticPrompt: string,
  client: Anthropic,
  chunkIndex: number,
): Promise<PageRead> {
  const { bytes } = await extractPages(pdfBuffer, [originalPage]);
  if (bytes.length > MAX_BYTES_PER_REQUEST) {
    return {
      items: [],
      modelCalls: 0,
      failure: {
        chunkIndex,
        startPage: originalPage,
        endPage: originalPage,
        error: "Single PDF page exceeds the extractor request-size limit",
      },
    };
  }

  let modelCalls = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      modelCalls += 1;
      const response = await client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 16384,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: staticPrompt,
              cache_control: { type: "ephemeral" },
            } as Anthropic.TextBlockParam,
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: bytes.toString("base64"),
              },
            } as Anthropic.DocumentBlockParam,
          ],
        }],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text" || !textBlock.text.trim()) {
        return { items: [], modelCalls };
      }
      return { items: parseItems(textBlock.text, originalPage), modelCalls };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  return {
    items: [],
    modelCalls,
    failure: {
      chunkIndex,
      startPage: originalPage,
      endPage: originalPage,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    },
  };
}

async function readPass(
  pdfBuffer: Buffer,
  pages: number[],
  pass: 1 | 2 | 3,
  staticPrompt: string,
  client: Anthropic,
  onProgress: ((progress: ExtractionProgress) => void) | undefined,
  progressOffset: number,
  totalReads: number,
): Promise<{
  byPage: Map<number, Omit<ExtractedItem, "discoveryPasses" | "adjudicated">[]>;
  failedChunks: FailedChunk[];
  modelCalls: number;
}> {
  const byPage = new Map<number, Omit<ExtractedItem, "discoveryPasses" | "adjudicated">[]>();
  const failedChunks: FailedChunk[] = [];
  let modelCalls = 0;
  let totalItemsFound = 0;

  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < pages.length) {
      const index = nextIndex++;
      const page = pages[index]!;
      const read = await readPage(pdfBuffer, page, staticPrompt, client, progressOffset + index + 1);
      byPage.set(page, read.items);
      modelCalls += read.modelCalls;
      totalItemsFound += read.items.length;
      if (read.failure) failedChunks.push(read.failure);
      onProgress?.({
        chunk: progressOffset + index + 1,
        totalChunks: totalReads,
        startPage: page,
        endPage: page,
        pagesInChunk: 1,
        itemsFound: read.items.length,
        totalItemsFound,
        pass,
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PAGE_READ_CONCURRENCY, pages.length) }, worker),
  );

  return { byPage, failedChunks, modelCalls };
}

async function reconcilePages(
  pdfBuffer: Buffer,
  pages: number[],
  staticPrompt: string,
  client: Anthropic,
  onProgress?: (progress: ExtractionProgress) => void,
): Promise<ReconciledRead> {
  const firstPass = await readPass(pdfBuffer, pages, 1, staticPrompt, client, onProgress, 0, pages.length * 2);
  const secondPass = await readPass(pdfBuffer, pages, 2, staticPrompt, client, onProgress, pages.length, pages.length * 2);
  const failedChunks = [...firstPass.failedChunks, ...secondPass.failedChunks];
  let modelCalls = firstPass.modelCalls + secondPass.modelCalls;
  const items: ExtractedItem[] = [];
  const pagesAdjudicated: number[] = [];
  let codesFoundBothPasses = 0;
  let codesFoundOnePassOnly = 0;
  let itemsAdjudicated = 0;

  for (const page of pages) {
    const first = firstPass.byPage.get(page) ?? [];
    const second = secondPass.byPage.get(page) ?? [];
    const firstCodes = codeSet(first);
    const secondCodes = codeSet(second);
    for (const code of new Set([...firstCodes, ...secondCodes])) {
      if (firstCodes.has(code) && secondCodes.has(code)) codesFoundBothPasses += 1;
      else codesFoundOnePassOnly += 1;
    }

    if (sameCodeAndPrices(first, second)) {
      items.push(...first.map((item) => ({ ...item, discoveryPasses: [1, 2], adjudicated: false })));
      continue;
    }

    pagesAdjudicated.push(page);
    const adjudication = await readPass(
      pdfBuffer,
      [page],
      3,
      staticPrompt,
      client,
      onProgress,
      pages.length * 2 + pagesAdjudicated.length - 1,
      pages.length * 2 + pagesAdjudicated.length,
    );
    failedChunks.push(...adjudication.failedChunks);
    modelCalls += adjudication.modelCalls;
    for (const item of adjudication.byPage.get(page) ?? []) {
      const code = normCode(item.cat_no);
      const discoveryPasses = [
        ...(firstCodes.has(code) ? [1] : []),
        ...(secondCodes.has(code) ? [2] : []),
        3,
      ];
      items.push({ ...item, discoveryPasses, adjudicated: true });
      itemsAdjudicated += 1;
    }
  }

  return {
    items,
    failedChunks,
    pagesAdjudicated,
    codesFoundBothPasses,
    codesFoundOnePassOnly,
    itemsAdjudicated,
    modelCalls,
  };
}

function coverageFor(items: ExtractedItem[], targetCodes: string[]): number {
  if (targetCodes.length === 0) return 1;
  const found = new Set(items.map((item) => normCode(item.cat_no)));
  return targetCodes.filter((code) => found.has(normCode(code))).length / targetCodes.length;
}

/**
 * Extract priced catalogue items using two independent discovery reads per page.
 * A third read is limited to pages where the first two disagree on codes or MRP.
 */
export async function extractFromPdf(
  pdfBuffer: Buffer,
  targetCodes: string[],
  codeFamilies: string[],
  onProgress?: (progress: ExtractionProgress) => void,
  profile?: CatalogueProfile,
  options: { pages?: number[] } = {},
): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const startedAt = Date.now();
  const client = new Anthropic({ apiKey });
  const staticPrompt = buildStaticPrompt(targetCodes, codeFamilies);

  let initialPagesRequested: number[];
  if (options.pages) {
    initialPagesRequested = [...new Set(options.pages)]
      .filter((page) => Number.isInteger(page) && page > 0)
      .sort((a, b) => a - b);
  } else if (profile) {
    initialPagesRequested = profilePages(profile);
  } else {
    const { PDFDocument } = await import("pdf-lib");
    const document = await PDFDocument.load(pdfBuffer);
    initialPagesRequested = Array.from(
      { length: document.getPageCount() },
      (_, index) => index + 1,
    );
  }

  let reconciled = await reconcilePages(
    pdfBuffer,
    initialPagesRequested,
    staticPrompt,
    client,
    onProgress,
  );
  let coverage = coverageFor(reconciled.items, targetCodes);
  let pagesWidened = false;
  let pagesSupplemental: number[] = [];
  let pagesSent = initialPagesRequested.length;

  // Keep the established mapped-target coverage fallback. It now receives the
  // same two-pass reconciliation, but only for pages outside the original
  // profile. An agreed original page is never reread just because a different
  // section needs widened coverage.
  if (!options.pages && profile && targetCodes.length > 0 && coverage < COVERAGE_THRESHOLD) {
    pagesSupplemental = widenedPages(initialPagesRequested, 2, profile.pageCount)
      .filter((page) => !initialPagesRequested.includes(page));
    if (pagesSupplemental.length > 0) {
      const supplemental = await reconcilePages(
        pdfBuffer,
        pagesSupplemental,
        staticPrompt,
        client,
        onProgress,
      );
      reconciled = mergeReconciledReads(reconciled, supplemental);
      pagesSent += pagesSupplemental.length;
      coverage = coverageFor(reconciled.items, targetCodes);
      pagesWidened = true;
    }
    if (coverage < COVERAGE_THRESHOLD) {
      const foundPrefixes = new Set(
        reconciled.items
          .map((item) => {
            const dash = item.cat_no.indexOf("-");
            return dash > 0 ? item.cat_no.slice(0, dash + 1) : "";
          })
          .filter(Boolean),
      );
      // Preserve the diagnostic calculation for callers/logs without widening
      // endlessly or accepting a guessed page map.
      seriesWithNoItems(profile, foundPrefixes);
    }
  }

  return {
    items: reconciled.items,
    failedChunks: reconciled.failedChunks,
    pagesSent,
    pagesRequested: initialPagesRequested,
    pagesSupplemental,
    pagesWidened,
    coverage,
    passesRun: 2,
    pagesAdjudicated: reconciled.pagesAdjudicated,
    codesFoundBothPasses: reconciled.codesFoundBothPasses,
    codesFoundOnePassOnly: reconciled.codesFoundOnePassOnly,
    itemsAdjudicated: reconciled.itemsAdjudicated,
    modelCalls: reconciled.modelCalls,
    elapsedMs: Date.now() - startedAt,
  };
}