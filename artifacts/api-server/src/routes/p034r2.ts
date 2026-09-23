import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  competitorMappingDecisionsTable,
  competitorPricesTable,
  catalogProductsTable,
  mrpPriceHistoryTable,
  mrpRevisionBatchesTable,
  mrpRevisionRowsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";
import { normalizePrinceCode } from "../lib/princeMaster";
import { normCode } from "../lib/catalog";

const router: IRouter = Router();
const PROMPT = "P034r2";
const COMPETITOR = "Prince";
const DATE = "2026-03-01";
const DELETE_CODE = "A-464";
const DELETE_PRINCE = "SIM100150";
const SIM_PRINCE = "SIM200032";
const SIM_TARGETS = new Map([["A-86A", 759], ["A-86B", 1265]]);
const SNAPSHOT_FIELDS = [
  "id", "competitor", "category", "description", "size", "price", "unit",
  "competitorCode", "effectiveDate", "matchedPrayagCode", "matchStatus",
  "matchConfidence", "prayagMrpAtCompare", "isCurrent", "priceBasis",
  "gstPct", "loadBatchId", "lastRevisionBatchId", "createdAt", "updatedAt",
] as const;

function actor(req: Parameters<typeof requireAdmin>[0]): string | null {
  return req.user?.email ?? req.user?.id ?? null;
}
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (a instanceof Date ? a.getTime() : new Date(String(a)).getTime()) ===
      (b instanceof Date ? b.getTime() : new Date(String(b)).getTime());
  }
  return a === b;
}
function matches(current: Record<string, unknown>, snapshot: Record<string, unknown>): boolean {
  return SNAPSHOT_FIELDS.every((field) => same(current[field], snapshot[field] ?? null));
}
function stateFingerprint(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).sort().join("\n");
}

const decisions = [
  { competitorCode: "SIM200032", prayagCode: "A-86B", decision: "exclusion", reason: "one Prince code quoted at two prices; both mappings withdrawn by Prayag, 23 September 2026" },
  { competitorCode: "SIM200032", prayagCode: "A-86A", decision: "exclusion", reason: "one Prince code quoted at two prices; both mappings withdrawn by Prayag, 23 September 2026" },
  { competitorCode: "SIM100150", prayagCode: DELETE_CODE, decision: "exclusion", reason: "Prince SKU mapped to two Prayag codes; Prayag retained A-414 only, 23 September 2026" },
  { competitorCode: "SIM103500", prayagCode: "*", decision: "confirmation", reason: "one Prince SKU serving two Prayag variants; confirmed correct by Prayag, 23 September 2026" },
  { competitorCode: "SIM103501", prayagCode: "*", decision: "confirmation", reason: "one Prince SKU serving two Prayag variants; confirmed correct by Prayag, 23 September 2026" },
] as const;

async function state() {
  const [deleted, simRows, kept, swr, products, history] = await Promise.all([
    db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, COMPETITOR),
      eq(competitorPricesTable.competitorCode, DELETE_PRINCE),
      eq(competitorPricesTable.matchedPrayagCode, DELETE_CODE),
      eq(competitorPricesTable.effectiveDate, DATE),
    )),
    db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, COMPETITOR),
      eq(competitorPricesTable.competitorCode, SIM_PRINCE),
      eq(competitorPricesTable.effectiveDate, DATE),
    )),
    db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, COMPETITOR),
      eq(competitorPricesTable.competitorCode, DELETE_PRINCE),
      eq(competitorPricesTable.matchedPrayagCode, "A-414"),
      eq(competitorPricesTable.effectiveDate, DATE),
    )),
    db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, COMPETITOR),
      sql`${competitorPricesTable.competitorCode} IN ('SIM103500','SIM103501')`,
      eq(competitorPricesTable.effectiveDate, DATE),
    )),
    db.select().from(catalogProductsTable),
    db.select().from(mrpPriceHistoryTable),
  ]);
  const comparable = await db.execute(sql`
    SELECT count(*)::int AS count FROM competitor_prices cp
    WHERE cp.competitor = ${COMPETITOR} AND cp.matched_prayag_code IS NOT NULL
      AND EXISTS (SELECT 1 FROM mrp_price_history h WHERE h.item_code = cp.matched_prayag_code AND h.variant = 'Standard' AND h.review_status = 'approved' AND h.effective_date <= cp.effective_date)
  `);
  const competitors = await db.select().from(competitorPricesTable);
  return { deleted, kept, simRows, swr, products, history, competitors, otherCompetitors: competitors.filter((row) => row.competitor !== COMPETITOR), comparableCount: Number(comparable.rows[0]?.count ?? 0) };
}

