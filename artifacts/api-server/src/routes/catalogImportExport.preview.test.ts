import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAuthoritativeMasterBuffer } from "../lib/authoritativeMrpMaster";
import { pendingAuthoritativePreview } from "./catalogImportExport";

const v1 = parseAuthoritativeMasterBuffer(
  readFileSync(
    new URL(
      "../../../../attached_assets/Prayag_MRP_Authoritative_01Sep2026_1788147614421.xlsx",
      import.meta.url,
    ),
  ),
);
const v2 = parseAuthoritativeMasterBuffer(
  readFileSync(
    new URL(
      "../../../../attached_assets/Prayag_MRP_Authoritative_v2_01Sep2026_1788783858192.xlsx",
      import.meta.url,
    ),
  ),
);

describe("MRP pending preview", () => {
  it("replays the known batch 17 decision summary without writing", () => {
    const discontinuedByCode = new Map(
      v1.discontinuedRows.map((row) => [row.itemCode, row.discontinuedFrom]),
    );
    const preview = pendingAuthoritativePreview(
      v2,
      v1.productRows.map((row) => ({
        itemCode: row.itemCode,
        productName: row.productName,
        discontinuedFrom: discontinuedByCode.get(row.itemCode) ?? null,
      })),
      v1.priceRows.map((row) => ({
        itemCode: row.itemCode,
        effectiveDate: row.effectiveDate,
        mrp: row.mrp,
        variant: row.variant,
      })),
    );

    expect(preview.productRows).toBe(6_106);
    expect(preview.priceRows).toBe(6_256);
    expect(preview.periods).toEqual([
      { effectiveDate: "2026-09-01", rowCount: 2_409, isNew: false, movedInCount: 0 },
      { effectiveDate: "2026-08-10", rowCount: 580, isNew: false, movedInCount: 495 },
      { effectiveDate: "2026-08-01", rowCount: 865, isNew: false, movedInCount: 0 },
      { effectiveDate: "2026-05-01", rowCount: 475, isNew: false, movedInCount: 0 },
      { effectiveDate: "2026-02-01", rowCount: 1_616, isNew: false, movedInCount: 0 },
      { effectiveDate: "2024-02-15", rowCount: 161, isNew: false, movedInCount: 0 },
    ]);
    expect(preview.newProducts).toHaveLength(30);
    expect(preview.immediatePriceChangeCount).toBe(392);
    expect(preview.existingPeriodPriceRevisionCount).toBe(3);
    expect(preview.protectedNameConflicts).toHaveLength(11);
  });
});