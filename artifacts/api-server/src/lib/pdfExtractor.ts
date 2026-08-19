/**
 * PDF catalogue extractor using Claude vision.
 *
 * The Sparsh Pearl catalogue is image-only (no text layer), so pdf-parse /
 * pdfjs text extraction return nothing usable. Instead we:
 *   1. Build a sub-PDF of the pages named in the catalogue profile (e.g.
 *      17 of 108 pages for Sparsh Pearl — ~2 MB instead of ~12 MB).
 *   2. Send that sub-PDF to Claude (usually fits in one request).
 *   3. Parse the strict-JSON response.
 *   4. Compute coverage; if < 95 %, widen the page range by ±2 and retry once.
 *
 * DO NOT use OCR (tesseract) or pdfjs text extraction for this catalogue.
 * The ₹ glyph is misread and adjacent tile codes are picked up as prices.
 *
 * DO NOT revert to sending the full 108-page PDF. The profile-page approach
 * is intentional — sending all pages is slower, more expensive, and risks
 * hitting token limits.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  type CatalogueProfile,
  profilePages,
  widenedPages,
  extractPages,
  seriesWithNoItems,
} from "./catalogueProfile.js";

/** The Claude model used for PDF catalogue extraction. */
export const EXTRACTION_MODEL = "claude-opus-5" as const;

// Maximum pages per API request. Sparsh Pearl's 17 profile pages contain
// enough densely-tabulated SKUs to exceed the model's JSON output cap when
// sent together. Smaller chunks keep each strict-JSON response complete.
const MAX_PAGES_PER_REQUEST = 6;
// Coverage below this fraction triggers a widened-page retry.
// 0.90 allows for ~10% of mapped codes that may be genuinely absent
// (discontinued SKUs, slight naming differences) without causing an
// expensive extra Claude call.  Adjust upward only if profiles are
// comprehensive and you expect near-perfect match rates.
const COVERAGE_THRESHOLD = 0.90;

// Warn when the sub-PDF exceeds this; it approaches the API's 32 MB limit.
const MAX_BYTES_PER_REQUEST = 28 * 1024 * 1024;

// (COVERAGE_THRESHOLD is defined earlier with the tuning comment.)

export interface ExtractedItem {
  cat_no: string;
  variant: string | null;
  mrp: number;
  product_name: string;
  /** Original 1-based catalogue page number (translated from sub-PDF position). */
  page: number;
}

export interface ExtractionProgress {
  chunk: number;
  totalChunks: number;
  startPage: number;
  endPage: number;
  pagesInChunk: number;
  itemsFound: number;
  totalItemsFound: number;
}

export interface FailedChunk {
  chunkIndex: number; // 1-based
  startPage: number;
  endPage: number;
  error: string;
}

