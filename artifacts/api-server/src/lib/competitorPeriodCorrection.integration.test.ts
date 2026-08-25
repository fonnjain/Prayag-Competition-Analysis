import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  competitorPricesTable,
  db,
  importBatchesTable,
} from "@workspace/db";
import { retimeVerifiedCompetitorPeriod } from "./competitorPeriodCorrection.js";

let competitor = "";
let batchId = 0;

afterEach(async () => {
  if (competitor) {
    await db
      .delete(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, competitor));
  }
  if (batchId) {
    await db.delete(importBatchesTable).where(eq(importBatchesTable.id, batchId));
  }
  competitor = "";
  batchId = 0;
});

describe("verified competitor period correction", () => {
  it("retimes only the verified rows, preserves batch counts, and records an audit event", async () => {
    competitor = `__test_period_correction_${Date.now()}__`;
    const fromEffectiveDate = "2026-01-01";
    const toEffectiveDate = "2026-01-02";
    const [batch] = await db
      .insert(importBatchesTable)
      .values({
        competitor,
        effectiveDate: fromEffectiveDate,
        sourceFileName: "fixture.pdf",
        priceBasis: "MRP",
        status: "approved",
        rowCounts: JSON.stringify({ ok: 2, new_products: 3 }),
      })
      .returning({ id: importBatchesTable.id });
    batchId = batch!.id;

    await db.insert(competitorPricesTable).values([
      {
        competitor,
        competitorCode: "FIX-100",
        matchedPrayagCode: "FIXTURE-100",
        price: 330,
        effectiveDate: fromEffectiveDate,
        matchStatus: "matched",
        isCurrent: true,
      },
      {
        competitor,
        competitorCode: "FIX-200",
        matchedPrayagCode: "FIXTURE-200",
        price: 450,
        effectiveDate: fromEffectiveDate,
        matchStatus: "matched",
        isCurrent: true,
      },
    ]);

    const result = await retimeVerifiedCompetitorPeriod({
      competitor,
      fromEffectiveDate,
      toEffectiveDate,
      expectedRowCount: 2,
      verificationCode: "FIX-100",
      verificationPrice: 330,
      reason: "Fixture correction",
    });

    expect(result).toEqual({ status: "applied", rows: 2, batchId });
    const priceRows = await db
      .select()
      .from(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, competitor));
    expect(priceRows).toHaveLength(2);
    expect(priceRows.every((row) => row.effectiveDate === toEffectiveDate)).toBe(true);

    const [updatedBatch] = await db
      .select()
      .from(importBatchesTable)
      .where(eq(importBatchesTable.id, batchId));
    expect(updatedBatch!.effectiveDate).toBe(toEffectiveDate);
    expect(JSON.parse(updatedBatch!.rowCounts!)).toMatchObject({
      ok: 2,
      new_products: 3,
      dataOperations: [
        {
          type: "effective_date_correction",
          fromEffectiveDate,
          toEffectiveDate,
          rowCount: 2,
          verificationCode: "FIX-100",
          verificationPrice: 330,
          reason: "Fixture correction",
        },
      ],
    });

    const replay = await retimeVerifiedCompetitorPeriod({
      competitor,
      fromEffectiveDate,
      toEffectiveDate,
      expectedRowCount: 2,
      verificationCode: "FIX-100",
      verificationPrice: 330,
      reason: "Fixture correction",
    });
    expect(replay).toEqual({ status: "already_applied", rows: 2 });

    const oldPeriodRows = await db
      .select({ id: competitorPricesTable.id })
      .from(competitorPricesTable)
      .where(
        and(
          eq(competitorPricesTable.competitor, competitor),
          eq(competitorPricesTable.effectiveDate, fromEffectiveDate),
        ),
      );
    expect(oldPeriodRows).toHaveLength(0);
  });
});