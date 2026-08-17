import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock factories so they're available inside vi.mock() closures
// ---------------------------------------------------------------------------

const mockMessagesCreate = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK — no real HTTP requests
// Uses a class so `new Anthropic(...)` works correctly.
// ---------------------------------------------------------------------------

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockMessagesCreate };
  },
}));

// ---------------------------------------------------------------------------
// Mock pdf-lib — no real PDF parsing needed
// ---------------------------------------------------------------------------

vi.mock("pdf-lib", () => {
  // newDoc returned by PDFDocument.create()
  const makeFakeNewDoc = () => ({
    copyPages: vi.fn().mockResolvedValue([{}]),
    addPage: vi.fn(),
    save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  });

  // srcDoc returned by PDFDocument.load()
  const makeFakeSrcDoc = (pageCount = 1) => ({
    getPageCount: () => pageCount,
  });

  return {
    PDFDocument: {
      load: vi.fn().mockImplementation(async () => makeFakeSrcDoc(1)),
      create: vi.fn().mockImplementation(async () => makeFakeNewDoc()),
    },
  };
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import { extractFromPdf, EXTRACTION_MODEL } from "./pdfExtractor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Claude API response with the given JSON text as the first content block. */
function makeClaudeResponse(jsonText: string) {
  return {
    content: [{ type: "text", text: jsonText }],
  };
}

/** A minimal valid fake PDF buffer (content doesn't matter — pdf-lib is mocked). */
const FAKE_PDF = Buffer.from("fake-pdf-bytes");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

// ---------------------------------------------------------------------------
// Well-formed response → correct ExtractedItem array
// ---------------------------------------------------------------------------

describe("well-formed Claude response", () => {
  it("returns a correctly shaped ExtractedItem array", async () => {
    const rawItems = [
      {
        cat_no: "ED-950",
        variant: null,
        mrp: 467,
        product_name: "Bib Cock with Flange",
        page: 64,
      },
      {
        cat_no: "ED-951",
        variant: "45 Degree",
        mrp: 555,
        product_name: "Long Body Bib Cock",
        page: 64,
      },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const results = await extractFromPdf(FAKE_PDF, [], []);

    expect(results).toHaveLength(2);

    expect(results[0]).toMatchObject({
      cat_no: "ED-950",
      variant: null,
      mrp: 467,
      product_name: "Bib Cock with Flange",
      page: 64,
    });

    expect(results[1]).toMatchObject({
      cat_no: "ED-951",
      variant: "45 Degree",
      mrp: 555,
      product_name: "Long Body Bib Cock",
      page: 64,
    });
  });

  it("uppercases cat_no regardless of casing in Claude response", async () => {
    const rawItems = [
      { cat_no: "ed-950", variant: null, mrp: 100, product_name: "Widget", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const [item] = await extractFromPdf(FAKE_PDF, [], []);
    expect(item!.cat_no).toBe("ED-950");
  });

  it("trims whitespace from cat_no", async () => {
    const rawItems = [
      { cat_no: "  ED-950  ", variant: null, mrp: 100, product_name: "Widget", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const [item] = await extractFromPdf(FAKE_PDF, [], []);
    expect(item!.cat_no).toBe("ED-950");
  });

  it("passes through non-null variant as a trimmed string", async () => {
    const rawItems = [
      { cat_no: "ED-951", variant: "  45 Degree  ", mrp: 555, product_name: "x", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const [item] = await extractFromPdf(FAKE_PDF, [], []);
    expect(item!.variant).toBe("45 Degree");
  });

  it("coerces an empty-string variant to null", async () => {
    const rawItems = [
      { cat_no: "ED-951", variant: "", mrp: 555, product_name: "x", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const [item] = await extractFromPdf(FAKE_PDF, [], []);
    expect(item!.variant).toBeNull();
  });

  it("falls back to chunk.startPage (1) when page field is absent", async () => {
    const rawItems = [
      { cat_no: "ED-950", variant: null, mrp: 200, product_name: "x" },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const [item] = await extractFromPdf(FAKE_PDF, [], []);
    // chunk.startPage for the single mocked chunk is 1
    expect(item!.page).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Price normalisation
// ---------------------------------------------------------------------------

describe("price normalisation", () => {
  it("converts a string mrp to a number", async () => {
    const rawItems = [
      { cat_no: "ED-950", variant: null, mrp: "120.50", product_name: "x", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const [item] = await extractFromPdf(FAKE_PDF, [], []);
    expect(item!.mrp).toBe(120.5);
    expect(typeof item!.mrp).toBe("number");
  });

  it("converts an integer string mrp correctly", async () => {
    const rawItems = [
      { cat_no: "ED-950", variant: null, mrp: "467", product_name: "x", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const [item] = await extractFromPdf(FAKE_PDF, [], []);
    expect(item!.mrp).toBe(467);
  });

  it("filters out items where mrp is zero", async () => {
    const rawItems = [
      { cat_no: "ED-950", variant: null, mrp: 0, product_name: "x", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toHaveLength(0);
  });

  it("filters out items where mrp is negative", async () => {
    const rawItems = [
      { cat_no: "ED-950", variant: null, mrp: -10, product_name: "x", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toHaveLength(0);
  });

  it("filters out items where mrp is non-numeric garbage", async () => {
    const rawItems = [
      { cat_no: "ED-950", variant: null, mrp: "N/A", product_name: "x", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Malformed / empty Claude response → graceful empty array
// ---------------------------------------------------------------------------

describe("malformed or empty Claude response", () => {
  it("returns empty array when Claude returns an empty JSON array", async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse("[]"));

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toEqual([]);
  });

  it("returns empty array when JSON is invalid (both retry attempts fail)", async () => {
    // Both attempts throw a JSON parse error
    mockMessagesCreate.mockRejectedValue(new SyntaxError("Unexpected token"));

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toEqual([]);
  });

  it("returns empty array when response content array is empty", async () => {
    mockMessagesCreate.mockResolvedValueOnce({ content: [] });

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toEqual([]);
  });

  it("returns empty array when response content block type is not 'text'", async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "x", name: "foo", input: {} }],
    });

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toEqual([]);
  });

  it("filters out items whose cat_no resolves to an empty string", async () => {
    const rawItems = [
      { cat_no: null, variant: null, mrp: 100, product_name: "x", page: 1 },
      { cat_no: "", variant: null, mrp: 200, product_name: "y", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toHaveLength(0);
  });

  it("silently skips non-object elements inside the JSON array", async () => {
    // Claude occasionally emits a mixed array with nulls or strings
    const mixed = JSON.stringify([
      null,
      "some prose",
      42,
      { cat_no: "ED-950", variant: null, mrp: 100, product_name: "x", page: 1 },
    ]);
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(mixed));

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toHaveLength(1);
    expect(results[0]!.cat_no).toBe("ED-950");
  });
});

// ---------------------------------------------------------------------------
// Markdown fence stripping
// ---------------------------------------------------------------------------

describe("markdown fence stripping", () => {
  it("strips ```json ... ``` fences that Claude adds despite instructions", async () => {
    const rawItems = [
      { cat_no: "ED-950", variant: null, mrp: 467, product_name: "Bib Cock", page: 1 },
    ];
    const fenced = "```json\n" + JSON.stringify(rawItems) + "\n```";
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(fenced));

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toHaveLength(1);
    expect(results[0]!.cat_no).toBe("ED-950");
  });

  it("strips plain ``` ... ``` fences", async () => {
    const rawItems = [
      { cat_no: "ED-951", variant: "15mm", mrp: 200, product_name: "Widget", page: 2 },
    ];
    const fenced = "```\n" + JSON.stringify(rawItems) + "\n```";
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse(fenced));

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toHaveLength(1);
    expect(results[0]!.mrp).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe("retry on transient failure", () => {
  it("succeeds on the second attempt when the first throws", async () => {
    const rawItems = [
      { cat_no: "ED-950", variant: null, mrp: 467, product_name: "x", page: 1 },
    ];
    mockMessagesCreate
      .mockRejectedValueOnce(new Error("Network blip"))
      .mockResolvedValueOnce(makeClaudeResponse(JSON.stringify(rawItems)));

    const results = await extractFromPdf(FAKE_PDF, [], []);
    expect(results).toHaveLength(1);
    expect(results[0]!.cat_no).toBe("ED-950");
  });
});

// ---------------------------------------------------------------------------
// Model name consistency
// ---------------------------------------------------------------------------

describe("model name", () => {
  it("passes EXTRACTION_MODEL to the Claude API, not a hardcoded string", async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse("[]"));

    await extractFromPdf(FAKE_PDF, [], []);

    expect(mockMessagesCreate).toHaveBeenCalledOnce();
    const callArg = mockMessagesCreate.mock.calls[0]![0] as { model: string };
    expect(callArg.model).toBe(EXTRACTION_MODEL);
  });
});

// ---------------------------------------------------------------------------
// Missing API key
// ---------------------------------------------------------------------------

describe("missing ANTHROPIC_API_KEY", () => {
  it("throws immediately when the env var is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(extractFromPdf(FAKE_PDF, [], [])).rejects.toThrow(
      "ANTHROPIC_API_KEY is not set",
    );
  });
});

// ---------------------------------------------------------------------------
// onProgress callback
// ---------------------------------------------------------------------------

describe("onProgress callback", () => {
  it("calls onProgress once per chunk with correct metadata", async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeClaudeResponse("[]"));

    const progress: unknown[] = [];
    await extractFromPdf(FAKE_PDF, [], [], (p) => progress.push(p));

    expect(progress).toHaveLength(1);
    const p = progress[0] as {
      chunk: number;
      totalChunks: number;
      startPage: number;
      itemsFound: number;
      totalItemsFound: number;
    };
    expect(p.chunk).toBe(1);
    expect(p.totalChunks).toBe(1);
    expect(p.startPage).toBe(1);
    expect(p.itemsFound).toBe(0);
    expect(p.totalItemsFound).toBe(0);
  });

  it("reports correct itemsFound count when items are extracted", async () => {
    const rawItems = [
      { cat_no: "ED-950", variant: null, mrp: 100, product_name: "x", page: 1 },
      { cat_no: "ED-951", variant: null, mrp: 200, product_name: "y", page: 1 },
    ];
    mockMessagesCreate.mockResolvedValueOnce(
      makeClaudeResponse(JSON.stringify(rawItems)),
    );

    const progress: unknown[] = [];
    await extractFromPdf(FAKE_PDF, [], [], (p) => progress.push(p));

    const p = progress[0] as { itemsFound: number; totalItemsFound: number };
    expect(p.itemsFound).toBe(2);
    expect(p.totalItemsFound).toBe(2);
  });
});
