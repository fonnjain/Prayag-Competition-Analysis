import { describe, expect, it } from "vitest";
import type { Product, Competitor, Comparison } from "@workspace/db";
import {
  computeRow,
  computeAllRows,
  visibleCompetitorOrder,
  competitorSummaries,
  type EngineData,
} from "./engine.js";

// These tests lock in the engine's market-status thresholds, the net-vs-MRP
// basis selection, the diff% sign convention (positive = Prayag cheaper), and
// the recommendation/margin-floor math. The status thresholds and basis rules
// are subtle, so a small refactor could silently flip a label without these.

let compId = 0;
function mkComparison(
  partial: Pick<Comparison, "competitor" | "itemCode" | "basis"> &
    Partial<Comparison>,
): Comparison {
  return {
    id: ++compId,
    compMrp: null,
    compPrice: null,
    matchMethod: "code",
    sourceFile: null,
    edited: false,
    ...partial,
  };
}

function mkProduct(partial: Partial<Product> & Pick<Product, "itemCode">): Product {
  return {
    category: "FITTINGS",
    size: null,
    prayagMrp: null,
    prayagNet: null,
    kgCost: null,
    edited: false,
    ...partial,
  };
}

function mkCompetitor(
  partial: Pick<Competitor, "name"> & Partial<Competitor>,
): Competitor {
  return { basis: "net", hidden: false, ...partial };
}

// A net market of {100, 150, 200}: min=100, median=150, max=200.
function netMarket(itemCode: string): Comparison[] {
  return [
    mkComparison({ competitor: "A", itemCode, basis: "net", compPrice: 100 }),
    mkComparison({ competitor: "B", itemCode, basis: "net", compPrice: 150 }),
    mkComparison({ competitor: "C", itemCode, basis: "net", compPrice: 200 }),
  ];
}
const netVisible = ["A", "B", "C"];

describe("status thresholds", () => {
  it("leader when shown price <= market_min", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 100 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.status).toBe("leader");
    expect(row.prayagLowest).toBe(true);
  });

  it("leader when shown price is strictly below market_min", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 80 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.status).toBe("leader");
  });

  it("competitive when above min but <= median", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 150 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.status).toBe("competitive");
    expect(row.prayagLowest).toBe(false);
  });

  it("competitive at a price strictly between min and median", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 130 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.status).toBe("competitive");
  });

  it("above_market when above median but <= max", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 180 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.status).toBe("above_market");
  });

  it("above_market exactly at market_max", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 200 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.status).toBe("above_market");
  });

  it("overpriced when above market_max", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 250 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.status).toBe("overpriced");
  });

  it("no_data when there are no visible competitor prices", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 100 }),
      [],
      netVisible,
      15,
    );
    expect(row.status).toBe("no_data");
    expect(row.rivalCount).toBe(0);
    expect(row.suggestedPrice).toBeNull();
  });

  it("no_data when Prayag has no price on the chosen basis", () => {
    // Net rivals exist, but prayagNet is null and prayagMrp is set -> falls to
    // mrp basis, where no mrp rivals exist -> no market -> no_data.
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: null, prayagMrp: 120 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.status).toBe("no_data");
  });
});

describe("net-vs-MRP basis selection", () => {
  it("prefers net when a net rival exists and prayagNet is present", () => {
    const comps = [
      mkComparison({ competitor: "A", itemCode: "P", basis: "net", compPrice: 90 }),
      mkComparison({ competitor: "B", itemCode: "P", basis: "mrp", compPrice: 200 }),
    ];
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 100, prayagMrp: 220 }),
      comps,
      ["A", "B"],
      15,
    );
    expect(row.basis).toBe("net");
    expect(row.shownPrice).toBe(100);
    // Only the net cell counts toward the market.
    expect(row.rivalCount).toBe(1);
    expect(row.marketMin).toBe(90);
  });

  it("uses mrp when only mrp rivals exist", () => {
    const comps = [
      mkComparison({ competitor: "A", itemCode: "P", basis: "mrp", compPrice: 200 }),
    ];
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 100, prayagMrp: 220 }),
      comps,
      ["A"],
      15,
    );
    expect(row.basis).toBe("mrp");
    expect(row.shownPrice).toBe(220);
  });

  it("falls back to mrp when a net rival exists but prayagNet is missing", () => {
    const comps = [
      mkComparison({ competitor: "A", itemCode: "P", basis: "net", compPrice: 90 }),
      mkComparison({ competitor: "B", itemCode: "P", basis: "mrp", compPrice: 200 }),
    ];
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: null, prayagMrp: 220 }),
      comps,
      ["A", "B"],
      15,
    );
    expect(row.basis).toBe("mrp");
    expect(row.shownPrice).toBe(220);
    expect(row.marketMin).toBe(200);
  });
});

