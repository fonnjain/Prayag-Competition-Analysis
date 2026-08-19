import { describe, expect, it } from "vitest";
import {
  isIsoDate,
  sha256ForBuffer,
  sourceUrl,
} from "./mrpProvenance.js";

describe("MRP source provenance", () => {
  it("uses byte-for-byte SHA-256 identity instead of a filename", () => {
    const original = Buffer.from("Item Code,MRP\nP-1,100\n");
    const changed = Buffer.from("Item Code,MRP\nP-1,101\n");

    expect(sha256ForBuffer(original)).toBe(sha256ForBuffer(original));
    expect(sha256ForBuffer(original)).not.toBe(sha256ForBuffer(changed));
  });

  it("accepts only an explicitly supplied ISO download date", () => {
    expect(isIsoDate("2026-08-19")).toBe(true);
    expect(isIsoDate("19/08/2026")).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(sourceUrl("sheet-id")).toBe(
      "https://docs.google.com/spreadsheets/d/sheet-id/edit",
    );
  });
});