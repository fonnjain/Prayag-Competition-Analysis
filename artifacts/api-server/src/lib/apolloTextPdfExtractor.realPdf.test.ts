import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { enrichApolloSizes } from "./apolloTextPdfExtractor.js";
import type { ExtractedItem } from "./pdfExtractor.js";

const printedSizes = [
  ["CMN02032V", 8, "65mm"],
  ["CMN02061U0W", 6, "32x20mm"],
  ["CM02082V", 8, "65mm"],
  ["CMN02260W", 6, "20mm"],
  ["PMNN03432V", 22, "75mm"],
  ["PMN03450604", 21, "160x110mm"],
  ["PMN03142V", 23, "75mm"],
  ["PMN032404", 24, "110mm"],
  ["PMN036404", 22, "110mm"],
  ["PMN036706", 23, "160mm"],
] as const;

describe("Apollo printed PDF size cells", () => {
  it("extracts the ten reviewed sizes from their actual code rows", async () => {
    const pdf = readFileSync(
      resolve(process.cwd(), "../../attached_assets/Apollo_(Aug-2026)_1790252780222.pdf"),
    );
    const items: ExtractedItem[] = printedSizes.map(([cat_no, page]) => ({
      cat_no,
      page,
      variant: null,
      mrp: 0,
      product_name: "",
      discoveryPasses: [],
      adjudicated: false,
    }));
    const result = await enrichApolloSizes(pdf, items);
    expect(result.items.map((item) => item.variant)).toEqual(printedSizes.map(([, , size]) => size));
  });
});