describe("diff% sign convention (positive = Prayag cheaper)", () => {
  it("is positive when a competitor is more expensive than Prayag", () => {
    const comps = [
      mkComparison({ competitor: "A", itemCode: "P", basis: "net", compPrice: 120 }),
    ];
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 100 }),
      comps,
      ["A"],
      15,
    );
    const cell = row.competitors.find((c) => c.competitor === "A");
    expect(cell?.diffPct).toBeCloseTo(0.2, 10);
  });

  it("is negative when a competitor is cheaper than Prayag", () => {
    const comps = [
      mkComparison({ competitor: "A", itemCode: "P", basis: "net", compPrice: 80 }),
    ];
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 100 }),
      comps,
      ["A"],
      15,
    );
    const cell = row.competitors.find((c) => c.competitor === "A");
    expect(cell?.diffPct).toBeCloseTo(-0.2, 10);
  });

  it("compares each cell against the Prayag price of that cell's own basis", () => {
    // A net cell diffs vs prayagNet, an mrp cell diffs vs prayagMrp, even though
    // the row's chosen basis is net.
    const comps = [
      mkComparison({ competitor: "A", itemCode: "P", basis: "net", compPrice: 110 }),
      mkComparison({ competitor: "B", itemCode: "P", basis: "mrp", compPrice: 240 }),
    ];
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 100, prayagMrp: 200 }),
      comps,
      ["A", "B"],
      15,
    );
    expect(row.basis).toBe("net");
    const a = row.competitors.find((c) => c.competitor === "A");
    const b = row.competitors.find((c) => c.competitor === "B");
    expect(a?.diffPct).toBeCloseTo(0.1, 10); // (110-100)/100
    expect(b?.diffPct).toBeCloseTo(0.2, 10); // (240-200)/200
    expect(b?.basis).toBe("mrp");
  });

  it("leaves diff% null for a competitor with no price for the item", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 100 }),
      netMarket("P"),
      [...netVisible, "Z"],
      15,
    );
    const z = row.competitors.find((c) => c.competitor === "Z");
    expect(z?.price).toBeNull();
    expect(z?.diffPct).toBeNull();
  });
});

describe("recommendation math and the margin floor", () => {
  it("suggested = median*0.98 and aggressive = min*0.98 with no cost floor", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 180, kgCost: null }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.suggestedPrice).toBeCloseTo(150 * 0.98, 10);
    expect(row.aggressiveTarget).toBeCloseTo(100 * 0.98, 10);
    expect(row.marginConstrained).toBe(false);
  });

  it("does not flag marginConstrained when the floor is below the suggestion", () => {
    // floor = 50 * 1.15 = 57.5, suggestion = 147 -> floor inactive.
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 180, kgCost: 50 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.suggestedPrice).toBeCloseTo(150 * 0.98, 10);
    expect(row.marginConstrained).toBe(false);
  });

  it("raises the suggestion to the floor and flags marginConstrained", () => {
    // floor = 200 * 1.15 = 230 > median*0.98 (147) -> suggestion floored.
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 180, kgCost: 200 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.suggestedPrice).toBeCloseTo(230, 10);
    expect(row.marginConstrained).toBe(true);
  });

  it("floors the aggressive target without setting marginConstrained", () => {
    // floor = 120 * 1.15 = 138. suggestion = 147 (>= floor, not constrained),
    // aggressive = 98 (< floor) -> aggressive raised to 138.
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 180, kgCost: 120 }),
      netMarket("P"),
      netVisible,
      15,
    );
    expect(row.suggestedPrice).toBeCloseTo(150 * 0.98, 10);
    expect(row.aggressiveTarget).toBeCloseTo(138, 10);
    expect(row.marginConstrained).toBe(false);
  });

  it("respects a custom minimum margin percentage", () => {
    // minMargin 50% -> floor = 100 * 1.5 = 150 > median*0.98 (147).
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 180, kgCost: 100 }),
      netMarket("P"),
      netVisible,
      50,
    );
    expect(row.suggestedPrice).toBeCloseTo(150, 10);
    expect(row.marginConstrained).toBe(true);
  });

  it("computes gap and gapPct from the shown price", () => {
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 180, kgCost: null }),
      netMarket("P"),
      netVisible,
      15,
    );
    const expectedSuggested = 150 * 0.98;
    expect(row.gap).toBeCloseTo(expectedSuggested - 180, 10);
    expect(row.gapPct).toBeCloseTo((expectedSuggested - 180) / 180, 10);
  });
});

