import { describe, expect, it } from "vitest";
import { anomalyReasons } from "./catalogImportExport";

describe("MRP import anomaly review", () => {
  it("flags any MRP below ₹1", () => {
    expect(anomalyReasons(0.5, null, "Accessories")).toContain("MRP is below ₹1");
  });

  it("flags guarded-division MRP below ₹50", () => {
    expect(anomalyReasons(12, null, "PTMT")).toContain("MRP is below ₹50 for PTMT");
    expect(anomalyReasons(12, null, "Accessories")).toEqual([]);
  });

  it("flags sharp period-over-period changes at the documented boundaries", () => {
    expect(anomalyReasons(161, 100, "PTMT").some((reason) => reason.includes("increased"))).toBe(true);
    expect(anomalyReasons(79, 100, "PTMT").some((reason) => reason.includes("decreased"))).toBe(true);
    expect(anomalyReasons(160, 100, "PTMT")).toEqual([]);
    expect(anomalyReasons(80, 100, "PTMT")).toEqual([]);
  });
});