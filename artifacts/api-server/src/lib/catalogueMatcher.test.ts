import { describe, expect, it } from "vitest";
import {
  matchCatalogue,
  normCode,
  type CodeAlias,
  type ExtractedItem,
  type MatchTarget,
} from "./catalogueMatcher.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTarget(overrides: Partial<MatchTarget> = {}): MatchTarget {
  return {
    competitorCode: "WMP-188",
    matchedPrayagCode: "PRY-100",
    description: "Bib Cock 15mm",
    size: "15mm",
    existingPrice: 100,
    prayagMrpCurrent: 90,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    cat_no: "WMP-188",
    product_name: "Bib Cock 15mm",
    mrp: 110,
    variant: "15mm",
    page: 1,
    ...overrides,
  };
}

// Convenience: run the matcher with a single target and single item.
function matchOne(
  target: Partial<MatchTarget>,
  item: Partial<ExtractedItem>,
  aliases: CodeAlias[] = [],
  priceBasis = "MRP",
  gstPct: number | null = null,
) {
  const { staging, newProducts } = matchCatalogue(
    "Sparsh Pearl",
    [makeTarget(target)],
    [makeItem(item)],
    aliases,
    priceBasis,
    gstPct,
  );
  return { row: staging[0]!, newProducts };
}

// ---------------------------------------------------------------------------
// normCode
// ---------------------------------------------------------------------------

describe("normCode", () => {
  it("uppercases and strips spaces", () => {
    expect(normCode("wmp 188")).toBe("WMP188");
  });

  it("strips hyphens, dots, and underscores", () => {
    expect(normCode("WMP-188")).toBe("WMP188");
    expect(normCode("WMP.188")).toBe("WMP188");
    expect(normCode("WMP_188")).toBe("WMP188");
  });

  it("strips parenthesised suffixes", () => {
    expect(normCode("WMP-188(A)")).toBe("WMP188");
  });

  it("handles null / undefined gracefully", () => {
    expect(normCode(null)).toBe("");
    expect(normCode(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Exact code match → ok
// ---------------------------------------------------------------------------

describe("exact code match", () => {
  it("returns status 'ok' when codes match after normalisation", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-188" },
      { cat_no: "WMP-188" },
    );
    expect(row.status).toBe("ok");
    expect(row.matchMethod).toBe("code+desc");
    expect(row.reviewReason).toBeNull();
  });

  it("tolerates case and spacing differences in the code", () => {
    const { row } = matchOne(
      { competitorCode: "wmp 188" },
      { cat_no: "WMP-188" },
    );
    expect(row.status).toBe("ok");
  });

  it("keeps RPS-2285 as a direct Sink Mixer match", () => {
    const { row } = matchOne(
      { competitorCode: "RPS-2285", description: "Sink Mixer" },
      { cat_no: "RPS-2285", product_name: "Sink Mixer", mrp: 1388 },
    );
    expect(row.status).toBe("ok");
    expect(row.matchMethod).toBe("code+desc");
    expect(row.competitorCodeCatalogue).toBe("RPS-2285");
    expect(row.newMrp).toBe(1388);
    expect(row.reviewReason).toBeNull();
  });

  it("records the catalogue code on the staging row", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-188" },
      { cat_no: "WMP-188" },
    );
    expect(row.competitorCodeCatalogue).toBe("WMP-188");
    expect(row.competitorCodeMaster).toBe("WMP-188");
  });

  it("carries newMrp from the extracted item", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-188", existingPrice: 100 },
      { cat_no: "WMP-188", mrp: 120 },
    );
    expect(row.newMrp).toBe(120);
    expect(row.oldMrp).toBe(100);
    expect(row.increasePct).toBeCloseTo(20, 1);
  });

  it("computes gapPct relative to Prayag MRP (inclusive basis)", () => {
    // compPrice = 120 (MRP basis), prayag = 90 → gap = (120-90)/90 * 100 ≈ 33.3 %
    const { row } = matchOne(
      { competitorCode: "WMP-188", prayagMrpCurrent: 90 },
      { cat_no: "WMP-188", mrp: 120 },
    );
    expect(row.gapPct).toBeCloseTo(33.33, 1);
  });

  it("inflates ex-GST price before computing gap", () => {
    // compPrice = 100 × 1.18 = 118, prayag = 90 → gap ≈ 31.1 %
    const { row } = matchOne(
      { competitorCode: "WMP-188", prayagMrpCurrent: 90 },
      { cat_no: "WMP-188", mrp: 100 },
      [],
      "Ex-GST",
      18,
    );
    expect(row.gapPct).toBeCloseTo(((100 * 1.18 - 90) / 90) * 100, 1);
  });
});

