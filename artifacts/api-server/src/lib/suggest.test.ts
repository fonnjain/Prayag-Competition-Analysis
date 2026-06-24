import { describe, expect, it } from "vitest";
import {
  buildCandidate,
  parseSizeFromName,
  suggestMatches,
  type CatalogCandidate,
} from "./suggest.js";

// These tests lock in the intended ranking behavior of the heuristic suggestion
// engine so a future weighting tweak can't silently degrade match quality (e.g.
// a wrong-type "pipe" outranking a right-type "coupler").

describe("parseSizeFromName", () => {
  it("pulls a plain mm dimension from the product name", () => {
    expect(parseSizeFromName("COUPLER 75 mm - 2.5 KG")).toBe("75 mm");
  });

  it("pulls the last mm group when several appear", () => {
    expect(parseSizeFromName("ELBOW 1/2 inch 15 mm")).toBe("15 mm");
  });

  it("canonicalizes reducer (a x b) dimensions", () => {
    expect(parseSizeFromName("REDUCER 20 x 15 mm")).toBe("20x15 mm");
    expect(parseSizeFromName("REDUCER 20×15 mm")).toBe("20x15 mm");
  });

  it("handles a mm dimension with no space before the unit", () => {
    expect(parseSizeFromName("PIPE 110mm")).toBe("110 mm");
  });

  it("returns null when the name carries no mm dimension", () => {
    expect(parseSizeFromName("BIB COCK TAP LONG BODY")).toBeNull();
    expect(parseSizeFromName(null)).toBeNull();
    expect(parseSizeFromName("")).toBeNull();
  });
});

// normSize is not exported; exercise it through the documented invariant that a
// catalog "<n> mm" and a competitor bare "<n>" collapse to the same normalized
// token (so an exact size match scores). We assert that via suggestMatches: a
// competitor row with size "20" gets an exact-size boost on a catalog "20 mm".
describe("normSize equivalence (catalog mm vs competitor bare number)", () => {
  it("treats catalog '20 mm' and competitor '20' as the same size", () => {
    const candidates = [
      buildCandidate({
        itemCode: "C20",
        productName: "PVC COUPLER 20 mm",
        category: "FITTINGS",
        division: "CPVC",
        size: null,
        currentMrp: 10,
      }),
      buildCandidate({
        itemCode: "C200",
        productName: "PVC COUPLER 200 mm",
        category: "FITTINGS",
        division: "CPVC",
        size: null,
        currentMrp: 10,
      }),
    ];
    const out = suggestMatches(
      { category: "FITTINGS", description: "COUPLER", size: "20" },
      candidates,
    );
    // The 20 mm coupler must win — proves "20" normalized equal to "20 mm" and
    // that the substring trap ("200" contains "20") does not fire.
    expect(out[0]?.itemCode).toBe("C20");
    expect(out[0]!.confidence).toBeGreaterThan(out[1]!.confidence);
  });

  it("matches unicode-fraction and quote variants of an inch size", () => {
    const candidates = [
      buildCandidate({
        itemCode: "H34",
        productName: 'BALL VALVE 3/4"',
        category: "VALVES",
        division: "CPVC",
        size: null,
        currentMrp: 10,
      }),
      buildCandidate({
        itemCode: "H12",
        productName: 'BALL VALVE 1/2"',
        category: "VALVES",
        division: "CPVC",
        size: null,
        currentMrp: 10,
      }),
    ];
    const out = suggestMatches(
      { category: "VALVES", description: "BALL VALVE", size: "3\u20444" },
      candidates,
    );
    expect(out[0]?.itemCode).toBe("H34");
  });
});

// Helper: build a small catalog covering the product types we care about.
function catalog(): CatalogCandidate[] {
  return [
    buildCandidate({
      itemCode: "CPVC-COUPLER-20",
      productName: "CPVC COUPLER 20 mm",
      category: "FITTINGS",
      division: "CPVC",
      size: null,
      currentMrp: 12,
    }),
    buildCandidate({
      itemCode: "CPVC-PIPE-20",
      productName: "CPVC PIPE 20 mm",
      category: "PIPES",
      division: "CPVC",
      size: null,
      currentMrp: 30,
    }),
    buildCandidate({
      itemCode: "CPVC-ELBOW-20",
      productName: "CPVC ELBOW 20 mm",
      category: "FITTINGS",
      division: "CPVC",
      size: null,
      currentMrp: 8,
    }),
    buildCandidate({
      itemCode: "CPVC-TEE-20",
      productName: "CPVC TEE 20 mm",
      category: "FITTINGS",
      division: "CPVC",
      size: null,
      currentMrp: 9,
    }),
    buildCandidate({
      itemCode: "AGRI-ELBOW-90",
      productName: "AGRI ELBOW 90 mm",
      category: "FITTINGS",
      division: "AGRI",
      size: null,
      currentMrp: 18,
    }),
    buildCandidate({
      itemCode: "AGRI-TEE-90",
      productName: "AGRI TEE 90 mm",
      category: "FITTINGS",
      division: "AGRI",
      size: null,
      currentMrp: 20,
    }),
    buildCandidate({
      itemCode: "AGRI-COUPLER-90",
      productName: "AGRI COUPLER 90 mm",
      category: "FITTINGS",
      division: "AGRI",
      size: null,
      currentMrp: 15,
    }),
  ];
}

describe("ranking: product type wins over size", () => {
  it("a right-type/wrong-size coupler outranks a wrong-type/right-size pipe", () => {
    // Competitor wants a 25 mm coupler. The catalog has a 20 mm coupler (right
    // type, wrong size) and a 25 mm pipe (wrong type, right size). The coupler
    // must win — this is the exact regression the engine guards against.
    const candidates = [
      buildCandidate({
        itemCode: "COUPLER-20",
        productName: "CPVC COUPLER 20 mm",
        category: "FITTINGS",
        division: "CPVC",
        size: null,
        currentMrp: 12,
      }),
      buildCandidate({
        itemCode: "PIPE-25",
        productName: "CPVC PIPE 25 mm",
        category: "PIPES",
        division: "CPVC",
        size: null,
        currentMrp: 30,
      }),
    ];
    const out = suggestMatches(
      { category: "FITTINGS", description: "COUPLER", size: "25" },
      candidates,
    );
    expect(out[0]?.itemCode).toBe("COUPLER-20");
  });
});

describe("ranking: same product type wins (CPVC/AGRI)", () => {
  const cases: { division: string; type: string; size: string; expected: string }[] = [
    { division: "CPVC", type: "ELBOW", size: "20", expected: "CPVC-ELBOW-20" },
    { division: "CPVC", type: "TEE", size: "20", expected: "CPVC-TEE-20" },
    { division: "CPVC", type: "COUPLER", size: "20", expected: "CPVC-COUPLER-20" },
    { division: "AGRI", type: "ELBOW", size: "90", expected: "AGRI-ELBOW-90" },
    { division: "AGRI", type: "TEE", size: "90", expected: "AGRI-TEE-90" },
    { division: "AGRI", type: "COUPLER", size: "90", expected: "AGRI-COUPLER-90" },
  ];

  for (const { division, type, size, expected } of cases) {
    it(`${division} ${type} -> ${expected}`, () => {
      const out = suggestMatches(
        { category: "FITTINGS", description: `${division} ${type}`, size },
        catalog(),
      );
      expect(out[0]?.itemCode).toBe(expected);
    });
  }
});
