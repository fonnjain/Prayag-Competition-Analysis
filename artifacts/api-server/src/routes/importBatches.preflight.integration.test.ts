import express from "express";
import supertest from "supertest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { db, importBatchesTable } from "@workspace/db";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import importBatchesRouter from "./importBatches.js";

const app = express();
app.use(express.json());
app.use(importBatchesRouter);
const request = supertest(app);

async function syntheticPdf(text: string, textPages = 12) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 12; index += 1) {
    const page = pdf.addPage([595, 842]);
    if (index < textPages) {
      const lines = text.match(/.{1,70}/g) ?? [text];
      lines.slice(0, 45).forEach((line, lineIndex) => {
        page.drawText(line, { x: 20, y: 810 - lineIndex * 16, size: 8, font });
      });
    }
  }
  return Buffer.from(await pdf.save());
}

describe("PDF preflight route", () => {
  const princeFixture = () => readFileSync(fileURLToPath(new URL(
    "../../../../attached_assets/Prince_Pipes_-_Pan_India_-_Pricelist_1789458928833.pdf",
    import.meta.url,
  )));

  it("requires an explicit extraction path and matching preflight SHA", async () => {
    const pdf = princeFixture();
    const missing = await request
      .post("/catalog/import-batches")
      .field("competitor", "Prince")
      .field("effectiveDate", "2098-01-01")
      .attach("file", pdf, { filename: "prince.pdf", contentType: "application/pdf" });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("PREFLIGHT_REQUIRED");

    const stale = await request
      .post("/catalog/import-batches")
      .field("competitor", "Prince")
      .field("effectiveDate", "2098-01-01")
      .field("extractionPath", "text")
      .field("preflightSha256", "0".repeat(64))
      .attach("file", pdf, { filename: "prince.pdf", contentType: "application/pdf" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("PREFLIGHT_STALE");
  }, 60_000);

  it("detects the mandatory attached Prince fixture before any batch write", async () => {
    const pdf = readFileSync(fileURLToPath(new URL(
      "../../../../attached_assets/Prince_Pipes_-_Pan_India_-_Pricelist_1789458928833.pdf",
      import.meta.url,
    )));
    const response = await request
      .post("/catalog/import-batches/preflight")
      .field("competitor", "Prince")
      .field("effectiveDate", "2026-03-01")
      .attach("file", pdf, { filename: "prince.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(200);
    expect(response.body.detectedClass).toBe("text");
    expect(response.body.recommendedPath).toBe("text");
    expect(response.body.totalPages).toBe(108);
    expect(response.body.sampleCount).toBe(12);
    const matching = await db.select({ id: importBatchesTable.id })
      .from(importBatchesTable)
      .where(and(
        eq(importBatchesTable.competitor, "Prince"),
        eq(importBatchesTable.effectiveDate, "2026-03-01"),
        eq(importBatchesTable.fileSha256, response.body.fileSha256),
      ));
    expect(matching).toHaveLength(0);
  }, 60_000);

  it("returns vision for image-only and uncertain for mixed pages", async () => {
    const imageOnly = await syntheticPdf("");
    const mixed = await syntheticPdf(`${"PRICE TABLE ".repeat(30)} ${Array.from({ length: 80 }, (_, i) => i + 100).join(" ")}`, 6);
    const vision = await request
      .post("/catalog/import-batches/preflight")
      .field("competitor", "__p018_preflight_image__")
      .attach("file", imageOnly, { filename: "image.pdf", contentType: "application/pdf" });
    const uncertain = await request
      .post("/catalog/import-batches/preflight")
      .field("competitor", "Prince")
      .attach("file", mixed, { filename: "mixed.pdf", contentType: "application/pdf" });
    expect(vision.body.detectedClass).toBe("vision");
    expect(vision.body.recommendedPath).toBe("vision");
    expect(uncertain.body.detectedClass).toBe("uncertain");
    expect(uncertain.body.recommendedPath).toBeNull();
  }, 60_000);
});