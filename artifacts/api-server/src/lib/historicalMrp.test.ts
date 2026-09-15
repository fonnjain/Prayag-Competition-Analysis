import { describe, expect, it } from "vitest";
import { addMonths, evaluateHistoricalMrp, type HistoricalPriceRow, type HistoricalProduct } from "./historicalMrp";

const products: HistoricalProduct[] = Array.from({ length: 5 }, (_, index) => ({
  itemCode: `H-${index}`,
  productName: `Helix ${index}`,
  seriesRange: "Helix",
  currentMrp: 1000,
}));

const rows: HistoricalPriceRow[] = products.flatMap((product, index) => [
  { id: index * 10 + 1, itemCode: product.itemCode, mrp: 858.25, effectiveDate: "2025-09-01", reviewStatus: "approved", variant: "Standard" },
  { id: index * 10 + 2, itemCode: product.itemCode, mrp: 926.45, effectiveDate: "2026-03-01", reviewStatus: "approved", variant: "Standard" },
  // A decrease is evidence but not a positive revision event.
  { id: index * 10 + 3, itemCode: product.itemCode, mrp: 900, effectiveDate: "2026-06-01", reviewStatus: "approved", variant: "Standard" },
  // The latest positive event is the house-rate sample (900 -> 971.46 = 7.94%).
  { id: index * 10 + 4, itemCode: product.itemCode, mrp: 971.46, effectiveDate: "2026-09-01", reviewStatus: "approved", variant: "Standard" },
]);

describe("P014 historical series engine", () => {
  it("uses one series rate, marks a recent revision not due, and never fits products", () => {
    const result = evaluateHistoricalMrp(products, rows, "2026-09-01");
    expect(result.series[0]).toEqual(expect.objectContaining({
      series: "Helix",
      revisionCount: 2,
      revisionDates: ["2026-03-01", "2026-09-01"],
      confidence: "MODERATE",
      usable: true,
      status: "NOT_DUE",
      monthsSinceLast: 0,
      typicalRate: expect.closeTo(7.94, 0.001),
      p10Rate: expect.closeTo(7.94, 0.001),
      p90Rate: expect.closeTo(7.94, 0.001),
    }));
    expect(result.products.every((product) =>
      product.suggestedMrp === null && product.reason.includes("Not due"),
    )).toBe(true);
  });

  it("suggests the series rate once due", () => {
    const result = evaluateHistoricalMrp(products, rows, "2027-03-01");
    expect(result.summary.suggested).toBe(5);
    expect(result.products.every((product) => product.suggestedMrp === 1079)).toBe(true);
  });

  it("refuses an inconsistent reset pattern and states why", () => {
    const resetProducts = products.map((product, index) => ({ ...product, itemCode: `S-${index}`, seriesRange: "SET" }));
    const resetRows = resetProducts.flatMap((product, index) => [
      { id: index * 10 + 100, itemCode: product.itemCode, mrp: 100, effectiveDate: "2026-03-01", reviewStatus: "approved", variant: "Standard" },
      { id: index * 10 + 101, itemCode: product.itemCode, mrp: [107, 200, 300, 500, 700][index], effectiveDate: "2026-09-01", reviewStatus: "approved", variant: "Standard" },
    ]);
    const result = evaluateHistoricalMrp(resetProducts, resetRows, "2027-03-01");
    expect(result.series[0]).toEqual(expect.objectContaining({ confidence: "NONE", usable: false }));
    expect(result.products.every((product) =>
      product.suggestedMrp === null && product.reason.toLowerCase().includes("not usable"),
    )).toBe(true);
  });

  it("evaluates a product that skipped the latest series event from its own revision date", () => {
    const skippedProducts: HistoricalProduct[] = Array.from({ length: 6 }, (_, index) => ({
      itemCode: `SKIP-${index}`, seriesRange: "Skipped series", currentMrp: 1000,
    }));
    const skippedRows: HistoricalPriceRow[] = skippedProducts.flatMap((product, index) => [
      { id: index * 10 + 1, itemCode: product.itemCode, mrp: 858.25, effectiveDate: "2025-03-01", reviewStatus: "approved", variant: "Standard" },
      { id: index * 10 + 2, itemCode: product.itemCode, mrp: 926.45, effectiveDate: "2025-09-01", reviewStatus: "approved", variant: "Standard" },
      ...(index < 5 ? [{ id: index * 10 + 3, itemCode: product.itemCode, mrp: 1000, effectiveDate: "2026-03-01", reviewStatus: "approved", variant: "Standard" }] : []),
    ]);
    const result = evaluateHistoricalMrp(skippedProducts, skippedRows, "2026-06-01");
    expect(result.series[0]).toEqual(expect.objectContaining({
      revisionDates: ["2025-09-01", "2026-03-01"],
      revisionCount: 2, usable: true, status: "NOT_DUE",
    }));
    expect(result.products.slice(0, 5).every((product) => product.suggestedMrp === null && !product.due)).toBe(true);
    expect(result.products[5]).toEqual(expect.objectContaining({
      suggestedMrp: 1079, due: true, overdue: true,
      evidence: expect.objectContaining({
        product: expect.objectContaining({
          lastRevisionDate: "2025-09-01", nextExpectedDate: "2026-03-01", due: true,
        }),
      }),
    }));
  });

  it("resets product due evidence after a later non-zero decrease", () => {
    const products: HistoricalProduct[] = Array.from({ length: 6 }, (_, index) => ({
      itemCode: `RESET-${index}`, seriesRange: "Reset series",
    }));
    const rows: HistoricalPriceRow[] = products.flatMap((product, index) => [
      { id: index * 10 + 1, itemCode: product.itemCode, mrp: 858.25, effectiveDate: "2025-03-01", reviewStatus: "approved", variant: "Standard" },
      { id: index * 10 + 2, itemCode: product.itemCode, mrp: 926.45, effectiveDate: "2025-09-01", reviewStatus: "approved", variant: "Standard" },
      ...(index < 5
        ? [{ id: index * 10 + 3, itemCode: product.itemCode, mrp: 1000, effectiveDate: "2026-03-01", reviewStatus: "approved", variant: "Standard" }]
        : [{ id: index * 10 + 3, itemCode: product.itemCode, mrp: 800, effectiveDate: "2026-04-01", reviewStatus: "approved", variant: "Standard" }]),
    ]);
    const result = evaluateHistoricalMrp(products, rows, "2026-06-01");
    expect(result.series[0]).toEqual(expect.objectContaining({
      revisionDates: ["2025-09-01", "2026-03-01"],
      usable: true,
    }));
    expect(result.products[5]).toEqual(expect.objectContaining({
      currentMrp: 800, due: false, overdue: false, suggestedMrp: null,
      evidence: expect.objectContaining({
        product: expect.objectContaining({
          lastRevisionDate: "2026-04-01",
          nextExpectedDate: "2026-10-01",
          due: false,
        }),
      }),
    }));
  });

  it("clamps calendar-month additions to the target month end", () => {
    expect(addMonths("2019-08-31", 6)).toBe("2020-02-29");
    expect(addMonths("2020-08-31", 6)).toBe("2021-02-28");
  });
});