router.post("/catalog/competitor-mapping-decisions/p034r2/preview", requireAdmin, async (req, res) => {
  try {
    const current = await state();
    if (current.deleted.length !== 1 || current.deleted[0]!.competitorCode !== DELETE_PRINCE) {
      throw Object.assign(new Error("P034r2 halted: preview must identify SIM100150 → A-464 as the deletion target; A-414 is never the deletion target."), { httpStatus: 409 });
    }
    if (current.kept.length !== 1 || current.kept[0]!.price !== 30) {
      throw Object.assign(new Error("P034r2 halted: SIM100150 → A-414 is not in the expected untouched state."), { httpStatus: 409 });
    }
    if (current.swr.length !== 4 || current.swr.some((row) => row.matchStatus !== "matched")) {
      throw Object.assign(new Error("P034r2 halted: the four confirmed SWR mappings are not all present and matched."), { httpStatus: 409 });
    }
    const simMalformed = current.simRows.length !== 0 && (
      current.simRows.length !== 2 ||
      current.simRows.some((row) => !SIM_TARGETS.has(row.matchedPrayagCode ?? "") || row.price !== SIM_TARGETS.get(row.matchedPrayagCode ?? ""))
    );
    if (simMalformed) {
      throw Object.assign(new Error("P034r2 halted: SIM200032 must be absent or contain exactly A-86A at 759 and A-86B at 1265 for 2026-03-01."), { httpStatus: 409 });
    }
    const cleanupRows = [...current.simRows];
    const deletionRows = [current.deleted[0]!, ...cleanupRows];
    const prior = await db.select().from(competitorMappingDecisionsTable)
      .where(and(eq(competitorMappingDecisionsTable.competitor, COMPETITOR), sql`${competitorMappingDecisionsTable.undoneAt} IS NULL`));
    if (prior.length) throw Object.assign(new Error("P034r2 already has active decisions; use the existing batch or rollback before creating another preview."), { httpStatus: 409 });
    const payload = {
      promptVersion: PROMPT, deletionTarget: `${DELETE_PRINCE} → ${DELETE_CODE}`,
      part2ReversedTarget: `${DELETE_PRINCE} → ${DELETE_CODE}`,
      part1CleanupTargets: cleanupRows.map((row) => `${SIM_PRINCE} → ${row.matchedPrayagCode}`),
      deletedRows: deletionRows, deletedRow: current.deleted[0], keptRow: current.kept[0], swrRows: current.swr,
      decisions, competitorCountBefore: Number((await db.select({ count: sql<number>`count(*)::int` }).from(competitorPricesTable))[0]?.count ?? 0),
      mrpCountBefore: current.history.length,
      mrpChecksumBefore: stateFingerprint(current.history),
      productCountBefore: current.products.length,
      productFingerprintBefore: stateFingerprint(current.products),
      otherCompetitorFingerprintBefore: stateFingerprint(current.otherCompetitors),
      competitorFingerprintBefore: stateFingerprint(current.competitors),
      comparablePairsBefore: current.comparableCount,
    };
    const [batch] = await db.insert(mrpRevisionBatchesTable).values({
      targetType: "p034r2", competitor: COMPETITOR, lockedEffectiveDate: DATE,
      fileName: "P034r2 decision prompt", fileSha256: "P034r2",
      fileSizeBytes: 0, uploadedBy: actor(req), reason: PROMPT,
      rowsInFile: 5, rowsChanged: deletionRows.length, rowsNoop: 5 - deletionRows.length, rowsRejected: 0, warningCount: 0,
    }).returning({ id: mrpRevisionBatchesTable.id });
    if (!batch) throw new Error("Could not create P034r2 preview batch.");
    await db.insert(mrpRevisionRowsTable).values(deletionRows.map((target, index) => ({
      batchId: batch.id, rowNumber: index + 1, itemCode: target.matchedPrayagCode!, effectiveDate: DATE,
      variant: "Standard", competitor: COMPETITOR, targetRowId: target.id,
      previousValue: target.price, newValue: null, operation: "delete" as const,
      previousRowSnapshot: JSON.stringify(payload), note: index === 0 ? PROMPT : "P034r2 Part 1 cleanup: P027r2 rejection did not hold.", outcome: "change" as const,
    })));
    res.json({ batchId: batch.id, status: "preview", promptVersion: PROMPT, deletionTarget: `${DELETE_PRINCE} → ${DELETE_CODE}`, part2ReversedTarget: `${DELETE_PRINCE} → ${DELETE_CODE}`, part1CleanupTargets: payload.part1CleanupTargets, decisions, rowsChanged: deletionRows.length, decisionsToCreate: 5, competitorCountBefore: payload.competitorCountBefore, comparablePairsBefore: current.comparableCount, rows: { delete: deletionRows.length, keepA414: 1, confirmedSWR: 4 }, payload });
  } catch (error: any) {
    res.status(error.httpStatus ?? 400).json({ error: error instanceof Error ? error.message : "Could not preview P034r2." });
  }
});

