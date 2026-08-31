import { describe, expect, it } from "vitest";
import {
  HARDWARE_REPLACEMENT_SNAPSHOT,
  OFFICIAL_MRP_SOURCES,
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

  it("identifies the verified September Hardware replacement exactly", () => {
    const hardware = OFFICIAL_MRP_SOURCES.find(
      (source) => source.division === "Hardware",
    );

    expect(hardware?.expectedFileName).toBe(
      HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
    );
    expect(HARDWARE_REPLACEMENT_SNAPSHOT).toMatchObject({
      fileSha256:
        "a6cd9c4d82ab60a1b77644edba5446af90bf9df25174095e791b6c23f773cab2",
      fileSizeBytes: 379_091,
      downloadedAt: "2026-08-31",
      effectiveDate: "2026-09-01",
      expectedRows: 285,
      expectedRevisions: 277,
      expectedAdditions: 8,
    });
  });
});