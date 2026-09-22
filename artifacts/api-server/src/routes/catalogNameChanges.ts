import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  catalogProductsTable,
  catalogProductNameCorrectionsTable,
  competitorPricesTable,
  competitorPriceStagingTable,
  mrpLoadBatchesTable,
  mrpPendingBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const EXPECTED_SHA256 = "d3fa57358c6044a9dc5c9b712142e44e8aab49b43857df66335fa0390b0396b1";
const FILE_NAME = "Prayag_Name_Changes_01Sep2026.xlsx";
const SOURCE = {
  division: "Catalogue Name Changes",
  sheetId: "__catalogue_name_changes__",
  sheetUrl: "internal://catalogue-name-changes",
  notes: "P024 controlled product-name correction workbook.",
  sourceKind: "name_changes",
} as const;
const actor = (req: Request) => req.user?.email ?? req.user?.id ?? "unknown";
const today = () => new Date().toISOString().slice(0, 10);
const text = (value: unknown) => String(value ?? "").trim();
export const isCompleteP024Preview = (rowCount: number) => rowCount === 155;

export interface NameChangeRow {
  itemCode: string;
  division: string;
  series: string;
  oldName: string;
  newName: string;
  changeType: string;
  mrpUnchanged: number | null;
  note: string;
}

export function parseNameChangesWorkbook(buffer: Buffer): NameChangeRow[] {
  const sha = createHash("sha256").update(buffer).digest("hex");
  if (sha !== EXPECTED_SHA256) throw new Error(`Workbook SHA-256 mismatch: expected ${EXPECTED_SHA256}, received ${sha}.`);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets.name_changes;
  if (!sheet) throw new Error("Workbook must contain the name_changes sheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const required = ["item_code", "division", "series", "old_name", "new_name", "change_type", "mrp_unchanged", "note"];
  if (!rows.length || required.some((key) => !(key in rows[0]!))) {
    throw new Error(`name_changes must contain columns: ${required.join(", ")}.`);
  }
  return rows.map((row, index) => {
    const parsed = {
      itemCode: text(row.item_code),
      division: text(row.division),
      series: text(row.series),
      oldName: text(row.old_name),
      newName: text(row.new_name),
      changeType: text(row.change_type),
      mrpUnchanged: row.mrp_unchanged == null || row.mrp_unchanged === "" ? null : Number(row.mrp_unchanged),
      note: text(row.note),
    };
    if (!parsed.itemCode || !parsed.newName || !parsed.oldName || !Number.isFinite(parsed.mrpUnchanged ?? 0)) {
      throw new Error(`Invalid name change row ${index + 2}.`);
    }
    return parsed;
  });
}

function stable(value: unknown) {
  return JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item);
}

async function ensureSource(tx: typeof db) {
  const existing = (await tx.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, SOURCE.sheetId)).limit(1))[0];
  if (existing) return existing;
  return (await tx.insert(mrpSourcesTable).values(SOURCE).returning())[0]!;
}

async function evidence(executor: any, codes: string[]) {
  const [competitors, needsReview] = await Promise.all([
    executor.select().from(competitorPricesTable).where(inArray(competitorPricesTable.matchedPrayagCode, codes)).orderBy(asc(competitorPricesTable.id)),
    executor.select().from(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.status, "needs_review")).orderBy(asc(competitorPriceStagingTable.id)),
  ]);
  return { competitors, needsReview };
}

export function previewFor(rows: NameChangeRow[], products: Array<typeof catalogProductsTable.$inferSelect>) {
  const byCode = new Map(products.map((product) => [product.itemCode, product]));
  const mismatched: Array<{ row: number; itemCode: string; reasons: string[]; storedName: string | null }> = [];
  let matched = 0;
  let alreadyCorrect = 0;
  let wouldUpdate = 0;
  for (const [index, change] of rows.entries()) {
    const product = byCode.get(change.itemCode);
    const reasons: string[] = [];
    if (!product) reasons.push("code not found");
    else {
      matched += 1;
      if ((product.division ?? "") !== change.division) reasons.push("division differs");
      if ((product.seriesRange ?? "") !== change.series) reasons.push("series differs");
      if (!product.isActive || product.discontinuedFrom) reasons.push("discontinued/inactive product");
      const eligible = reasons.length === 0;
      if (eligible && (product.productName ?? "") === change.newName) alreadyCorrect += 1;
      else if (eligible && (product.productName ?? "") === change.oldName) wouldUpdate += 1;
      else if (eligible) reasons.push("old_name does not match stored product_name");
    }
    if (reasons.length) mismatched.push({ row: index + 2, itemCode: change.itemCode, reasons, storedName: product?.productName ?? null });
  }
  return {
    rowsRead: rows.length,
    codesMatched: matched,
    oldNameVerified: wouldUpdate + alreadyCorrect,
    oldNameMismatched: mismatched.length,
    alreadyCorrect,
    wouldUpdate,
    eligibleRows: wouldUpdate + alreadyCorrect,
    priceRowsToWrite: 0,
    competitorRowsToTouch: 0,
    productsToCreate: 0,
    mismatched,
  };
}

