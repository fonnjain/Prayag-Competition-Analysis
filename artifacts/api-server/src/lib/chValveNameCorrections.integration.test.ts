import { describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import {
  catalogProductNameCorrectionsTable,
  catalogProductsTable,
  db,
  mrpPriceHistoryTable,
} from "@workspace/db";
import {
  applyChValveNameCorrections,
  CH_VALVE_NAME_CORRECTIONS,
} from "./chValveNameCorrections.js";

const CODES = CH_VALVE_NAME_CORRECTIONS.map(({ itemCode }) => itemCode);

describe("CH concealed-valve name corrections", () => {
  it("is idempotent and changes names without touching price history", async () => {
    const beforeRows = await db
      .select({
        itemCode: mrpPriceHistoryTable.itemCode,
        mrp: mrpPriceHistoryTable.mrp,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        id: mrpPriceHistoryTable.id,
      })
      .from(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.itemCode, CODES));
    const [{ count: beforeCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(mrpPriceHistoryTable);

    const first = await applyChValveNameCorrections();
    const second = await applyChValveNameCorrections();

    expect(first.total).toBe(17);
    expect(second).toEqual({ total: 17, changed: 0, alreadyCorrect: 17 });

    const products = await db
      .select({
        itemCode: catalogProductsTable.itemCode,
        productName: catalogProductsTable.productName,
      })
      .from(catalogProductsTable)
      .where(inArray(catalogProductsTable.itemCode, CODES));
    const names = new Map(
      products.map(({ itemCode, productName }) => [itemCode, productName]),
    );
    for (const correction of CH_VALVE_NAME_CORRECTIONS) {
      expect(names.get(correction.itemCode)).toBe(correction.correctedName);
    }

    const audits = await db
      .select({
        itemCode: catalogProductNameCorrectionsTable.itemCode,
        correctedName: catalogProductNameCorrectionsTable.correctedName,
        reason: catalogProductNameCorrectionsTable.reason,
      })
      .from(catalogProductNameCorrectionsTable)
      .where(inArray(catalogProductNameCorrectionsTable.itemCode, CODES));
    expect(audits).toHaveLength(17);
    expect(new Set(audits.map(({ itemCode }) => itemCode))).toEqual(
      new Set(CODES),
    );
    expect(audits.every(({ reason }) => reason.includes("TRIANGULAR"))).toBe(
      true,
    );

    const afterRows = await db
      .select({
        itemCode: mrpPriceHistoryTable.itemCode,
        mrp: mrpPriceHistoryTable.mrp,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        id: mrpPriceHistoryTable.id,
      })
      .from(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.itemCode, CODES));
    const [{ count: afterCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(mrpPriceHistoryTable);

    expect(afterRows).toEqual(beforeRows);
    expect(afterCount).toBe(beforeCount);
  });
});