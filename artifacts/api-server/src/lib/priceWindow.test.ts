import { describe, expect, it } from "vitest";
import { priceChangePct, validToFromNextDate } from "./priceWindow.js";

describe("price validity helpers", () => {
  it("ends a current price on the calendar day before the next revision", () => {
    expect(validToFromNextDate("2026-09-01")).toBe("2026-08-31");
    expect(validToFromNextDate("2027-01-01")).toBe("2026-12-31");
  });

  it("keeps an open-ended current period open", () => {
    expect(validToFromNextDate(null)).toBeNull();
  });

  it("returns one-decimal increases and decreases", () => {
    expect(priceChangePct(136, 166)).toBe(22.1);
    expect(priceChangePct(200, 180)).toBe(-10);
  });

  it("retains a real zero for an unchanged scheduled revision", () => {
    expect(priceChangePct(1020, 1020)).toBe(0);
  });
});