// ---------------------------------------------------------------------------
// Alias-based match → needs_review
// ---------------------------------------------------------------------------

describe("alias-based match (code renumbering)", () => {
  const alias: CodeAlias = { oldCode: "WMP-188", newCode: "WMP-189" };

  it("finds the item under the new alias code", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-188" },
      { cat_no: "WMP-189" },
      [alias],
    );
    // Must be found — not not_found
    expect(row.status).toBe("needs_review");
  });

  it("sets reviewReason containing both old and new codes", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-188" },
      { cat_no: "WMP-189" },
      [alias],
    );
    expect(row.reviewReason).toMatch(/WMP-188/);
    expect(row.reviewReason).toMatch(/WMP-189/);
  });

  it("does not find anything when the alias maps to a code absent from the catalogue", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-188" },
      { cat_no: "WMP-188" }, // catalogue has old code, not the aliased new code
      [alias],
    );
    // Alias redirects lookup to WMP189; catalogue only has WMP188 → not_found
    expect(row.status).toBe("not_found");
  });

  it("records the catalogue (new) code on the row", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-188" },
      { cat_no: "WMP-189" },
      [alias],
    );
    expect(row.competitorCodeMaster).toBe("WMP-188");
    expect(row.competitorCodeCatalogue).toBe("WMP-189");
  });
});

// ---------------------------------------------------------------------------
// Size conflict → needs_review
// ---------------------------------------------------------------------------

