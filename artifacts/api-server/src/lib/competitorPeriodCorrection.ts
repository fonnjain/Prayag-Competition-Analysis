import { eq, sql } from "drizzle-orm";
import {
  competitorPricesTable,
  db,
  importBatchesTable,
} from "@workspace/db";
import { recomputeCompetitorCurrentFlags } from "./catalog.js";

type CorrectionSpec = {
  competitor: string;
  fromEffectiveDate: string;
  toEffectiveDate: string;
  expectedRowCount: number;
  verificationCode: string;
  verificationPrice: number;
  reason: string;
};

type CorrectionResult =
  | { status: "applied"; rows: number; batchId: number }
  | { status: "already_applied"; rows: number };

function appendAuditEvent(
  rawRowCounts: string | null,
  event: Record<string, unknown>,
): string {
  let counts: Record<string, unknown> = {};
  try {
    const parsed = rawRowCounts ? JSON.parse(rawRowCounts) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) counts = parsed;
  } catch {
    counts = {};
  }

  const existingEvents = Array.isArray(counts.dataOperations)
    ? counts.dataOperations
    : [];
  return JSON.stringify({
    ...counts,
    dataOperations: [...existingEvents, event],
  });
}

export async function retimeVerifiedCompetitorPeriod(
  spec: CorrectionSpec,
): Promise<CorrectionResult> {
  const result = await db.transaction(async (tx) => {
    const [fromPeriod, toPeriod] = await Promise.all([
      tx.execute<{
        rows: number;
        verification_price: number | null;
      }>(sql`
        SELECT
          COUNT(*)::int AS rows,
          MAX(price) FILTER (WHERE competitor_code = ${spec.verificationCode}) AS verification_price
        FROM competitor_prices
        WHERE competitor = ${spec.competitor}
          AND effective_date = ${spec.fromEffectiveDate}
      `),
      tx.execute<{
        rows: number;
        verification_price: number | null;
      }>(sql`
        SELECT
          COUNT(*)::int AS rows,
          MAX(price) FILTER (WHERE competitor_code = ${spec.verificationCode}) AS verification_price
        FROM competitor_prices
        WHERE competitor = ${spec.competitor}
          AND effective_date = ${spec.toEffectiveDate}
      `),
    ]);

    const source = fromPeriod.rows[0];
    const target = toPeriod.rows[0];
    const sourceRows = Number(source?.rows ?? 0);
    const targetRows = Number(target?.rows ?? 0);
    const verificationPrice = source?.verification_price == null
      ? null
      : Number(source.verification_price);
    const targetVerificationPrice = target?.verification_price == null
      ? null
      : Number(target.verification_price);

    if (
      sourceRows === 0 &&
      targetRows === spec.expectedRowCount &&
      targetVerificationPrice === spec.verificationPrice
    ) {
      return { status: "already_applied" as const, rows: targetRows };
    }

    if (
      sourceRows !== spec.expectedRowCount ||
      targetRows !== 0 ||
      verificationPrice !== spec.verificationPrice
    ) {
      throw new Error(
        `Refusing competitor period correction for ${spec.competitor}: expected ${spec.expectedRowCount} rows at ${spec.fromEffectiveDate}, no rows at ${spec.toEffectiveDate}, and ${spec.verificationCode} at ${spec.verificationPrice}; found ${sourceRows}, ${targetRows}, and ${verificationPrice}.`,
      );
    }

    const batches = await tx
      .select({
        id: importBatchesTable.id,
        rowCounts: importBatchesTable.rowCounts,
      })
      .from(importBatchesTable)
      .where(
        sql`${importBatchesTable.competitor} = ${spec.competitor}
          AND ${importBatchesTable.effectiveDate} = ${spec.fromEffectiveDate}
          AND ${importBatchesTable.status} = 'approved'`,
      );
    if (batches.length !== 1) {
      throw new Error(
        `Refusing competitor period correction for ${spec.competitor}: expected one approved batch at ${spec.fromEffectiveDate}, found ${batches.length}.`,
      );
    }

    const batch = batches[0]!;
    const auditEvent = {
      type: "effective_date_correction",
      fromEffectiveDate: spec.fromEffectiveDate,
      toEffectiveDate: spec.toEffectiveDate,
      rowCount: sourceRows,
      verificationCode: spec.verificationCode,
      verificationPrice: spec.verificationPrice,
      reason: spec.reason,
      recordedAt: new Date().toISOString(),
    };

    await tx
      .update(competitorPricesTable)
      .set({ effectiveDate: spec.toEffectiveDate, isCurrent: false })
      .where(
        sql`${competitorPricesTable.competitor} = ${spec.competitor}
          AND ${competitorPricesTable.effectiveDate} = ${spec.fromEffectiveDate}`,
      );
    await tx
      .update(importBatchesTable)
      .set({
        effectiveDate: spec.toEffectiveDate,
        rowCounts: appendAuditEvent(batch.rowCounts, auditEvent),
      })
      .where(eq(importBatchesTable.id, batch.id));

    return { status: "applied" as const, rows: sourceRows, batchId: batch.id };
  });

  if (result.status === "applied") {
    await recomputeCompetitorCurrentFlags(spec.competitor);
  }
  return result;
}

export function correctSparshVol62EffectiveDate(): Promise<CorrectionResult> {
  return retimeVerifiedCompetitorPeriod({
    competitor: "Sparsh Pearl",
    fromEffectiveDate: "2026-08-20",
    toEffectiveDate: "2026-09-01",
    expectedRowCount: 150,
    verificationCode: "BCC-301",
    verificationPrice: 330,
    reason:
      "Vol 6.2 was verified as effective 2026-09-01; the earlier 2026-03-05 Sparsh period remains unchanged.",
  });
}