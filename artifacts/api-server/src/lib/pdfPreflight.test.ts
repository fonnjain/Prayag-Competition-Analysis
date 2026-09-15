import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  PdfTextExtractionUnavailableError,
  preflightPdf,
  samplePdfPages,
} from "./pdfPreflight.js";

async function textPdf(pageCount: number, text: string, textPages = pageCount) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 0; pageNumber < pageCount; pageNumber += 1) {
    const page = pdf.addPage([595, 842]);
    if (pageNumber < textPages) {
      const lines = text.match(/.{1,70}/g) ?? [text];
      lines.slice(0, 45).forEach((line, lineIndex) => {
        page.drawText(line, { x: 24, y: 810 - lineIndex * 16, size: 8, font });
      });
    }
  }
  return Buffer.from(await pdf.save());
}

describe("PDF preflight detector", () => {
  it("samples unique pages evenly and includes first and last", () => {
    const sample = samplePdfPages(108);
    expect(sample).toHaveLength(12);
    expect(sample[0]).toBe(1);
    expect(sample.at(-1)).toBe(108);
    expect(new Set(sample).size).toBe(sample.length);
    expect(new Set(samplePdfPages(3)).size).toBe(3);
  });

  it("detects text-bearing Prince-style pages using the digit test", async () => {
    const text = `${"PRODUCT CATALOGUE ".repeat(20)} ${Array.from({ length: 80 }, (_, i) => String(i + 100)).join(" ")}`;
    const result = await preflightPdf(await textPdf(12, text));
    expect(result.detectedClass).toBe("text");
    expect(result.recommendedPath).toBe("text");
    expect(result.textBearingCount).toBe(12);
    expect(result.medianDigits).toBeGreaterThan(20);
  });

  it("does not mistake an all-zero sample for an image-only PDF", async () => {
    await expect(preflightPdf(await textPdf(12, ""))).rejects.toMatchObject({
      name: "PdfTextExtractionUnavailableError",
      code: "PDF_TEXT_EXTRACTION_UNAVAILABLE",
      message: expect.stringContaining("Text extraction unavailable"),
    } satisfies Partial<PdfTextExtractionUnavailableError>);
  });

  it("does not mistake text headers for a priced text catalogue", async () => {
    const result = await preflightPdf(await textPdf(
      12,
      "PRINCE PIPES PRICE LIST PRODUCT CATALOGUE PRICE TABLE",
    ));
    expect(result.detectedClass).toBe("vision");
    expect(result.textBearingCount).toBe(0);
  });

  it("reports a mixed PDF as uncertain with page assignments", async () => {
    const text = `${"PRICE TABLE ".repeat(30)} ${Array.from({ length: 80 }, (_, i) => String(i + 100)).join(" ")}`;
    const result = await preflightPdf(await textPdf(12, text, 6));
    expect(result.detectedClass).toBe("uncertain");
    expect(result.recommendedPath).toBeNull();
    expect(result.textBearingCount).toBe(6);
    expect(result.nonTextBearingPages).toHaveLength(6);
    expect([...result.textBearingPages, ...result.nonTextBearingPages].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(new Set([...result.textBearingPages, ...result.nonTextBearingPages]).size).toBe(12);
  });

  it("detects the attached Prince catalogue without writing anything", async () => {
    // This is a mandatory workspace-root fixture: silently skipping it would
    // allow a broken bundled text-extraction setup to pass CI.
    const path = new URL(
      "../../../../attached_assets/Prince_Pipes_-_Pan_India_-_Pricelist_1789458928833.pdf",
      import.meta.url,
    );
    const result = await preflightPdf(readFileSync(path));
    expect(result.fileSha256).toBe("4afa4f95debfd6581cd584707e2bcd65ac320a430c268e734c0f0cd9784fd31c");
    expect(result.detectedClass).toBe("text");
    expect(result.recommendedPath).toBe("text");
    expect(result.totalPages).toBeGreaterThan(1);
    expect(result.sampleCount).toBeLessThanOrEqual(12);
    expect(result.totalPages).toBe(108);
    expect(result.textBearingCount).toBe(11);
    expect(result.sampleCount).toBe(12);
    expect(result.textBearingPages.length + result.nonTextBearingPages.length).toBe(108);
    expect(new Set([...result.textBearingPages, ...result.nonTextBearingPages]).size).toBe(108);
    expect([...result.textBearingPages, ...result.nonTextBearingPages].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 108 }, (_, index) => index + 1));
  });
});