/**
 * Cheap, deterministic PDF inspection used before an extraction is selected.
 *
 * This deliberately does not invoke an AI model and does not write anything to
 * the database.  It is safe to call from both the preflight endpoint and the
 * upload route (the latter is a guard for API clients which skip the UI).
 */
import { createHash } from "node:crypto";
import { extractPdfJsPages } from "./pdfJsText.js";

export const EXTRACTION_PATHS = ["text", "vision", "text_then_ai"] as const;
export type ExtractionPath = (typeof EXTRACTION_PATHS)[number];
export type PdfDetection =
  | "text"
  | "vision"
  | "uncertain";

export type PdfPagePreflight = {
  page: number;
  characters: number;
  digits: number;
  textBearing: boolean;
};

export type PdfPreflight = {
  fileSha256: string;
  fileSizeBytes: number;
  totalPages: number;
  samplePages: number[];
  pages: PdfPagePreflight[];
  sampleCount: number;
  textBearingCount: number;
  textBearingShare: number;
  medianCharacters: number;
  medianDigits: number;
  detectedClass: PdfDetection;
  recommendedPath: ExtractionPath | null;
  textBearingPages: number[];
  nonTextBearingPages: number[];
  assignmentTextBearingCount: number;
  assignmentNonTextBearingCount: number;
  humanReason: string;
};

const SAMPLE_SIZE = 12;
const TEXT_EXTRACTION_UNAVAILABLE_MESSAGE =
  "Text extraction unavailable: every sampled page returned zero characters. The PDF was not classified as image-only and AI vision was not recommended. Extraction was not started.";

export class PdfTextExtractionUnavailableError extends Error {
  readonly code = "PDF_TEXT_EXTRACTION_UNAVAILABLE";

  constructor(message = TEXT_EXTRACTION_UNAVAILABLE_MESSAGE, options?: ErrorOptions) {
    super(message, options);
    this.name = "PdfTextExtractionUnavailableError";
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** Select unique, evenly-spaced 1-based pages, always including first/last. */
export function samplePdfPages(totalPages: number, sampleSize = SAMPLE_SIZE): number[] {
  if (totalPages <= 0) return [];
  const count = Math.min(totalPages, Math.max(1, sampleSize));
  if (count === 1) return [1];
  const pages = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    pages.add(Math.round((index * (totalPages - 1)) / (count - 1)) + 1);
  }
  pages.add(1);
  pages.add(totalPages);
  return [...pages].sort((a, b) => a - b);
}

function classifyText(text: string): { characters: number; digits: number; textBearing: boolean } {
  const characters = text.length;
  const digits = [...text].filter((character) => /\p{Nd}/u.test(character)).length;
  return { characters, digits, textBearing: characters > 200 && digits > 20 };
}

export async function preflightPdf(pdfBuffer: Buffer): Promise<PdfPreflight> {
  if (!pdfBuffer.length) throw new Error("The uploaded PDF is empty.");
  try {
    const extracted = await extractPdfJsPages(pdfBuffer);
    const totalPages = extracted.totalPages;
    if (totalPages < 1) throw new Error("The uploaded PDF has no pages.");
    const samplePages = samplePdfPages(totalPages);
    const allClassifications = extracted.pages.map((page) => classifyText(page.text));
    const pages = samplePages.map((page) => ({ page, ...allClassifications[page - 1]! }));
    if (pages.every((page) => page.characters === 0)) {
      throw new PdfTextExtractionUnavailableError();
    }
    const sampledTextBearingPages = pages.filter((page) => page.textBearing).map((page) => page.page);
    const textBearingPages = allClassifications
      .map((classification, index) => classification.textBearing ? index + 1 : null)
      .filter((page): page is number => page != null);
    const nonTextBearingPages = allClassifications
      .map((classification, index) => classification.textBearing ? null : index + 1)
      .filter((page): page is number => page != null);
    const textBearingShare = pages.length ? sampledTextBearingPages.length / pages.length : 0;
    const detectedClass: PdfDetection =
      textBearingShare >= 0.70 ? "text" :
      textBearingShare <= 0.20 ? "vision" : "uncertain";
    const recommendedPath: ExtractionPath | null =
      detectedClass === "text" ? "text" :
      detectedClass === "vision" ? "vision" : null;
    const sharePercent = Math.round(textBearingShare * 100);
    const humanReason = detectedClass === "text"
      ? `${sampledTextBearingPages.length} of ${pages.length} sampled pages (${sharePercent}%) carry more than 200 characters and 20+ decimal digits, so positional text extraction is recommended.`
      : detectedClass === "vision"
        ? `${sampledTextBearingPages.length} of ${pages.length} sampled pages (${sharePercent}%) carry extractable price text, so AI vision extraction is recommended.`
        : `${sampledTextBearingPages.length} of ${pages.length} sampled pages (${sharePercent}%) carry extractable price text. This mixed document needs an explicit extraction choice.`;
    return {
      fileSha256: createHash("sha256").update(pdfBuffer).digest("hex"),
      fileSizeBytes: pdfBuffer.length,
      totalPages,
      samplePages,
      pages,
      sampleCount: pages.length,
      textBearingCount: sampledTextBearingPages.length,
      textBearingShare,
      medianCharacters: median(pages.map((page) => page.characters)),
      medianDigits: median(pages.map((page) => page.digits)),
      detectedClass,
      recommendedPath,
      textBearingPages,
      nonTextBearingPages,
      assignmentTextBearingCount: textBearingPages.length,
      assignmentNonTextBearingCount: nonTextBearingPages.length,
      humanReason,
    };
  } catch (error) {
    if (error instanceof PdfTextExtractionUnavailableError) throw error;
    const detail = error instanceof Error
      ? `${error.name}${"code" in error && error.code ? ` ${(error as NodeJS.ErrnoException).code}` : ""}: ${error.message}`
      : String(error);
    throw new PdfTextExtractionUnavailableError(
      `Text extraction unavailable: pdfjs-dist could not read the PDF (${detail}). AI vision was not recommended and extraction was not started.`,
      { cause: error },
    );
  }
}

export function isExtractionPath(value: unknown): value is ExtractionPath {
  return typeof value === "string" &&
    (EXTRACTION_PATHS as readonly string[]).includes(value);
}