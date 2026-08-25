import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMessagesCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockMessagesCreate };
  },
}));

vi.mock("pdf-lib", () => {
  const makeOutputDocument = () => ({
    copyPages: vi.fn().mockResolvedValue([{}]),
    addPage: vi.fn(),
    save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  });
  return {
    PDFDocument: {
      load: vi.fn().mockResolvedValue({ getPageCount: () => 1 }),
      create: vi.fn().mockResolvedValue(makeOutputDocument()),
    },
  };
});

import {
  extractFromPdf,
  EXTRACTION_MODEL,
  EXTRACTOR_VERSION,
  PROMPT_REVISION,
  buildPdfBatchProvenance,
} from "./pdfExtractor.js";
import { PDFDocument } from "pdf-lib";

const FAKE_PDF = Buffer.from("fake-pdf-bytes");
const item = (code: string, mrp: number, productName = "Widget") => ({
  cat_no: code,
  variant: null,
  mrp,
  product_name: productName,
  page: 1,
});
const response = (items: unknown[]) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(items) }],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(PDFDocument.load).mockResolvedValue({ getPageCount: () => 1 } as never);
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("two-pass catalogue discovery", () => {
  it("accepts matching page reads after exactly two intentional model calls", async () => {
    mockMessagesCreate.mockResolvedValue(response([item("ED-950", 467)]));

    const result = await extractFromPdf(FAKE_PDF, [], []);

    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual([
      expect.objectContaining({
        cat_no: "ED-950",
        mrp: 467,
        page: 1,
        discoveryPasses: [1, 2],
        adjudicated: false,
      }),
    ]);
    expect(result.pagesAdjudicated).toEqual([]);
    expect(result.codesFoundBothPasses).toBe(1);
    expect(result.codesFoundOnePassOnly).toBe(0);
    expect(result.itemsAdjudicated).toBe(0);
    expect(result.passesRun).toBe(2);
  });

  it("adjudicates a code found in one initial read instead of accepting their union", async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(response([item("ED-950", 467)]))
      .mockResolvedValueOnce(response([item("ED-950", 467), item("RS-111", 555)]))
      .mockResolvedValueOnce(response([item("ED-950", 467)]));

    const result = await extractFromPdf(FAKE_PDF, [], []);

    expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
    expect(result.pagesAdjudicated).toEqual([1]);
    expect(result.codesFoundBothPasses).toBe(1);
    expect(result.codesFoundOnePassOnly).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        cat_no: "ED-950",
        discoveryPasses: [1, 2, 3],
        adjudicated: true,
      }),
    ]);
    expect(result.items.find((found) => found.cat_no === "RS-111")).toBeUndefined();
    expect(result.itemsAdjudicated).toBe(1);
  });

  it("adjudicates a price disagreement and stores the third-read price", async () => {
    mockMessagesCreate
      .mockResolvedValueOnce(response([item("ED-950", 467)]))
      .mockResolvedValueOnce(response([item("ED-950", 499)]))
      .mockResolvedValueOnce(response([item("ED-950", 480)]));

    const result = await extractFromPdf(FAKE_PDF, [], []);

    expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
    expect(result.pagesAdjudicated).toEqual([1]);
    expect(result.items[0]).toMatchObject({
      cat_no: "ED-950",
      mrp: 480,
      discoveryPasses: [1, 2, 3],
      adjudicated: true,
    });
  });

  it("widens only with supplemental pages and never rereads agreed original pages", async () => {
    vi.mocked(PDFDocument.load).mockResolvedValue({ getPageCount: () => 2 } as never);
    mockMessagesCreate.mockResolvedValue(response([]));

    const result = await extractFromPdf(
      FAKE_PDF,
      ["MISSING"],
      [],
      undefined,
      {
        competitor: "Test",
        catalogueName: "Low coverage",
        pageCount: 2,
        codeFamilies: [],
        seriesMap: [{
          prayagSeries: "All",
          sparshSeries: "All",
          codePrefix: "TEST-",
          pages: [1],
        }],
      },
    );

    expect(mockMessagesCreate).toHaveBeenCalledTimes(4);
    expect(result.pagesRequested).toEqual([1]);
    expect(result.pagesSupplemental).toEqual([2]);
    expect(result.pagesSent).toBe(2);
    expect(result.pagesWidened).toBe(true);
  });

  it("normalises item fields while retaining page evidence", async () => {
    mockMessagesCreate.mockResolvedValue(response([
      { cat_no: " ed-950 ", variant: " 45 Degree ", mrp: "120.50", product_name: " Bib Cock ", page: 1 },
      { cat_no: "ED-951", variant: null, mrp: 0, product_name: "Ignored", page: 1 },
    ]));

    const result = await extractFromPdf(FAKE_PDF, [], []);

    expect(result.items).toEqual([
      expect.objectContaining({
        cat_no: "ED-950",
        variant: "45 Degree",
        mrp: 120.5,
        product_name: "Bib Cock",
        discoveryPasses: [1, 2],
      }),
    ]);
  });

  it("records both failed reads when an API error persists", async () => {
    mockMessagesCreate.mockRejectedValue(new Error("API timeout"));

    const result = await extractFromPdf(FAKE_PDF, [], []);

    expect(result.items).toEqual([]);
    expect(result.failedChunks).toHaveLength(2);
    expect(result.failedChunks[0]).toMatchObject({
      startPage: 1,
      endPage: 1,
      error: "API timeout",
    });
  });

  it("uses the declared model and reports pass-aware progress", async () => {
    mockMessagesCreate.mockResolvedValue(response([]));
    const progress: Array<{ pass: number; chunk: number; totalChunks: number }> = [];

    await extractFromPdf(FAKE_PDF, [], [], (value) => progress.push(value));

    expect(mockMessagesCreate.mock.calls[0]?.[0]).toMatchObject({ model: EXTRACTION_MODEL });
    expect(progress).toMatchObject([
      { pass: 1, chunk: 1, totalChunks: 2 },
      { pass: 2, chunk: 2, totalChunks: 2 },
    ]);
  });

  it("exposes stable version constants for batch provenance", () => {
    expect(EXTRACTOR_VERSION).toMatch(/^pdf-code-discovery-/);
    expect(PROMPT_REVISION).toMatch(/^catalogue-extraction-/);
  });

  it("captures a deterministic source identity and profile revision before extraction", () => {
    const provenance = buildPdfBatchProvenance(FAKE_PDF, {
      competitor: "Sparsh Pearl",
      catalogueName: "PTMT Vol 6.2",
      revision: "test-profile-r1",
      pageCount: 1,
      codeFamilies: [],
      seriesMap: [{
        prayagSeries: "All",
        sparshSeries: "All",
        codePrefix: "TEST-",
        pages: [1],
      }],
    });

    expect(provenance).toEqual({
      fileSha256: "50af8d443ccf8b2777b72a9169cd0665ef4be5335b8f53543556fa0d320b135b",
      fileSizeBytes: FAKE_PDF.length,
      extractorVersion: EXTRACTOR_VERSION,
      catalogueProfileRevision: "test-profile-r1",
      promptRevision: PROMPT_REVISION,
      model: EXTRACTION_MODEL,
      pagesRequested: "[1]",
    });
  });

  it("fails before reading when no integration key is available", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(extractFromPdf(FAKE_PDF, [], [])).rejects.toThrow("ANTHROPIC_API_KEY is not set");
  });
});