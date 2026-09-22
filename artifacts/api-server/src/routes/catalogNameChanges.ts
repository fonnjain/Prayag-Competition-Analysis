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
export const EXPECTED_SHA256 = "cfde963bce3b9123a47cffb4a66a37edb7eebaccddd1d379a8f1a9b2415baaac";
const FILE_NAME = "Prayag_Name_Changes_v2_01Sep2026.xlsx";
export const SOURCE = {
  division: "Catalogue Name Changes",
  sheetId: "__catalogue_name_changes__",
  sheetUrl: "internal://catalogue-name-changes",
  notes: "P026r2 controlled product-name correction workbook.",
  sourceKind: "name_changes_p026r2",
} as const;
export const MANUAL_SOURCE = {
  division: "Catalogue Name Changes (Manual)",
  sheetId: "__catalogue_name_changes_manual__",
  sheetUrl: "internal://catalogue-name-changes/manual",
  notes: "P026r2 single product-name editor.",
  sourceKind: "name_changes_manual",
} as const;
const actor = (req: Request) => req.user?.email ?? req.user?.id ?? "unknown";
const today = () => new Date().toISOString().slice(0, 10);
const text = (value: unknown) => String(value ?? "").trim();
const MAX_NAME_LENGTH = 500;
const FORBIDDEN_SINGLE_FIELDS = new Set(["mrp", "price", "mrp_unchanged", "new_mrp", "net_price", "effectiveDate", "effective_date", "division", "series", "category", "size"]);
type P026TransactionTestHook = (tx: any, itemCodes: string[]) => Promise<void> | void;
let p026TransactionTestHook: P026TransactionTestHook | undefined;

/** Test-only seam for proving the transaction checksum guards are atomic. */
export function setP026TransactionTestHook(hook?: P026TransactionTestHook) {
  if (process.env.NODE_ENV !== "test") throw new Error("P026 transaction hooks are test-only.");
  p026TransactionTestHook = hook;
}
export const isCompleteP026Preview = (rowCount: number) => rowCount === 155;

export interface NameChangeRow {
  itemCode: string;
  oldName: string;
  newName: string;
  reason?: string;
  trimmed?: boolean;
}

export function parseLogicalNameChangeRows(rows: Array<Record<string, unknown>>): NameChangeRow[] {
  return rows.map((row, index) => {
    const parsed = {
      itemCode: text(row.item_code),
      oldName: text(row.old_name),
      newName: text(row.new_name),
    };
    if (!parsed.itemCode || !parsed.newName || !parsed.oldName) throw new Error(`Invalid name change row ${index + 2}.`);
    return parsed;
  });
}

export function parseNameChangesWorkbook(buffer: Buffer): NameChangeRow[] {
  const sha = createHash("sha256").update(buffer).digest("hex");
  if (sha !== EXPECTED_SHA256) throw new Error(`Workbook SHA-256 mismatch: expected ${EXPECTED_SHA256}, received ${sha}.`);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets.name_changes;
  if (!sheet) throw new Error("Workbook must contain the name_changes sheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const required = ["item_code", "old_name", "new_name"];
  if (!rows.length || required.some((key) => !(key in rows[0]!))) {
    throw new Error(`name_changes must contain columns: ${required.join(", ")}.`);
  }
  return parseLogicalNameChangeRows(rows);
}

function stable(value: unknown) {
  return JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item);
}

function isDiscontinued(product: { discontinuedFrom?: string | null; isActive?: boolean }) {
  return !product.isActive || Boolean(product.discontinuedFrom && product.discontinuedFrom <= today());
}

async function ensureSource(tx: typeof db, sourceDefinition: typeof SOURCE | typeof MANUAL_SOURCE = SOURCE) {
  const existing = (await tx.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, sourceDefinition.sheetId)).limit(1))[0];
  if (existing) return existing;
  return (await tx.insert(mrpSourcesTable).values(sourceDefinition).returning())[0]!;
}