describe("median aggregation across multiple rows from one competitor", () => {
  it("uses the median of a competitor's prices for the item", () => {
    const comps = [
      mkComparison({ competitor: "A", itemCode: "P", basis: "net", compPrice: 100 }),
      mkComparison({ competitor: "A", itemCode: "P", basis: "net", compPrice: 140 }),
    ];
    const row = computeRow(
      mkProduct({ itemCode: "P", prayagNet: 90 }),
      comps,
      ["A"],
      15,
    );
    const a = row.competitors.find((c) => c.competitor === "A");
    expect(a?.price).toBe(120); // median(100,140)
    expect(row.rivalCount).toBe(1);
  });
});

describe("computeAllRows + visibleCompetitorOrder", () => {
  function data(): EngineData {
    return {
      products: [
        mkProduct({ itemCode: "P2", prayagNet: 100 }),
        mkProduct({ itemCode: "P1", prayagNet: 100 }),
      ],
      competitors: [
        mkCompetitor({ name: "Few" }),
        mkCompetitor({ name: "Many" }),
        mkCompetitor({ name: "Hidden", hidden: true }),
      ],
      comparisons: [
        mkComparison({ competitor: "Many", itemCode: "P1", basis: "net", compPrice: 100 }),
        mkComparison({ competitor: "Many", itemCode: "P2", basis: "net", compPrice: 100 }),
        mkComparison({ competitor: "Few", itemCode: "P1", basis: "net", compPrice: 100 }),
        mkComparison({ competitor: "Hidden", itemCode: "P1", basis: "net", compPrice: 100 }),
      ],
      minimumMarginPct: 15,
    };
  }

  it("orders visible competitors by coverage and excludes hidden ones", () => {
    expect(visibleCompetitorOrder(data())).toEqual(["Many", "Few"]);
  });

  it("returns rows sorted by item code", () => {
    const { rows, visibleCompetitors } = computeAllRows(data());
    expect(rows.map((r) => r.itemCode)).toEqual(["P1", "P2"]);
    expect(visibleCompetitors).toEqual(["Many", "Few"]);
  });
});

describe("competitorSummaries", () => {
  it("counts how often Prayag is cheaper and averages the saving", () => {
    const d: EngineData = {
      products: [
        mkProduct({ itemCode: "P1", prayagNet: 100 }),
        mkProduct({ itemCode: "P2", prayagNet: 100 }),
      ],
      competitors: [mkCompetitor({ name: "A" })],
      comparisons: [
        // Prayag cheaper here: comp 120 vs prayag 100 -> +0.2
        mkComparison({ competitor: "A", itemCode: "P1", basis: "net", compPrice: 120 }),
        // Prayag dearer here: comp 80 vs prayag 100 -> -0.2
        mkComparison({ competitor: "A", itemCode: "P2", basis: "net", compPrice: 80 }),
      ],
      minimumMarginPct: 15,
    };
    const [a] = competitorSummaries(d);
    expect(a?.productsCompared).toBe(2);
    expect(a?.prayagCheaper).toBe(1);
    expect(a?.prayagCheaperPct).toBeCloseTo(0.5, 10);
    expect(a?.avgSavingPct).toBeCloseTo(0, 10); // (0.2 + -0.2)/2
  });

  it("includes hidden competitors in the summary", () => {
    const d: EngineData = {
      products: [mkProduct({ itemCode: "P1", prayagNet: 100 })],
      competitors: [mkCompetitor({ name: "H", hidden: true })],
      comparisons: [
        mkComparison({ competitor: "H", itemCode: "P1", basis: "net", compPrice: 120 }),
      ],
      minimumMarginPct: 15,
    };
    const [h] = competitorSummaries(d);
    expect(h?.hidden).toBe(true);
    expect(h?.productsCompared).toBe(1);
  });
});
