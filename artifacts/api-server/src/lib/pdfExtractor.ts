/**
 * PDF catalogue extractor using Claude vision.
 *
 * The Sparsh Pearl catalogue is image-only (no text layer), so pdf-parse /
 * pdfjs text extraction return nothing usable. Instead we:
 *   1. Split the PDF into ≤ 25-page chunks with pdf-lib.
 *   2. Send each chunk as a base64 `document` block to Claude (claude-sonnet-4-5).
 *   3. Parse the strict-JSON response.
 *
 * DO NOT use OCR (tesseract) or pdfjs text extraction for this catalogue.
 * The ₹ glyph is misread and adjacent tile codes are picked up as prices.
 */

import { PDFDocument } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";

export interface ExtractedItem {
  cat_no: string;
  variant: string | null; // e.g. "45 Degree", "15mm", "1 Mtr"
  mrp: number;
  product_name: string;
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

const CHUNK_SIZE = 25;

/**
 * Split a PDF buffer into chunks of at most CHUNK_SIZE pages.
 * Returns an array of { buffer, startPage } (startPage is 1-based).
 */
async function splitPdf(
  pdfBuffer: Buffer,
  chunkSize = CHUNK_SIZE,
): Promise<Array<{ buffer: Buffer; startPage: number; endPage: number }>> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const total = srcDoc.getPageCount();
  const chunks: Array<{ buffer: Buffer; startPage: number; endPage: number }> =
    [];

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total);
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

function buildExtractionPrompt(
  targetCodes: string[],
  startPage: number,
  codeFamilies: string[],
): string {
  const targetList =
    targetCodes.length > 0
      ? `Target catalogue codes to find (these are the only ones we need priced):\n${targetCodes.map((c) => `  - ${c}`).join("\n")}\n`
      : "";

  return `You are reading pages ${startPage}+ of the Sparsh Pearl PTMT catalogue. This is an IMAGE-ONLY PDF — there is no text layer. Extract prices visually.

${targetList}
Code families we care about: ${codeFamilies.join(", ")}

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

Return ONLY a JSON array. No prose, no markdown fences, no explanation. Schema:
[
  { "cat_no": "ED-950", "variant": null, "mrp": 467, "product_name": "Bib Cock with Flange", "page": 64 },
  { "cat_no": "ED-951", "variant": "45 Degree", "mrp": 555, "product_name": "Long Body Bib Cock with Flange", "page": 64 },
  { "cat_no": "ED-969", "variant": "90 Degree", "mrp": 561, "product_name": "Long Body Bib Cock with Flange", "page": 64 }
]

If no relevant items are found on these pages, return: []`;
}

/**
 * Extract priced items from a PDF buffer using Claude vision.
 *
 * @param pdfBuffer  Raw PDF bytes
 * @param targetCodes  Competitor codes we expect to find (from the existing mapping)
 * @param codeFamilies  Code-prefix families to extract (from catalogue profile)
 * @param onProgress  Optional callback for progress updates
 */
export async function extractFromPdf(
  pdfBuffer: Buffer,
  targetCodes: string[],
  codeFamilies: string[],
  onProgress?: (p: ExtractionProgress) => void,
): Promise<ExtractedItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });
  const chunks = await splitPdf(pdfBuffer);
  const allItems: ExtractedItem[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const prompt = buildExtractionPrompt(
      targetCodes,
      chunk.startPage,
      codeFamilies,
    );
    const base64 = chunk.buffer.toString("base64");

    let items: ExtractedItem[] = [];
    let lastErr: unknown;

    // Retry once on JSON parse failure
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: base64,
                  },
                } as Anthropic.DocumentBlockParam,
                { type: "text", text: prompt },
              ],
            },
          ],
        });

        const text =
          response.content[0]?.type === "text"
            ? response.content[0].text.trim()
            : "";

        // Strip markdown fences if Claude added them despite instructions
        const cleaned = text
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        const parsed = JSON.parse(cleaned) as unknown[];

        items = parsed
          .filter(
            (x): x is Record<string, unknown> =>
              typeof x === "object" && x !== null,
          )
          .map((x) => ({
            cat_no: String(x.cat_no ?? "").trim().toUpperCase(),
            variant: x.variant ? String(x.variant).trim() || null : null,
            mrp: Number(x.mrp),
            product_name: String(x.product_name ?? "").trim(),
            page:
              typeof x.page === "number"
                ? x.page
                : chunk.startPage,
          }))
          .filter((x) => x.cat_no && !isNaN(x.mrp) && x.mrp > 0);

        break; // success
      } catch (err) {
        lastErr = err;
        if (attempt === 0) {
          // wait 2s before retry
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    if (items.length === 0 && lastErr) {
      console.error(
        `[pdfExtractor] chunk ${i + 1} failed after retry:`,
        lastErr,
      );
    }

    allItems.push(...items);

    onProgress?.({
      chunk: i + 1,
      totalChunks: chunks.length,
      startPage: chunk.startPage,
      endPage: chunk.endPage,
      pagesInChunk: chunk.endPage - chunk.startPage + 1,
      itemsFound: items.length,
      totalItemsFound: allItems.length,
    });
  }

  return allItems;
}
