/**
 * Cheap, deterministic PDF inspection used before an extraction is selected.
 *
 * This deliberately does not invoke an AI model and does not write anything to
 * the database.  It is safe to call from both the preflight endpoint and the
 * upload route (the latter is a guard for API clients which skip the UI).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";

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

function pageText(pdfPath: string, page: number): string {
  try {
    return execFileSync("pdftotext", [
      "-layout", "-f", String(page), "-l", String(page), pdfPath, "-",
    ], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    // A page which Poppler cannot read is evidence of no extractable text, not
    // a reason to make the entire upload unavailable for a vision path.
    return "";
  }
}

/** Read every page in one Poppler pass; form-feed is pdftotext's page delimiter. */
function allPageText(pdfPath: string, totalPages: number): string[] {
  try {
    const output = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: Math.max(8 * 1024 * 1024, totalPages * 512 * 1024),
    });
    const pages = output.split("\f");
    while (pages.length < totalPages) pages.push("");
    return pages.slice(0, totalPages);
  } catch {
    return Array.from({ length: totalPages }, (_, index) => pageText(pdfPath, index + 1));
  }
}

function classifyText(text: string): { characters: number; digits: number; textBearing: boolean } {
  const characters = text.length;
  const digits = [...text].filter((character) => /\p{Nd}/u.test(character)).length;
  return { characters, digits, textBearing: characters > 200 && digits > 20 };
}

export async function preflightPdf(pdfBuffer: Buffer): Promise<PdfPreflight> {
  if (!pdfBuffer.length) throw new Error("The uploaded PDF is empty.");
  const dir = mkdtempSync(join(tmpdir(), "pdf-preflight-"));
  const pdfPath = join(dir, "catalogue.pdf");
  try {
    writeFileSync(pdfPath, pdfBuffer);
    const document = await PDFDocument.load(pdfBuffer, { ignoreEncryption: false });
    const totalPages = document.getPageCount();
    if (totalPages < 1) throw new Error("The uploaded PDF has no pages.");
    const samplePages = samplePdfPages(totalPages);
    const allClassifications = allPageText(pdfPath, totalPages).map(classifyText);
    const pages = samplePages.map((page) => ({ page, ...allClassifications[page - 1]! }));
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function isExtractionPath(value: unknown): value is ExtractionPath {
  return typeof value === "string" &&
    (EXTRACTION_PATHS as readonly string[]).includes(value);
}