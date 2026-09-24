import { describe, expect, it } from "vitest";
import { getComparisonEvidence } from "./comparisonEvidenceRegistry";

describe("P045 Step 5 comparison evidence registry", () => {
  const snapshotRows: Array<[string, string]> = [
    ["PMN032404", "5793"],
    ["CM02350W0V", "CM21"],
    ["CM0235010V", "CM31"],
    ["PM0389042V", "5763"],
    ["PM03890403", "5963"],
    ["PM03890404", "5163"],
    ["PM03890402", "4763"],
    ["PPRMB021225MM0V", "PG403"],
    ["PPRMB021720MM0V", "PG412"],
    ["PPRMB021725MM0V", "PG413"],
  ];

  it("flags exactly all ten codes on the development snapshot period", () => {
    const evidence = snapshotRows.map(([apollo, prayag]) =>
      getComparisonEvidence("Apollo", apollo, prayag, "2026-08-01"),
    );
    expect(evidence).toHaveLength(10);
    expect(evidence.every(Boolean)).toBe(true);
    expect(evidence[0]?.kind).toBe("product-identity-dispute");
    expect(evidence.slice(1).every((entry) => entry?.kind === "not-verified")).toBe(true);
  });

  it("does not flag another period or an altered comparison identity", () => {
    expect(getComparisonEvidence("Apollo", "PMN032404", "5793", "2026-03-05")).toBeNull();
    expect(getComparisonEvidence("Apollo", "PMN032404", "5793", "2026-08-02")).toBeNull();
    expect(getComparisonEvidence("Apollo", "PMN032404", "PMN032404", "2026-08-01")).toBeNull();
    expect(getComparisonEvidence("Other competitor", "PMN032404", "5793", "2026-08-01")).toBeNull();
    expect(getComparisonEvidence("Apollo", "NOT-A-LISTED-CODE", "5793", "2026-08-01")).toBeNull();
  });
});