import { describe, expect, it, vi } from "vitest";
import { enrichApolloSizes } from "./apolloTextPdfExtractor.js";
import { extractPdfJsPages } from "./pdfJsText.js";

vi.mock("./pdfJsText.js", () => ({ extractPdfJsPages: vi.fn() }));

const word = (text: string, xMin: number, yMin = 10): any => ({
  text, xMin, xMax: xMin + text.length * 5, yMin, yMax: yMin + 8,
});

describe("Apollo positional size extraction", () => {
  it("reads the size cell immediately before each code", async () => {
    const pdf = Buffer.from("not used");
    const item = {
      cat_no: "PMN032404", variant: null, mrp: 187.5, product_name: "Trap",
      page: 1, discoveryPasses: [1], adjudicated: false,
    };
    vi.mocked(extractPdfJsPages).mockResolvedValue({
      totalPages: 1, pages: [{ page: 1, text: "", words: [word("110", 10), word("PMN032404", 30), word("36", 90)] }],
    });
    const result = await enrichApolloSizes(pdf, [item]);
    expect(result.items[0]?.variant).toBe("110mm");
  });

  it("repairs blanks only and records the original without replacing populated variants", async () => {
    vi.mocked(extractPdfJsPages).mockResolvedValue({
      totalPages: 1, pages: [{ page: 1, text: "", words: [word("110", 10), word("PMN032404", 30), word("36", 90)] }],
    });
    const item = {
      cat_no: "PMN032404", variant: "legacy-size", mrp: 187.5, product_name: "Trap",
      page: 1, discoveryPasses: [1], adjudicated: false,
    };
    const result = await enrichApolloSizes(Buffer.from("not used"), [item]);
    expect(result.items[0]?.variant).toBe("legacy-size");
    expect(result.evidence[0]).toMatchObject({
      existingSize: "legacy-size",
      size: "110mm",
    });
  });

  it("does not borrow a same-code size from a different page", async () => {
    vi.mocked(extractPdfJsPages).mockResolvedValue({
      totalPages: 2,
      pages: [
        { page: 1, text: "", words: [word("110", 10), word("PMN032404", 30)] },
        { page: 2, text: "", words: [] },
      ],
    });
    const item = {
      cat_no: "PMN032404", variant: null, mrp: 187.5, product_name: "Trap",
      page: 2, discoveryPasses: [2], adjudicated: false,
    };
    expect((await enrichApolloSizes(Buffer.from("not used"), [item])).items[0]?.variant).toBeNull();
  });
});