async function evidence(executor: any, codes: string[]) {
  const [competitors, needsReview] = await Promise.all([
    executor.select().from(competitorPricesTable).where(inArray(competitorPricesTable.matchedPrayagCode, codes)).orderBy(asc(competitorPricesTable.id)),
    executor.select().from(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.status, "needs_review")).orderBy(asc(competitorPriceStagingTable.id)),
  ]);
  return { competitors, needsReview };
}

export function previewFor(rows: NameChangeRow[], products: Array<typeof catalogProductsTable.$inferSelect>, options?: { allowDiscontinued?: boolean }) {
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
      if (!options?.allowDiscontinued && isDiscontinued(product)) reasons.push("discontinued/inactive product");
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

export function singleInput(body: unknown): NameChangeRow {
  if (!body || typeof body !== "object") throw new Error("A JSON name-change payload is required.");
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_SINGLE_FIELDS.has(key)) throw new Error(`Forbidden field: ${key}.`);
  }
  const allowed = new Set(["itemCode", "oldName", "newName", "reason"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Payload contains an unknown field.");
  const itemCode = text(input.itemCode);
  const oldName = text(input.oldName);
  const rawNewName = String(input.newName ?? "");
  const newName = rawNewName.trim();
  const reason = text(input.reason);
  if (!itemCode || !oldName || !newName) throw new Error("itemCode, oldName, and newName are required.");
  if (!reason) throw new Error("Reason is required.");
  if (newName.length > MAX_NAME_LENGTH || oldName.length > MAX_NAME_LENGTH || reason.length > MAX_NAME_LENGTH) throw new Error(`Name and reason fields are limited to ${MAX_NAME_LENGTH} characters.`);
  return { itemCode, oldName, newName, reason, trimmed: rawNewName !== newName };
}

async function priceEvidence(executor: any, codes: string[]) {
  const rows = await executor.select().from(mrpPriceHistoryTable)
    .where(inArray(mrpPriceHistoryTable.itemCode, codes))
    .orderBy(asc(mrpPriceHistoryTable.itemCode), asc(mrpPriceHistoryTable.id));
  return { count: rows.length, checksum: createHash("sha256").update(stable(rows)).digest("hex") };
}

router.get("/catalog/name-changes/products", requireAdmin, async (req, res): Promise<any> => {
  const query = text(req.query.q);
  if (!query) return res.json({ products: [] });
  const products = await db.select({
    itemCode: catalogProductsTable.itemCode, productName: catalogProductsTable.productName,
    division: catalogProductsTable.division, series: catalogProductsTable.seriesRange,
    size: catalogProductsTable.size, discontinuedFrom: catalogProductsTable.discontinuedFrom,
    isActive: catalogProductsTable.isActive,
    currentMrp: sql<number | null>`(SELECT mrp FROM mrp_price_history WHERE item_code = ${catalogProductsTable.itemCode} AND variant = 'Standard' AND review_status = 'approved' AND effective_date <= CURRENT_DATE ORDER BY effective_date DESC, id DESC LIMIT 1)`,
  }).from(catalogProductsTable)
    .where(sql`${catalogProductsTable.itemCode} ILIKE ${"%" + query + "%"} OR ${catalogProductsTable.productName} ILIKE ${"%" + query + "%"}`)
    .limit(25);
  return res.json({
    products: products.map(({ isActive, ...product }) => ({
      ...product,
      discontinued: isDiscontinued({ isActive, discontinuedFrom: product.discontinuedFrom }),
    })),
  });
});

router.post("/catalog/name-changes/single/preview", requireAdmin, async (req, res): Promise<any> => {
  try {
    const row = singleInput(req.body);
    const product = (await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, row.itemCode)).limit(1))[0];
    if (!product) return res.status(404).json({ error: "Product not found." });
    const current = text(product.productName);
    if (current !== row.oldName) return res.status(409).json({ error: "Current name changed since edit was loaded.", submittedOldName: row.oldName, expectedOldName: row.oldName, currentName: current });
    if (row.newName === current) return res.json({ noop: true, message: "No-op: the new name is already current; nothing was written.", preview: { ...previewFor([row], [product], { allowDiscontinued: true }), trimmed: row.trimmed } });
    const source = await ensureSource(db, MANUAL_SOURCE);
    const load = (await db.insert(mrpLoadBatchesTable).values({
      sourceId: source.id, fileName: "P026r2-manual-name-edit", fileSha256: "manual",
      fileSizeBytes: 0, downloadedAt: today(), loadedBy: actor(req), rowCount: 1,
      notes: JSON.stringify({ kind: "P026r2_name_changes_manual", status: "PREVIEW" }),
    }).returning({ id: mrpLoadBatchesTable.id }))[0]!;
    const duplicateCount = (await db.select({ count: sql<number>`count(*)` }).from(catalogProductsTable).where(eq(catalogProductsTable.productName, row.newName)))[0]?.count ?? 0;
    const preview = { ...previewFor([row], [product], { allowDiscontinued: true }), duplicateNameCount: Number(duplicateCount), discontinued: isDiscontinued(product), trimmed: row.trimmed };
    const pending = (await db.insert(mrpPendingBatchesTable).values({
      sourceId: source.id, fileName: "P026r2-manual-name-edit", fileSha256: "manual", fileSizeBytes: 0,
      downloadedAt: today(), uploadedBy: actor(req), payload: JSON.stringify([row]), preview: JSON.stringify(preview),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), loadBatchId: load.id,
    }).returning({ id: mrpPendingBatchesTable.id }))[0]!;
    await db.update(mrpLoadBatchesTable).set({ notes: JSON.stringify({ kind: "P026r2_name_changes_manual", status: "PREVIEW", pendingBatchId: pending.id }) }).where(eq(mrpLoadBatchesTable.id, load.id));
    return res.json({ pendingBatchId: pending.id, loadBatchId: load.id, preview });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Could not preview name edit." });
  }
});

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
      notes: JSON.stringify({ kind: "P026r2_name_changes", status: "PREVIEW" }),
    }).returning({ id: mrpLoadBatchesTable.id }))[0]!;
    loadBatchId = load.id;
    const rows = parseNameChangesWorkbook(req.file.buffer);
    const duplicateCodes = rows.filter((row, i) => rows.findIndex((candidate) => candidate.itemCode === row.itemCode) !== i);
    if (rows.length !== 155) throw new Error(`Expected 155 rows; received ${rows.length}.`);
    if (duplicateCodes.length) throw new Error("Workbook contains duplicate item codes.");
    const products = await db.select().from(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, rows.map((row) => row.itemCode)));
     const fullPreview = previewFor(rows, products);
    const pending = (await db.insert(mrpPendingBatchesTable).values({
      sourceId: source.id, fileName: req.file.originalname, fileSha256: EXPECTED_SHA256,
      fileSizeBytes: req.file.size, downloadedAt: today(), uploadedBy: actor(req),
      payload: JSON.stringify(rows), preview: JSON.stringify(fullPreview),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), loadBatchId,
    }).returning({ id: mrpPendingBatchesTable.id }))[0]!;
    await db.update(mrpLoadBatchesTable).set({
      rowCount: rows.length,
       notes: JSON.stringify({ kind: "P026r2_name_changes", status: "PREVIEW", pendingBatchId: pending.id }),
    }).where(eq(mrpLoadBatchesTable.id, loadBatchId));
    return res.json({ pendingBatchId: pending.id, loadBatchId, fileName: req.file.originalname, fileSha256: EXPECTED_SHA256, preview: fullPreview });
  } catch (error) {
    if (loadBatchId) await db.update(mrpLoadBatchesTable).set({
       notes: JSON.stringify({ kind: "P026r2_name_changes", status: "REJECTED_PREVIEW", error: error instanceof Error ? error.message : "invalid workbook" }),
    }).where(eq(mrpLoadBatchesTable.id, loadBatchId));
    return res.status(400).json({ error: error instanceof Error ? error.message : "Could not preview workbook." });
  }
});