router.post("/catalog/competitor-mapping-decisions/p034r2/:batchId/apply", requireAdmin, async (req, res) => {
  const batchId = Number(req.params.batchId);
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(340342)`);
      await tx.execute(sql`SELECT id FROM mrp_revision_batches WHERE id = ${batchId} FOR UPDATE`);
      const batch = (await tx.select().from(mrpRevisionBatchesTable).where(eq(mrpRevisionBatchesTable.id, batchId)).limit(1))[0];
      if (!batch || batch.targetType !== "p034r2") throw Object.assign(new Error("P034r2 batch not found."), { httpStatus: 404 });
      if (batch.status !== "preview") throw Object.assign(new Error(`P034r2 batch is already ${batch.status}.`), { httpStatus: 409 });
      const rows = await tx.select().from(mrpRevisionRowsTable).where(eq(mrpRevisionRowsTable.batchId, batchId)).orderBy(mrpRevisionRowsTable.rowNumber);
      const payload = rows[0]?.previousRowSnapshot ? JSON.parse(rows[0].previousRowSnapshot) as { deletedRows: Array<Record<string, unknown>>; keptRow: Record<string, unknown>; swrRows: Array<Record<string, unknown>>; competitorCountBefore: number; comparablePairsBefore: number; mrpChecksumBefore: string; productFingerprintBefore: string; otherCompetitorFingerprintBefore: string; competitorFingerprintBefore: string } : null;
      if (!payload?.deletedRows || payload.deletedRows.length !== rows.length) throw new Error("P034r2 target snapshots are missing.");
      for (const target of payload.deletedRows) {
        const current = (await tx.select().from(competitorPricesTable).where(eq(competitorPricesTable.id, Number(target.id))).limit(1))[0];
        if (!current || !matches(current as unknown as Record<string, unknown>, target)) {
          throw Object.assign(new Error("P034r2 stale preview: a deletion target changed after preview."), { httpStatus: 409 });
        }
      }
      const protectedRows = [payload.keptRow, ...payload.swrRows];
      for (const protectedRow of protectedRows) {
        const protectedCurrent = (await tx.select().from(competitorPricesTable).where(eq(competitorPricesTable.id, Number(protectedRow.id))).limit(1))[0];
        if (!protectedCurrent || !matches(protectedCurrent as unknown as Record<string, unknown>, protectedRow)) {
          throw Object.assign(new Error("P034r2 stale preview: a protected A-414 or SWR mapping changed after preview."), { httpStatus: 409 });
        }
      }
      const [nowHistory, nowProducts, nowCompetitors] = await Promise.all([
        tx.select().from(mrpPriceHistoryTable),
        tx.select().from(catalogProductsTable),
        tx.select().from(competitorPricesTable),
      ]);
      if (
        stateFingerprint(nowHistory) !== payload.mrpChecksumBefore ||
        stateFingerprint(nowProducts) !== payload.productFingerprintBefore ||
        stateFingerprint(nowCompetitors) !== payload.competitorFingerprintBefore ||
        stateFingerprint(nowCompetitors.filter((item) => item.competitor !== COMPETITOR)) !== payload.otherCompetitorFingerprintBefore
      ) {
        throw Object.assign(new Error("P034r2 stale preview: MRP, product, or another competitor changed after preview."), { httpStatus: 409 });
      }
      const existing = await tx.select().from(competitorMappingDecisionsTable).where(and(eq(competitorMappingDecisionsTable.competitor, COMPETITOR), sql`${competitorMappingDecisionsTable.undoneAt} IS NULL`));
      if (existing.length) throw Object.assign(new Error("P034r2 decisions changed after preview."), { httpStatus: 409 });
      const deleted = await tx.delete(competitorPricesTable).where(sql`${competitorPricesTable.id} IN (${sql.join(payload.deletedRows.map((target) => sql`${Number(target.id)}`), sql`, `)})`).returning({ id: competitorPricesTable.id });
      if (deleted.length !== payload.deletedRows.length) throw new Error("P034r2 safety guard: deletion RETURNING count did not match enumerated targets.");
      const competitorAfter = Number((await tx.select({ count: sql<number>`count(*)::int` }).from(competitorPricesTable))[0]?.count ?? 0);
      if (competitorAfter !== payload.competitorCountBefore - payload.deletedRows.length) {
        throw new Error("P034r2 safety guard: global competitor count did not decrease by deletion count.");
      }
      const comparableAfter = Number((await tx.execute(sql`
        SELECT count(*)::int AS count FROM competitor_prices cp
        WHERE cp.competitor = 'Prince' AND cp.matched_prayag_code IS NOT NULL
          AND EXISTS (SELECT 1 FROM mrp_price_history h WHERE h.item_code = cp.matched_prayag_code AND h.variant = 'Standard' AND h.review_status = 'approved' AND h.effective_date <= cp.effective_date)
      `)).rows[0]?.count ?? 0);
      if (comparableAfter !== payload.comparablePairsBefore - payload.deletedRows.length) {
        throw new Error("P034r2 safety guard: comparable pair count did not decrease by deletion count.");
      }
      await tx.insert(competitorMappingDecisionsTable).values(decisions.map((decision) => ({ ...decision, competitor: COMPETITOR, promptVersion: PROMPT, actor: actor(req), batchId })));
      await tx.update(mrpRevisionBatchesTable).set({ status: "applied", appliedAt: new Date(), appliedBy: actor(req) }).where(eq(mrpRevisionBatchesTable.id, batchId));
      return { batchId, status: "applied", deleted: payload.deletedRows.map((target) => `${target.competitorCode} → ${target.matchedPrayagCode}`), decisionsCreated: decisions.length, counts: { competitorBefore: payload.competitorCountBefore, competitorAfter, comparableBefore: payload.comparablePairsBefore, comparableAfter } };
    });
    res.json(result);
  } catch (error: any) { res.status(error.httpStatus ?? 500).json({ error: error.message ?? "Could not apply P034r2." }); }
});

router.post("/catalog/competitor-mapping-decisions/p034r2/:batchId/rollback", requireAdmin, async (req, res) => {
  const batchId = Number(req.params.batchId);
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM mrp_revision_batches WHERE id = ${batchId} FOR UPDATE`);
      const batch = (await tx.select().from(mrpRevisionBatchesTable).where(eq(mrpRevisionBatchesTable.id, batchId)).limit(1))[0];
      if (!batch || batch.targetType !== "p034r2") throw Object.assign(new Error("P034r2 batch not found."), { httpStatus: 404 });
      if (batch.status !== "applied") throw Object.assign(new Error(`P034r2 batch is already ${batch.status}.`), { httpStatus: 409 });
      const rows = await tx.select().from(mrpRevisionRowsTable).where(eq(mrpRevisionRowsTable.batchId, batchId)).orderBy(mrpRevisionRowsTable.rowNumber);
      const payload = rows[0]?.previousRowSnapshot ? JSON.parse(rows[0].previousRowSnapshot) as { deletedRows: Array<Record<string, any>> } : null;
      if (!payload?.deletedRows || payload.deletedRows.length !== rows.length) throw new Error("P034r2 deleted-row snapshots are missing.");
      const appliedDecisions = await tx.select().from(competitorMappingDecisionsTable)
        .where(eq(competitorMappingDecisionsTable.batchId, batchId));
      if (appliedDecisions.length !== decisions.length || appliedDecisions.some((saved) =>
        !decisions.some((expected) =>
          saved.competitor === COMPETITOR &&
          saved.competitorCode === expected.competitorCode &&
          saved.prayagCode === expected.prayagCode &&
          saved.decision === expected.decision &&
          saved.reason === expected.reason &&
          saved.promptVersion === PROMPT,
        ),
      )) {
        throw Object.assign(new Error("P034r2 rollback halted: decision audit snapshots changed."), { httpStatus: 409 });
      }
      for (const deletedRow of payload.deletedRows) {
        const exists = await tx.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(eq(competitorPricesTable.id, deletedRow.id)).limit(1);
        if (exists.length) throw Object.assign(new Error("P034r2 rollback halted: deleted mapping was recreated."), { httpStatus: 409 });
        const conflictingPair = await tx.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(and(
          eq(competitorPricesTable.competitor, COMPETITOR),
          eq(competitorPricesTable.competitorCode, String(deletedRow.competitorCode)),
          eq(competitorPricesTable.matchedPrayagCode, String(deletedRow.matchedPrayagCode)),
          eq(competitorPricesTable.effectiveDate, String(deletedRow.effectiveDate)),
        )).limit(1);
        if (conflictingPair.length) throw Object.assign(new Error("P034r2 rollback halted: a conflicting pair already exists."), { httpStatus: 409 });
        const restored = {
          ...(deletedRow as typeof competitorPricesTable.$inferInsert),
          createdAt: new Date(String(deletedRow.createdAt)),
          updatedAt: new Date(String(deletedRow.updatedAt)),
        } as typeof competitorPricesTable.$inferInsert;
        const [restoredRow] = await tx.insert(competitorPricesTable).values(restored).returning();
        if (!restoredRow || !matches(restoredRow as unknown as Record<string, unknown>, deletedRow)) {
          throw new Error("P034r2 rollback safety guard: restored row does not exactly match its snapshot.");
        }
      }
      await tx.delete(competitorMappingDecisionsTable).where(eq(competitorMappingDecisionsTable.batchId, batchId));
      await tx.update(mrpRevisionBatchesTable).set({ status: "rolled_back", rolledBackAt: new Date(), rolledBackBy: actor(req) }).where(eq(mrpRevisionBatchesTable.id, batchId));
      return { batchId, status: "rolled_back", restored: payload.deletedRows.map((target) => `${target.competitorCode} → ${target.matchedPrayagCode}`), decisionsRemoved: 5 };
    });
    res.json(result);
  } catch (error: any) { res.status(error.httpStatus ?? 500).json({ error: error.message ?? "Could not rollback P034r2." }); }
});

export default router;