async function mrpMismatches(executor: any, rows: NameChangeRow[]) {
  const mismatches: Array<{ itemCode: string; expected: number; actual: number | null }> = [];
  for (const row of rows) {
    const current = (await executor.select({ mrp: mrpPriceHistoryTable.mrp })
      .from(mrpPriceHistoryTable)
      .where(and(
        eq(mrpPriceHistoryTable.itemCode, row.itemCode),
        eq(mrpPriceHistoryTable.variant, "Standard"),
        eq(mrpPriceHistoryTable.reviewStatus, "approved"),
        sql`${mrpPriceHistoryTable.effectiveDate} <= CURRENT_DATE`,
      ))
      .orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id))
      .limit(1))[0]?.mrp ?? null;
    if (row.mrpUnchanged == null || current !== row.mrpUnchanged) {
      mismatches.push({ itemCode: row.itemCode, expected: row.mrpUnchanged ?? NaN, actual: current });
    }
  }
  return mismatches;
}

router.post("/catalog/name-changes/preview", requireAdmin, upload.single("file"), async (req, res): Promise<any> => {
  let loadBatchId: number | null = null;
  try {
    if (!req.file) return res.status(400).json({ error: "No workbook uploaded." });
    const receivedSha = createHash("sha256").update(req.file.buffer).digest("hex");
    if (receivedSha !== EXPECTED_SHA256) throw new Error(`Workbook SHA-256 mismatch: expected ${EXPECTED_SHA256}, received ${receivedSha}.`);
    const source = await ensureSource(db);
    const load = (await db.insert(mrpLoadBatchesTable).values({
      sourceId: source.id, fileName: req.file.originalname, fileSha256: EXPECTED_SHA256,
      fileSizeBytes: req.file.size, downloadedAt: today(), loadedBy: actor(req), rowCount: 0,
      notes: JSON.stringify({ kind: "P024_name_changes", status: "PREVIEW" }),
    }).returning({ id: mrpLoadBatchesTable.id }))[0]!;
    loadBatchId = load.id;
    const rows = parseNameChangesWorkbook(req.file.buffer);
    const duplicateCodes = rows.filter((row, i) => rows.findIndex((candidate) => candidate.itemCode === row.itemCode) !== i);
    if (rows.length !== 155) throw new Error(`Expected 155 rows; received ${rows.length}.`);
    if (duplicateCodes.length) throw new Error("Workbook contains duplicate item codes.");
    const products = await db.select().from(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, rows.map((row) => row.itemCode)));
    const fullPreview = { ...previewFor(rows, products), mrpUnchangedMismatched: await mrpMismatches(db, rows) };
    const pending = (await db.insert(mrpPendingBatchesTable).values({
      sourceId: source.id, fileName: req.file.originalname, fileSha256: EXPECTED_SHA256,
      fileSizeBytes: req.file.size, downloadedAt: today(), uploadedBy: actor(req),
      payload: JSON.stringify(rows), preview: JSON.stringify(fullPreview),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), loadBatchId,
    }).returning({ id: mrpPendingBatchesTable.id }))[0]!;
    await db.update(mrpLoadBatchesTable).set({
      rowCount: rows.length,
      notes: JSON.stringify({ kind: "P024_name_changes", status: "PREVIEW", pendingBatchId: pending.id }),
    }).where(eq(mrpLoadBatchesTable.id, loadBatchId));
    return res.json({ pendingBatchId: pending.id, loadBatchId, fileName: req.file.originalname, fileSha256: EXPECTED_SHA256, preview: fullPreview });
  } catch (error) {
    if (loadBatchId) await db.update(mrpLoadBatchesTable).set({
      notes: JSON.stringify({ kind: "P024_name_changes", status: "REJECTED_PREVIEW", error: error instanceof Error ? error.message : "invalid workbook" }),
    }).where(eq(mrpLoadBatchesTable.id, loadBatchId));
    return res.status(400).json({ error: error instanceof Error ? error.message : "Could not preview workbook." });
  }
});