router.get("/catalog/name-changes/audit", requireAdmin, async (_req, res): Promise<any> => {
  const sourceRows = await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable)
    .where(inArray(mrpSourcesTable.sheetId, [SOURCE.sheetId, MANUAL_SOURCE.sheetId]));
  const rows = await db.select().from(mrpLoadBatchesTable).where(inArray(mrpLoadBatchesTable.sourceId, sourceRows.map((source) => source.id)));
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
      const isManual = source?.sheetId === MANUAL_SOURCE.sheetId && load?.fileSha256 === "manual";
      if (!load || !source || (!isManual && (source.sheetId !== SOURCE.sheetId || load.fileSha256 !== EXPECTED_SHA256 || !isCompleteP026Preview(load.rowCount))) || (isManual && load.rowCount !== 1)) {
        throw Object.assign(new Error("Preview provenance does not belong to the P026r2 name-change flow."), { status: 409 });
      }
      const products = await tx.select().from(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, rows.map((row) => row.itemCode)));
      const basePreview = previewFor(rows, products, { allowDiscontinued: isManual });
      const preview = isManual ? {
        ...basePreview,
        duplicateNameCount: Number((await tx.select({ count: sql<number>`count(*)` }).from(catalogProductsTable).where(eq(catalogProductsTable.productName, rows[0]!.newName)))[0]?.count ?? 0),
        discontinued: products[0] ? isDiscontinued(products[0]) : false,
        trimmed: rows[0]!.trimmed ?? false,
      } : basePreview;
      if (stable(preview) !== stable(originalPreview)) {
        if (isManual) {
          const currentName = text(products[0]?.productName);
          throw Object.assign(new Error("Current name changed after preview; apply refused."), {
            status: 409,
            submittedOldName: rows[0]?.oldName ?? "",
            expectedOldName: rows[0]?.oldName ?? "",
            currentName,
          });
        }
        throw Object.assign(new Error("Preview no longer matches the current catalogue."), { status: 409 });
      }
      const historyBefore = await priceEvidence(tx, rows.map((row) => row.itemCode));
      const before = await evidence(tx, rows.map((row) => row.itemCode));
      let updated = 0;
      let alreadyCorrect = 0;
      let skipped = 0;
      for (const row of rows) {
        const product = products.find((candidate) => candidate.itemCode === row.itemCode);
        if (!product || (!isManual && isDiscontinued(product))) {
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
          ...(isManual ? [] : [eq(catalogProductsTable.isActive, true)]),
        )).returning({ itemCode: catalogProductsTable.itemCode });
        if (!changed.length) { skipped += 1; continue; }
        updated += 1;
        await tx.insert(catalogProductNameCorrectionsTable).values({
          correctionKey: `p024:${load.id}:${row.itemCode}`,
          itemCode: row.itemCode,
          previousName: row.oldName,
          correctedName: row.newName,
          reason: `P026r2: ${row.reason ?? "controlled name correction"}`,
          loadBatchId: load.id,
          actor: actor(req),
        });
      }
      if (p026TransactionTestHook) await p026TransactionTestHook(tx, rows.map((row) => row.itemCode));
      if (updated !== preview.wouldUpdate) throw Object.assign(new Error(`Apply changed ${updated} rows, but immutable preview required ${preview.wouldUpdate}.`), { status: 409 });
      const after = await evidence(tx, rows.map((row) => row.itemCode));
      if (stable(before) !== stable(after)) throw new Error("Competitor or Needs Review snapshots changed during name update; transaction rolled back.");
      const historyAfter = await priceEvidence(tx, rows.map((row) => row.itemCode));
      if (stable(historyBefore) !== stable(historyAfter)) throw new Error("mrp_price_history changed during name update; transaction rolled back.");
      const finalResult = { pendingBatchId: id, loadBatchId: load.id, rowsRead: rows.length, updated, alreadyCorrect, skipped, pricesWritten: 0, competitorRowsTouched: 0, productsCreated: 0 };
      await tx.update(mrpLoadBatchesTable).set({ rowCount: rows.length, loadedBy: actor(req), notes: JSON.stringify({ kind: "P026r2_name_changes", status: "APPLIED", competitorSnapshot: stable(before), history: historyBefore }) }).where(eq(mrpLoadBatchesTable.id, load.id));
      await tx.update(mrpPendingBatchesTable).set({ status: "applied", appliedAt: new Date(), appliedBy: actor(req), result: JSON.stringify(finalResult) }).where(eq(mrpPendingBatchesTable.id, id));
      return finalResult;
    });
    return res.json({ ok: true, result });
  } catch (error: any) {
    req.log?.error({ err: error }, "P026r2 name change apply failed");
    return res.status(error.status ?? 409).json({
      error: error instanceof Error ? error.message : "Could not apply name changes.",
      ...(error.submittedOldName !== undefined ? {
        submittedOldName: error.submittedOldName,
        expectedOldName: error.expectedOldName,
        currentName: error.currentName,
      } : {}),
    });
  }
});

