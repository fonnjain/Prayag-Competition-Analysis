import { extractPdfJsPages, type PdfJsWord } from "./pdfJsText.js";
import type { ExtractedItem } from "./pdfExtractor.js";

/**
 * The Apollo catalogue is text-native, but its size is a separate cell to the
 * left of the item code. The vision prompt historically treated that cell as
 * decoration and returned null variants. Resolve it from the same row instead
 * of guessing from a neighbouring product.
 */
const CODE = /^[A-Z]{1,8}[A-Z0-9-]{4,}$/i;
const SIZE = /^(?=.*\d)[\d¼½¾⅓⅔⅛⅜⅝⅞⁄/.'"’"×xX–-]+$/;

const normCode = (value: string) => value;

function rowFor(words: PdfJsWord[], code: PdfJsWord): PdfJsWord[] {
  return words
    .filter((word) => Math.abs(word.yMin - code.yMin) <= 2.5)
    .sort((a, b) => a.xMin - b.xMin);
}

function formatSize(word: PdfJsWord): string | null {
  const value = word.text.trim().replace(/[×X]/g, "x").replace(/\s+/g, "");
  if (!SIZE.test(value)) return null;
  // Apollo's tables label this column mm. Quoted values are the inches column.
  return /["'”]/.test(value) ? value : `${value}mm`;
}

export type ApolloSizeEvidence = {
  code: string;
  page: number;
  size: string | null;
  row: string;
  /** Existing extracted value, when present; never replaced by enrichment. */
  existingSize?: string | null;
};

/**
 * Enrich only an already extracted Apollo code. A code may occur on multiple
 * pages; a size is accepted only when every occurrence on the relevant page
 * agrees. Ambiguous occurrences remain null for manual review.
 */
export async function enrichApolloSizes(
  pdfBuffer: Buffer,
  items: ExtractedItem[],
): Promise<{ items: ExtractedItem[]; evidence: ApolloSizeEvidence[] }> {
  const pages = await extractPdfJsPages(pdfBuffer);
  const wanted = new Set(items.map((item) => normCode(item.cat_no)));
  const occurrences = new Map<string, ApolloSizeEvidence[]>();
  for (const page of pages.pages) {
    for (const code of page.words.filter((word) => CODE.test(normCode(word.text)))) {
      const normalized = normCode(code.text);
      if (!wanted.has(normalized)) continue;
      const row = rowFor(page.words, code);
      const left = row
        .filter((word) => word.xMax <= code.xMin + 1)
        .sort((a, b) => b.xMax - a.xMax);
      const sizeWord = left.map(formatSize).find((size): size is string => size != null) ?? null;
      const evidence = { code: normalized, page: page.page, size: sizeWord, row: row.map((word) => word.text).join(" ") };
      occurrences.set(normalized, [...(occurrences.get(normalized) ?? []), evidence]);
    }
  }
  const evidence = [...occurrences.values()].flat();
  return {
    evidence,
    items: items.map((item) => {
      const matches = occurrences.get(normCode(item.cat_no)) ?? [];
      // A same-code occurrence on another page is not evidence for this item.
      const candidates = matches.filter((match) => match.page === item.page);
      const sizes = [...new Set(candidates.map((match) => match.size).filter((size): size is string => !!size))];
      // Do not choose a size when a code's PDF occurrences disagree.
      const existingSize = item.variant?.trim() || null;
      if (existingSize) {
        for (const match of candidates) {
          match.existingSize = existingSize;
        }
        return item;
      }
      return sizes.length === 1 && candidates.every((match) => match.size === sizes[0])
        ? { ...item, variant: sizes[0] }
        : item;
    }),
  };
}