router.get("/catalog/name-changes/audit", requireAdmin, async (_req, res): Promise<any> => {
  const rows = await db.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.sourceId,
    (await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, SOURCE.sheetId)).limit(1))[0]?.id ?? -1));
  return res.json({ batches: rows });
});

router.get("/catalog/name-changes/:batchId", requireAdmin, async (req, res): Promise<any> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid batch id." });
  const pending = (await db.select().from(mrpPendingBatchesTable).where(eq(mrpPendingBatchesTable.id, id)).limit(1))[0];
  if (!pending) return res.status(404).json({ error: "Name-change preview not found." });
  return res.json({ batchId: id, status: pending.status, preview: JSON.parse(pending.preview), result: pending.result ? JSON.parse(pending.result) : null });
});

router.post("/catalog/name-changes/:batchId/apply", requireAdmin, async (req, res): Promise<any> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid batch id." });
  try {
    const result = await db.transaction(async (tx) => {
      const pending = (await tx.select().from(mrpPendingBatchesTable).where(eq(mrpPendingBatchesTable.id, id)).limit(1).for("update"))[0];
      if (!pending || pending.status !== "pending" || pending.expiresAt < new Date()) throw Object.assign(new Error("Preview is stale, expired, or already used."), { status: 409 });
      const rows = JSON.parse(pending.payload) as NameChangeRow[];
      const originalPreview = JSON.parse(pending.preview);
      if (!pending.loadBatchId) throw Object.assign(new Error("Preview has no provenance load batch."), { status: 409 });
      const load = (await tx.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, pending.loadBatchId)).limit(1).for("update"))[0];
      const source = load ? (await tx.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.id, load.sourceId)).limit(1))[0] : null;
      if (!load || !source || source.sheetId !== SOURCE.sheetId || load.fileSha256 !== EXPECTED_SHA256 || !isCompleteP024Preview(load.rowCount)) {
        throw Object.assign(new Error("Preview provenance does not belong to the P024 name-change flow."), { status: 409 });
      }
      const products = await tx.select().from(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, rows.map((row) => row.itemCode)));
      const preview = { ...previewFor(rows, products), mrpUnchangedMismatched: await mrpMismatches(tx, rows) };
      if (stable(preview) !== stable(originalPreview)) throw Object.assign(new Error("Preview no longer matches the current catalogue."), { status: 409 });
      if (preview.mrpUnchangedMismatched.length) throw Object.assign(new Error("Standard MRP values changed since preview; apply refused."), { status: 409 });
      const historyBefore = Number((await tx.select({ count: sql<number>`count(*)` }).from(mrpPriceHistoryTable))[0]?.count ?? 0);
      const before = await evidence(tx, rows.map((row) => row.itemCode));
      let updated = 0;
      let alreadyCorrect = 0;
      let skipped = 0;
      for (const row of rows) {
        const product = products.find((candidate) => candidate.itemCode === row.itemCode);
        if (!product || product.discontinuedFrom || !product.isActive ||
            product.division !== row.division || product.seriesRange !== row.series) {
          skipped += 1;
          continue;
        }
        if (product.productName === row.newName) {
          alreadyCorrect += 1;
          continue;
        }
        const changed = await tx.update(catalogProductsTable).set({ productName: row.newName, updatedAt: new Date() }).where(and(
          eq(catalogProductsTable.itemCode, row.itemCode),
          eq(catalogProductsTable.productName, row.oldName),
          eq(catalogProductsTable.division, row.division),
          eq(catalogProductsTable.seriesRange, row.series),
          eq(catalogProductsTable.isActive, true),
        )).returning({ itemCode: catalogProductsTable.itemCode });
        if (!changed.length) { skipped += 1; continue; }
        updated += 1;
        await tx.insert(catalogProductNameCorrectionsTable).values({
          correctionKey: `p024:${load.id}:${row.itemCode}`,
          itemCode: row.itemCode,
          previousName: row.oldName,
          correctedName: row.newName,
          reason: `P024 ${row.changeType}: ${row.note}`,
          loadBatchId: load.id,
          actor: actor(req),
        });
      }
      if (updated !== preview.wouldUpdate) throw Object.assign(new Error(`Apply changed ${updated} rows, but immutable preview required ${preview.wouldUpdate}.`), { status: 409 });
      const after = await evidence(tx, rows.map((row) => row.itemCode));
      if (stable(before) !== stable(after)) throw new Error("Competitor or Needs Review snapshots changed during name update; transaction rolled back.");
      const historyAfter = Number((await tx.select({ count: sql<number>`count(*)` }).from(mrpPriceHistoryTable))[0]?.count ?? 0);
      if (historyBefore !== historyAfter) throw new Error("mrp_price_history changed during name update; transaction rolled back.");
      const finalResult = { pendingBatchId: id, loadBatchId: load.id, rowsRead: rows.length, updated, alreadyCorrect, skipped, pricesWritten: 0, competitorRowsTouched: 0, productsCreated: 0 };
      await tx.update(mrpLoadBatchesTable).set({ rowCount: rows.length, loadedBy: actor(req), notes: JSON.stringify({ kind: "P024_name_changes", status: "APPLIED", competitorSnapshot: stable(before), historyCount: historyBefore }) }).where(eq(mrpLoadBatchesTable.id, load.id));
      await tx.update(mrpPendingBatchesTable).set({ status: "applied", appliedAt: new Date(), appliedBy: actor(req), result: JSON.stringify(finalResult) }).where(eq(mrpPendingBatchesTable.id, id));
      return finalResult;
    });
    return res.json({ ok: true, result });
  } catch (error: any) {
    req.log.error({ err: error }, "P024 name change apply failed");
    return res.status(error.status ?? 409).json({ error: error instanceof Error ? error.message : "Could not apply name changes." });
  }
});