router.post("/catalog/name-changes/:batchId/undo", requireAdmin, async (req, res): Promise<any> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid batch id." });
  try {
    const result = await db.transaction(async (tx) => {
      const load = (await tx.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, id)).limit(1).for("update"))[0];
      const source = load ? (await tx.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.id, load.sourceId)).limit(1))[0] : null;
      const isManual = source?.sheetId === MANUAL_SOURCE.sheetId && load?.fileSha256 === "manual";
      if (!load || !source || (!isManual && (source.sheetId !== SOURCE.sheetId || load.fileSha256 !== EXPECTED_SHA256))) {
        throw Object.assign(new Error("Undo batch does not belong to the P026r2 name-change flow."), { status: 409 });
      }
      const historyBefore = await priceEvidence(tx, (await tx.select({ itemCode: catalogProductNameCorrectionsTable.itemCode }).from(catalogProductNameCorrectionsTable).where(eq(catalogProductNameCorrectionsTable.loadBatchId, id))).map((row) => row.itemCode));
      const rows = await tx.select().from(catalogProductNameCorrectionsTable).where(eq(catalogProductNameCorrectionsTable.loadBatchId, id)).for("update");
      if (!rows.length) throw Object.assign(new Error("No applied name changes found for this batch."), { status: 404 });
      if (rows.some((row) => row.undoneAt)) throw Object.assign(new Error("This name-change batch has already been undone."), { status: 409 });
      const codes = rows.map((row) => row.itemCode);
      const evidenceBefore = await evidence(tx, codes);
      for (const row of rows) {
        const changed = await tx.update(catalogProductsTable).set({ productName: row.previousName, updatedAt: new Date() }).where(and(
          eq(catalogProductsTable.itemCode, row.itemCode),
          eq(catalogProductsTable.productName, row.correctedName),
        )).returning({ itemCode: catalogProductsTable.itemCode });
        if (changed.length !== 1) throw Object.assign(new Error(`Undo refused for ${row.itemCode}: current name changed.`), { status: 409 });
      }
      await tx.update(catalogProductNameCorrectionsTable).set({ undoneAt: new Date(), undoneBy: actor(req) }).where(eq(catalogProductNameCorrectionsTable.loadBatchId, id));
      const evidenceAfter = await evidence(tx, codes);
      if (stable(evidenceBefore) !== stable(evidenceAfter)) throw new Error("Competitor or Needs Review snapshots changed during name undo; transaction rolled back.");
      const historyAfter = await priceEvidence(tx, rows.map((row) => row.itemCode));
      if (stable(historyBefore) !== stable(historyAfter)) throw new Error("mrp_price_history changed during name undo; transaction rolled back.");
      return { batchId: id, undone: rows.length };
    });
    return res.json({ ok: true, result });
  } catch (error: any) {
    return res.status(error.status ?? 409).json({ error: error instanceof Error ? error.message : "Could not undo name changes." });
  }
});

export default router;