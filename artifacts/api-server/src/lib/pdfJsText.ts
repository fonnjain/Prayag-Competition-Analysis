import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfJsWord = {
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export type PdfJsPage = {
  page: number;
  text: string;
  words: PdfJsWord[];
};

function splitTextItem(
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
): PdfJsWord[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\s+/);
  const totalCharacters = Math.max(1, trimmed.length);
  let cursor = 0;
  return parts.map((part) => {
    const characterOffset = Math.max(cursor, trimmed.indexOf(part, cursor));
    const xMin = x + width * (characterOffset / totalCharacters);
    const xMax = xMin + width * (part.length / totalCharacters);
    cursor = characterOffset + part.length;
    return { text: part, xMin, xMax, yMin: y, yMax: y + height };
  });
}

/**
 * Extract text and deterministic page coordinates using an application
 * dependency. This deliberately does not call a system executable, so the
 * extraction path is identical in development and published deployments.
 */
export async function extractPdfJsPages(
  pdfBuffer: Buffer,
  requestedPages?: number[],
): Promise<{ totalPages: number; pages: PdfJsPage[] }> {
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
  });
  try {
    const document = await loadingTask.promise;
    const pageNumbers = requestedPages
      ? [...new Set(requestedPages)]
        .filter((page) => Number.isInteger(page) && page >= 1 && page <= document.numPages)
        .sort((a, b) => a - b)
      : Array.from({ length: document.numPages }, (_, index) => index + 1);
    const pages: PdfJsPage[] = [];
    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const textItems = content.items.filter((item): item is typeof item & {
        str: string;
        transform: number[];
        width: number;
        height: number;
      } => "str" in item);
      const words = textItems.flatMap((item) => {
        const itemHeight = Math.max(
          item.height,
          Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0),
        );
        const yMin = viewport.height - (item.transform[5] ?? 0) - itemHeight;
        return splitTextItem(
          item.str,
          item.transform[4] ?? 0,
          yMin,
          item.width,
          itemHeight,
        );
      });
      pages.push({
        page: pageNumber,
        text: textItems.map((item) => item.str).join(" "),
        words,
      });
    }
    return { totalPages: document.numPages, pages };
  } finally {
    await loadingTask.destroy();
  }
}