router.post("/catalog/name-changes/:batchId/undo", requireAdmin, async (req, res): Promise<any> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid batch id." });
  try {
    const result = await db.transaction(async (tx) => {
      const load = (await tx.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, id)).limit(1).for("update"))[0];
      const source = load ? (await tx.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.id, load.sourceId)).limit(1))[0] : null;
      if (!load || !source || source.sheetId !== SOURCE.sheetId || load.fileSha256 !== EXPECTED_SHA256) {
        throw Object.assign(new Error("Undo batch does not belong to the P024 name-change flow."), { status: 409 });
      }
      const historyBefore = Number((await tx.select({ count: sql<number>`count(*)` }).from(mrpPriceHistoryTable))[0]?.count ?? 0);
      const rows = await tx.select().from(catalogProductNameCorrectionsTable).where(eq(catalogProductNameCorrectionsTable.loadBatchId, id)).for("update");
      if (!rows.length) throw Object.assign(new Error("No applied name changes found for this batch."), { status: 404 });
      if (rows.some((row) => row.undoneAt)) throw Object.assign(new Error("This name-change batch has already been undone."), { status: 409 });
      for (const row of rows) {
        const changed = await tx.update(catalogProductsTable).set({ productName: row.previousName, updatedAt: new Date() }).where(and(
          eq(catalogProductsTable.itemCode, row.itemCode),
          eq(catalogProductsTable.productName, row.correctedName),
        )).returning({ itemCode: catalogProductsTable.itemCode });
        if (changed.length !== 1) throw Object.assign(new Error(`Undo refused for ${row.itemCode}: current name changed.`), { status: 409 });
      }
      await tx.update(catalogProductNameCorrectionsTable).set({ undoneAt: new Date(), undoneBy: actor(req) }).where(eq(catalogProductNameCorrectionsTable.loadBatchId, id));
      const historyAfter = Number((await tx.select({ count: sql<number>`count(*)` }).from(mrpPriceHistoryTable))[0]?.count ?? 0);
      if (historyBefore !== historyAfter) throw new Error("mrp_price_history changed during name undo; transaction rolled back.");
      return { batchId: id, undone: rows.length };
    });
    return res.json({ ok: true, result });
  } catch (error: any) {
    return res.status(error.status ?? 409).json({ error: error instanceof Error ? error.message : "Could not undo name changes." });
  }
});

export default router;