export interface ExtractionResult {
  items: ExtractedItem[];
  failedChunks: FailedChunk[];
  /** Number of pages actually sent to Claude (profile subset or full PDF). */
  pagesSent: number;
  /** True if the initial coverage was < threshold and a widened retry ran. */
  pagesWidened: boolean;
  /**
   * Fraction of target codes resolved to a price (0.0–1.0).
   * 1.0 when targetCodes is empty (nothing to look for = perfect coverage).
   */
  coverage: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Normalise a competitor code for comparison: uppercase, strip whitespace. */
function normCode(c: string): string {
  return c.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Split a PDF buffer into chunks of at most MAX_PAGES_PER_REQUEST pages.
 * Returns array of { buffer, startPage (1-based in *this* buffer), endPage }.
 */
async function splitPdf(
  pdfBuffer: Buffer,
): Promise<Array<{ buffer: Buffer; startPage: number; endPage: number }>> {
  // Lazy import to avoid top-level require issues in ESM build
  const { PDFDocument } = await import("pdf-lib");
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const total = srcDoc.getPageCount();
  const chunks: Array<{ buffer: Buffer; startPage: number; endPage: number }> = [];

  for (let start = 0; start < total; start += MAX_PAGES_PER_REQUEST) {
    const end = Math.min(start + MAX_PAGES_PER_REQUEST, total);
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(
      srcDoc,
      Array.from({ length: end - start }, (_, i) => start + i),
    );
    for (const page of pages) newDoc.addPage(page);
    const bytes = await newDoc.save();
    chunks.push({
      buffer: Buffer.from(bytes),
      startPage: start + 1,
      endPage: end,
    });
  }

  return chunks;
}

/**
 * Build the STATIC portion of the extraction prompt — identical across every
 * chunk for the same import job. cache_control: ephemeral makes Claude cache
 * this prefix across calls so subsequent chunks pay only the cache-read rate.
 */
function buildStaticPrompt(
  targetCodes: string[],
  codeFamilies: string[],
  isSubPdf: boolean,
): string {
  const targetList =
    targetCodes.length > 0
      ? `Target catalogue codes to find (these are the only ones we need priced):\n${targetCodes.map((c) => `  - ${c}`).join("\n")}\n`
      : "";

  const pageInstruction = isSubPdf
    ? `For the "page" field: report the 1-based page INDEX within the PDF you are reading (1 = first page of this file, 2 = second page, etc.). Do NOT use any printed page number visible on the page — use only the position within this file.`
    : `For the "page" field: report the catalogue page number printed on or near the page.`;

  return `${targetList}Code families we care about: ${codeFamilies.join(", ")}

EXTRACTION RULES:
1. Grid pages: 4-column grid of product tiles. Each tile has a Cat No. and "MRP : ₹ NNN/-".
2. Hero pages: one large product with a small price block. Read them too.
3. Table pages (pp. 83, 84, 96, 97): column format "Cat No. | Sizes | MRP in ₹ | S.Box | M.Box".
4. Two-code tiles: a tile sometimes has TWO codes, each with its OWN price. Extract both separately. NEVER copy one code's price to the other.
5. Variant qualifier: capture small text immediately after the code (e.g. "(45 Degree)", "(15mm)", "(1 Mtr)"). This is the "variant" field.
6. Price binding: the MRP belongs to the tile/row it is printed in. NEVER pick up a code from an adjacent tile as this tile's price.
7. Strip ₹ and /- from prices. Return only the numeric value.
8. If a page has no prices (marketing/intro page), return nothing for it.
9. ONLY return codes from the target list above (or the code families listed). Ignore accessories, bathroom fittings, and codes not in our families.

${pageInstruction}

Return ONLY a JSON array. No prose, no markdown fences, no explanation. Schema:
[
  { "cat_no": "ED-950", "variant": null, "mrp": 467, "product_name": "Bib Cock with Flange", "page": 3 },
  { "cat_no": "ED-951", "variant": "45 Degree", "mrp": 555, "product_name": "Long Body Bib Cock with Flange", "page": 3 },
  { "cat_no": "ED-969", "variant": "90 Degree", "mrp": 561, "product_name": "Long Body Bib Cock with Flange", "page": 3 }
]

If no relevant items are found on these pages, return: []`;
}

/** Per-chunk dynamic header. */
function buildDynamicHeader(startPage: number, isSubPdf: boolean): string {
  if (isSubPdf) {
    return `You are reading page ${startPage}+ of a FILTERED sub-PDF containing only the relevant product pages from the Sparsh Pearl PTMT catalogue. This is an IMAGE-ONLY PDF — there is no text layer. Extract prices visually using the rules above. Remember: use the 1-based page position within THIS PDF for the "page" field, not any printed number on the page.`;
  }
  return `You are reading pages ${startPage}+ of the Sparsh Pearl PTMT catalogue. This is an IMAGE-ONLY PDF — there is no text layer. Extract prices visually using the rules above.`;
}

// ---------------------------------------------------------------------------
// Core chunk runner
// ---------------------------------------------------------------------------

interface RunChunksOptions {
  buf: Buffer;
  /** pageMap[i] = original 1-based catalogue page for sub-PDF page (i+1). Null = full PDF (no translation). */
  pageMap: number[] | null;
  targetCodes: string[];
  codeFamilies: string[];
  client: Anthropic;
  isSubPdf: boolean;
  onProgress?: (p: ExtractionProgress) => void;
  /** Used to offset progress chunk numbering when this is a retry pass. */
  chunkIndexOffset?: number;
  totalChunksOverride?: number;
}

async function runChunks(opts: RunChunksOptions): Promise<{
  items: ExtractedItem[];
  failedChunks: FailedChunk[];
}> {
  const {
    buf,
    pageMap,
    targetCodes,
    codeFamilies,
    client,
    isSubPdf,
    onProgress,
    chunkIndexOffset = 0,
    totalChunksOverride,
  } = opts;

  const chunks = await splitPdf(buf);
  const totalChunks = totalChunksOverride ?? chunks.length;
  const allItems: ExtractedItem[] = [];
  const failedChunks: FailedChunk[] = [];

  const staticPrompt = buildStaticPrompt(targetCodes, codeFamilies, isSubPdf);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const dynamicHeader = buildDynamicHeader(chunk.startPage, isSubPdf);
    const base64 = chunk.buffer.toString("base64");

    if (chunk.buffer.length > MAX_BYTES_PER_REQUEST) {
      console.warn(
        `[pdfExtractor] chunk ${i + 1} is ${(chunk.buffer.length / 1024 / 1024).toFixed(1)} MB — approaching API limit`,
      );
    }

    let items: ExtractedItem[] = [];
    let lastErr: unknown;

    // Retry once on transient failures
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.messages.create({
          model: EXTRACTION_MODEL,
          max_tokens: 16384,
          messages: [
            {
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
                    data: base64,
                  },
                } as Anthropic.DocumentBlockParam,
                { type: "text", text: dynamicHeader },
              ],
            },
          ],
        });

        // Diagnostic log — helps trace model behaviour in production.
        console.info(
          `[pdfExtractor] chunk ${i + 1 + chunkIndexOffset} response: stop_reason=${response.stop_reason}, ` +
          `content_blocks=${response.content.length}, ` +
          `types=${response.content.map((b) => b.type).join(",")}`,
        );

        if (response.stop_reason === "max_tokens") {
          console.warn(
            `[pdfExtractor] chunk ${i + 1 + chunkIndexOffset}: stop_reason=max_tokens — ` +
            `response truncated at ${16384} tokens; raise max_tokens if this persists.`,
          );
        }

        // Find text block — order of content blocks is not guaranteed.
        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          console.warn(
            `[pdfExtractor] chunk ${i + 1 + chunkIndexOffset}: no text block in response. ` +
            `content=${JSON.stringify(response.content).slice(0, 400)}`,
          );
          // No text block = model returned nothing usable. Treat as 0 items, not a failure.
          items = [];
          lastErr = undefined;
          break;
        }

        const text = textBlock.text.trim();
        if (!text) {
          console.warn(`[pdfExtractor] chunk ${i + 1 + chunkIndexOffset}: empty text block.`);
          items = [];
          lastErr = undefined;
          break;
        }

        // Strip markdown fences if Claude added them despite instructions.
        const cleaned = text
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();

        if (!cleaned.startsWith("[") && !cleaned.startsWith("{")) {
          console.warn(
            `[pdfExtractor] chunk ${i + 1 + chunkIndexOffset}: response not JSON. ` +
            `First 200 chars: ${cleaned.slice(0, 200)}`,
          );
        }

        const parsed = JSON.parse(cleaned) as unknown[];
        const rawItems = parsed
          .filter(
            (x): x is Record<string, unknown> =>
              typeof x === "object" && x !== null,
          )
          .map((x) => {
            const reportedPage =
              typeof x.page === "number" ? x.page : chunk.startPage;

            // Translate sub-PDF page position → original catalogue page.
            // reportedPage is 1-based within the chunk's mini-PDF.
            // chunk.startPage is 1-based within the sub-PDF.
            // combined: 0-based index into pageMap.
            let originalPage = reportedPage;
            if (pageMap) {
              const subPdfIdx = chunk.startPage - 1 + reportedPage - 1;
              originalPage = pageMap[subPdfIdx] ?? reportedPage;
            }

            return {
              cat_no: String(x.cat_no ?? "").trim().toUpperCase(),
              variant: x.variant ? String(x.variant).trim() || null : null,
              mrp: Number(x.mrp),
              product_name: String(x.product_name ?? "").trim(),
              page: originalPage,
            };
          })
          .filter((x) => x.cat_no && !isNaN(x.mrp) && x.mrp > 0);

        items = rawItems;
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    if (lastErr !== undefined) {
      const errMsg =
        lastErr instanceof Error ? lastErr.message : String(lastErr);
      console.error(
        `[pdfExtractor] chunk ${i + 1 + chunkIndexOffset} (sub-PDF pages ${chunk.startPage}–${chunk.endPage}) failed after retry:`,
        lastErr,
      );
      failedChunks.push({
        chunkIndex: i + 1 + chunkIndexOffset,
        startPage: chunk.startPage,
        endPage: chunk.endPage,
        error: errMsg,
      });
    }

    allItems.push(...items);

    onProgress?.({
      chunk: i + 1 + chunkIndexOffset,
      totalChunks,
      startPage: chunk.startPage,
      endPage: chunk.endPage,
      pagesInChunk: chunk.endPage - chunk.startPage + 1,
      itemsFound: items.length,
      totalItemsFound: allItems.length,
    });
  }

  return { items: allItems, failedChunks };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract priced items from a PDF buffer using Claude vision.
 *
 * When `profile` is provided (recommended), builds a sub-PDF containing only
 * the pages listed in the profile before calling the API. This reduces the
 * payload from ~12 MB to ~2 MB and typically completes in one request.
 *
 * Falls back to chunking the full PDF when no profile is provided.
 */