describe("size conflict gate", () => {
  it("flags needs_review when target size and catalogue variant disagree", () => {
    const { row } = matchOne(
      {
        competitorCode: "WMP-188",
        description: "Bib Cock 2 Mtr",
        size: "2 Mtr",
      },
      {
        cat_no: "WMP-188",
        product_name: "Bib Cock 3 Mtr",
        variant: "3 Mtr",
      },
    );
    expect(row.status).toBe("needs_review");
    expect(row.reviewReason).toMatch(/[Ss]ize conflict/);
  });

  it("does NOT flag a conflict when both sides share at least one size token", () => {
    const { row } = matchOne(
      {
        competitorCode: "WMP-188",
        description: "Bib Cock 15mm",
        size: "15mm",
      },
      {
        cat_no: "WMP-188",
        product_name: "Bib Cock 15mm",
        variant: "15mm",
      },
    );
    expect(row.status).toBe("ok");
  });

  it("does not flag a conflict when the target has no size info", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-188", description: "Bib Cock", size: null },
      { cat_no: "WMP-188", product_name: "Bib Cock 15mm", variant: "15mm" },
    );
    // Size gate should not fire when one side has no size → 'ok'
    expect(row.status).toBe("ok");
  });

  it("does not flag a conflict when the catalogue item has no variant/size", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-188", description: "Bib Cock 15mm", size: "15mm" },
      { cat_no: "WMP-188", product_name: "Bib Cock", variant: null },
    );
    expect(row.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Unmatched code → not_found
// ---------------------------------------------------------------------------

describe("unmatched code", () => {
  it("returns not_found when no catalogue item has a matching code", () => {
    const { row } = matchOne(
      { competitorCode: "WMP-999" },
      { cat_no: "WMP-188" }, // different code in catalogue
    );
    expect(row.status).toBe("not_found");
    expect(row.newMrp).toBeNull();
  });

  it("returns not_found when the target has no competitor code at all", () => {
    const { row } = matchOne({ competitorCode: null }, { cat_no: "WMP-188" });
    expect(row.status).toBe("not_found");
    expect(row.reviewReason).toMatch(/No competitor code/i);
  });
});

// ---------------------------------------------------------------------------
// Description mismatch (soft flag)
// ---------------------------------------------------------------------------

describe("description mismatch", () => {
  it("flags needs_review when code matches but descriptions share no words", () => {
    const { row } = matchOne(
      {
        competitorCode: "WMP-188",
        description: "Ball Valve",
        size: null,
      },
      {
        cat_no: "WMP-188",
        product_name: "Bib Cock Fancy",
        variant: null,
      },
    );
    expect(row.status).toBe("needs_review");
    expect(row.reviewReason).toMatch(/[Dd]escription mismatch/);
  });

  it("does not flag when descriptions share enough words", () => {
    const { row } = matchOne(
      {
        competitorCode: "WMP-188",
        description: "Bib Cock 15mm standard",
        size: null,
      },
      {
        cat_no: "WMP-188",
        product_name: "Bib Cock 15mm",
        variant: null,
      },
    );
    expect(row.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// New product detection
// ---------------------------------------------------------------------------

describe("new product detection", () => {
  it("marks extracted items that were not claimed by any target as new products", () => {
    const { staging, newProducts } = matchCatalogue(
      "Sparsh Pearl",
      [makeTarget({ competitorCode: "WMP-188" })],
      [
        makeItem({ cat_no: "WMP-188", mrp: 110 }),
        makeItem({ cat_no: "WMP-999", product_name: "Brand New Widget", mrp: 50 }),
      ],
      [],
      "MRP",
      null,
    );

    expect(staging).toHaveLength(1);
    expect(newProducts).toHaveLength(1);
    expect(newProducts[0]!.cat_no).toBe("WMP-999");
  });

  it("returns empty newProducts when all extracted items are claimed", () => {
    const { newProducts } = matchCatalogue(
      "Sparsh Pearl",
      [makeTarget({ competitorCode: "WMP-188" })],
      [makeItem({ cat_no: "WMP-188" })],
      [],
      "MRP",
      null,
    );
    expect(newProducts).toHaveLength(0);
  });

  it("returns all items as newProducts when targets list is empty", () => {
    const { staging, newProducts } = matchCatalogue(
      "Sparsh Pearl",
      [],
      [makeItem({ cat_no: "WMP-188" }), makeItem({ cat_no: "WMP-189" })],
      [],
      "MRP",
      null,
    );
    expect(staging).toHaveLength(0);
    expect(newProducts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Multiple targets / duplicate codes
// ---------------------------------------------------------------------------

describe("multiple targets", () => {
  it("processes all targets and returns a row for each", () => {
    const { staging } = matchCatalogue(
      "Sparsh Pearl",
      [
        makeTarget({ competitorCode: "WMP-101", matchedPrayagCode: "PRY-1" }),
        makeTarget({ competitorCode: "WMP-102", matchedPrayagCode: "PRY-2" }),
        makeTarget({ competitorCode: "WMP-999", matchedPrayagCode: "PRY-3" }),
      ],
      [
        makeItem({ cat_no: "WMP-101" }),
        makeItem({ cat_no: "WMP-102" }),
      ],
      [],
      "MRP",
      null,
    );
    expect(staging).toHaveLength(3);
    expect(staging[0]!.status).toBe("ok");
    expect(staging[1]!.status).toBe("ok");
    expect(staging[2]!.status).toBe("not_found");
  });

  it("claims each extracted item at most once per target", () => {
    // Two targets map to the same catalogue code. The second is deliberately
    // held for review: approving both would apply one extracted price to two
    // master rows without reviewer confirmation.
    const sharedItem = makeItem({ cat_no: "WMP-188" });
    const { staging } = matchCatalogue(
      "Sparsh Pearl",
      [
        makeTarget({ competitorCode: "WMP-188", matchedPrayagCode: "PRY-1" }),
        makeTarget({ competitorCode: "WMP-188", matchedPrayagCode: "PRY-2" }),
      ],
      [sharedItem],
      [],
      "MRP",
      null,
    );
    // The one-catalogue-item-per-target rule is intentional.
    expect(staging[0]!.status).toBe("ok");
    expect(staging[1]!.status).toBe("needs_review");
  });
});