export async function extractFromPdf(
  pdfBuffer: Buffer,
  targetCodes: string[],
  codeFamilies: string[],
  onProgress?: (p: ExtractionProgress) => void,
  profile?: CatalogueProfile,
): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  // ── Phase 1: Determine the buffer and page map to use ──────────────────────
  let sendBuffer: Buffer = pdfBuffer;
  let pageMap: number[] | null = null;
  let pagesSent = 0;
  const isSubPdf = !!profile;

  if (profile) {
    const pages = profilePages(profile);
    const { bytes, pageMap: map } = await extractPages(pdfBuffer, pages);
    sendBuffer = bytes;
    pageMap = map;
    pagesSent = pages.length;
    console.info(
      `[pdfExtractor] profile sub-PDF: ${pages.length}/${profile.pageCount} pages, ` +
      `${(bytes.length / 1024 / 1024).toFixed(1)} MB (full PDF was ${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB)`,
    );
  } else {
    // No profile — fall back to full PDF. Count pages without splitting.
    const { PDFDocument } = await import("pdf-lib");
    const srcDoc = await PDFDocument.load(pdfBuffer);
    pagesSent = srcDoc.getPageCount();
  }

  // ── Phase 2: Initial extraction ────────────────────────────────────────────
  const { items: initialItems, failedChunks } = await runChunks({
    buf: sendBuffer,
    pageMap,
    targetCodes,
    codeFamilies,
    client,
    isSubPdf,
    onProgress,
  });

  // ── Phase 3: Coverage check + optional widened retry ──────────────────────
  let coverage = 1.0;
  let pagesWidened = false;

  if (profile && targetCodes.length > 0) {
    const foundCodes = new Set(initialItems.map((i) => normCode(i.cat_no)));
    const resolved = targetCodes.filter((c) => foundCodes.has(normCode(c))).length;
    coverage = resolved / targetCodes.length;

    if (coverage < COVERAGE_THRESHOLD) {
      const basePages = profilePages(profile);
      const wide = widenedPages(basePages, 2, profile.pageCount);
      console.warn(
        `[pdfExtractor] coverage ${(coverage * 100).toFixed(0)}% < ${COVERAGE_THRESHOLD * 100}% — ` +
        `widening page range: ${basePages.length} → ${wide.length} pages (±2)`,
      );

      const { bytes: wideBytes, pageMap: wideMap } = await extractPages(pdfBuffer, wide);
      console.info(
        `[pdfExtractor] widened sub-PDF: ${wide.length} pages, ${(wideBytes.length / 1024 / 1024).toFixed(1)} MB`,
      );
      pagesSent = wide.length;
      pagesWidened = true;

      // Run widened extraction (progress events continue from where initial left off).
      const { items: wideItems, failedChunks: wideFailedChunks } = await runChunks({
        buf: wideBytes,
        pageMap: wideMap,
        targetCodes,
        codeFamilies,
        client,
        isSubPdf: true,
        onProgress,
        chunkIndexOffset: 1, // offset by 1 so progress shows chunk 2, 3, ...
      });

      failedChunks.push(...wideFailedChunks);

      // Recompute coverage from the widened result.
      const wideFoundCodes = new Set(wideItems.map((i) => normCode(i.cat_no)));
      const wideResolved = targetCodes.filter((c) => wideFoundCodes.has(normCode(c))).length;
      coverage = wideResolved / targetCodes.length;

      // If the widened run extracted fewer items than the initial run, the extra
      // pages contained mostly non-product content (intros, accessories, etc.).
      // Keep whichever result is richer and log the decision.
      const bestItems = wideItems.length >= initialItems.length ? wideItems : initialItems;
      if (wideItems.length < initialItems.length) {
        console.warn(
          `[pdfExtractor] widened run found fewer items (${wideItems.length} vs ${initialItems.length}) — ` +
          `keeping initial result. Coverage reported from widened codes.`,
        );
      }

      if (coverage < COVERAGE_THRESHOLD) {
        const foundPrefixes = new Set(
          bestItems.map((i) => {
            const dash = i.cat_no.indexOf("-");
            return dash > 0 ? i.cat_no.slice(0, dash + 1) : "";
          }).filter(Boolean),
        );
        const emptySeries = seriesWithNoItems(profile, foundPrefixes);
        console.warn(
          `[pdfExtractor] still ${(coverage * 100).toFixed(0)}% after widening. ` +
          `Empty series: ${emptySeries.join(", ") || "none identified"}. ` +
          `Catalogue structure may have changed — do not auto-widen further; ` +
          `update the catalogue profile manually.`,
        );
      }

      return { items: bestItems, failedChunks, pagesSent, pagesWidened, coverage };
    }
  }

  return { items: initialItems, failedChunks, pagesSent, pagesWidened, coverage };
}
