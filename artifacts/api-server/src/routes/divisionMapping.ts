import { Router, type IRouter } from "express";
import multer from "multer";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, catalogProductsTable, bucketListsTable, mrpGeneratorScenariosTable, mrpSourcesTable, mrpLoadBatchesTable, mrpPendingBatchesTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";
import { digest, divisionPreview, divisionCatalogueState, assertDivisionApplyChanges, parseDivisionMapping, validateDivisionRows, REVIEWED_DIVISION_SHA256, DIVISION_SOURCE_KEY, type DivisionRow } from "../lib/divisionMapping";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const fields = { itemCode: catalogProductsTable.itemCode, division: catalogProductsTable.division, productName: catalogProductsTable.productName, category: catalogProductsTable.category, seriesRange: catalogProductsTable.seriesRange };
const failure = (error: unknown) => error instanceof Error ? error.message : "Division operation failed.";
const json = (value: string) => JSON.parse(value);

async function scopeGuard(tx: any, preview: ReturnType<typeof divisionPreview>) {
  const moving = new Set(preview.changes.flatMap(r => [r.from, r.to]));
  const buckets = await tx.select({ name: bucketListsTable.name, rules: bucketListsTable.rules }).from(bucketListsTable);
  const scenarios = await tx.select({ name: mrpGeneratorScenariosTable.name, scope: mrpGeneratorScenariosTable.scope,
    divisions: sql`jsonb_path_query_array(${mrpGeneratorScenariosTable.rules}::jsonb, '$.**.division')`,
    divisionSets: sql`jsonb_path_query_array(${mrpGeneratorScenariosTable.rules}::jsonb, '$.**.divisions')`,
  }).from(mrpGeneratorScenariosTable);
  function affected(value: unknown): boolean {
    // Scenario scopes are stored as JSON text; bucket rules are native jsonb.
    if (typeof value === "string") {
      try { return affected(JSON.parse(value)); } catch { return false; }
    }
    if (Array.isArray(value)) return value.some(affected);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, child]) => {
      if (key === "division" || key === "divisions") return (Array.isArray(child) ? child : [child]).some(v => typeof v === "string" && moving.has(v));
      return affected(child);
    });
  }
  const impacted = [...buckets.filter((r: any) => affected(r.rules)), ...scenarios.filter((r: any) =>
    affected(r.scope) || affected({ division: r.divisions, divisions: r.divisionSets.flat() }))];
  if (impacted.length) throw new Error(`Saved division scope would change meaning: ${impacted.map(r => r.name).join(", ")}. Review before applying.`);
}

router.use("/catalog/division-mapping", requireAdmin);
router.get("/catalog/division-mapping", async (_req, res): Promise<any> => {
  const source = (await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, DIVISION_SOURCE_KEY)))[0];
  if (!source) return res.json({ batches: [] });
  const batches = await db.select({ id: mrpPendingBatchesTable.id, fileName: mrpPendingBatchesTable.fileName, status: mrpPendingBatchesTable.status,
    loadBatchId: mrpPendingBatchesTable.loadBatchId, createdAt: mrpPendingBatchesTable.createdAt,
  }).from(mrpPendingBatchesTable).where(eq(mrpPendingBatchesTable.sourceId, source.id)).orderBy(desc(mrpPendingBatchesTable.id)).limit(50);
  return res.json({ batches });
});
router.post("/catalog/division-mapping/preview", upload.single("file"), async (req, res): Promise<any> => {
  try {
    if (!req.file) throw new Error("Upload the reviewed v3 mapping workbook.");
    const downloadedAt = String(req.body.downloadedAt ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(downloadedAt) || Number.isNaN(Date.parse(downloadedAt)) || new Date(downloadedAt).toISOString().slice(0, 10) !== downloadedAt) throw new Error("Supply the actual workbook download date (YYYY-MM-DD).");
    const rows = parseDivisionMapping(req.file.buffer);
    const result = await db.transaction(async tx => {
      const preview = divisionPreview(rows, await tx.select(fields).from(catalogProductsTable));
      await scopeGuard(tx, preview);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${DIVISION_SOURCE_KEY}))`);
      let source = (await tx.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, DIVISION_SOURCE_KEY)))[0];
      if (!source) source = (await tx.insert(mrpSourcesTable).values({ division: "Catalogue division mapping", sheetId: DIVISION_SOURCE_KEY,
        sheetUrl: "internal://catalogue/division-mapping", notes: "Division only; exact codes; no price access; reviewed v3 workbook." }).returning())[0]!;
      const load = (await tx.insert(mrpLoadBatchesTable).values({ sourceId: source.id, fileName: req.file!.originalname, fileSha256: REVIEWED_DIVISION_SHA256,
        fileSizeBytes: req.file!.size, downloadedAt, loadedBy: req.user!.id, rowCount: preview.changes.length, notes: JSON.stringify({ kind: "division_mapping", status: "PREVIEW" }),
      }).returning())[0]!;
      const pending = (await tx.insert(mrpPendingBatchesTable).values({ sourceId: source.id, fileName: req.file!.originalname, fileSha256: REVIEWED_DIVISION_SHA256,
        fileSizeBytes: req.file!.size, downloadedAt, uploadedBy: req.user!.id, payload: JSON.stringify(rows), preview: JSON.stringify(preview),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), loadBatchId: load.id,
      }).returning())[0]!;
      return { id: pending.id, loadBatchId: load.id, status: pending.status, preview };
    });
    return res.json(result);
  } catch (e) { return res.status(400).json({ error: failure(e) }); }
});

router.get("/catalog/division-mapping/:id", async (req, res): Promise<any> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid preview id." });
  const source = (await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, DIVISION_SOURCE_KEY)))[0];
  const pending = source && (await db.select().from(mrpPendingBatchesTable).where(and(eq(mrpPendingBatchesTable.id, id), eq(mrpPendingBatchesTable.sourceId, source.id))))[0];
  if (!pending) return res.status(404).json({ error: "Division batch not found." });
  return res.json({ id, loadBatchId: pending.loadBatchId, status: pending.status, preview: json(pending.preview), result: pending.result ? json(pending.result) : null });
});

for (const action of ["apply", "undo"] as const) router.post(`/catalog/division-mapping/:id/${action}`, async (req, res): Promise<any> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || req.body?.confirm !== true) return res.status(400).json({ error: "Valid preview id and explicit confirm=true are required." });
  try {
    const result = await db.transaction(async tx => {
      const source = (await tx.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, DIVISION_SOURCE_KEY)))[0];
      if (!source) throw new Error("Division source not found.");
      const pending = (await tx.select().from(mrpPendingBatchesTable).where(and(eq(mrpPendingBatchesTable.id, id), eq(mrpPendingBatchesTable.sourceId, source.id))).for("update"))[0];
      if (!pending || !pending.loadBatchId || pending.fileSha256 !== REVIEWED_DIVISION_SHA256) throw new Error("Not a reviewed division preview.");
      const load = (await tx.select().from(mrpLoadBatchesTable).where(and(eq(mrpLoadBatchesTable.id, pending.loadBatchId), eq(mrpLoadBatchesTable.sourceId, source.id))).for("update"))[0];
      if (!load || load.fileSha256 !== pending.fileSha256) throw new Error("Invalid batch provenance.");
      if (action === "apply" && (pending.status !== "pending" || pending.expiresAt < new Date())) throw new Error("Preview used, expired or no longer pending.");
      if (action === "undo" && pending.status !== "applied") throw new Error("Only an applied division batch can be undone once.");
      await tx.execute(sql`LOCK TABLE catalog_products IN SHARE ROW EXCLUSIVE MODE`);
      const products = await tx.select(fields).from(catalogProductsTable);
      const preview = json(pending.preview) as ReturnType<typeof divisionPreview>;
      const rows = validateDivisionRows(json(pending.payload) as DivisionRow[]);
      if (digest(rows) !== preview.payloadFingerprint) throw new Error("Staged content fingerprint changed; refused.");
      if (action === "apply") {
        const fresh = divisionPreview(rows, products);
        assertDivisionApplyChanges(preview.changes, fresh.changes);
        await scopeGuard(tx, fresh);
      } else {
        const byCode = new Map(products.map(p => [p.itemCode, p.division]));
        if (preview.changes.some(c => !byCode.has(c.itemCode) || byCode.get(c.itemCode) !== c.to)) throw new Error("A target changed after apply; undo refused without overwriting later edits.");
      }
      for (const c of preview.changes) {
        const from = action === "apply" ? c.from : c.to, to = action === "apply" ? c.to : c.from;
        const changed = await tx.update(catalogProductsTable).set({ division: to }).where(and(
          eq(catalogProductsTable.itemCode, c.itemCode), sql`${catalogProductsTable.division} IS NOT DISTINCT FROM ${from}`,
        )).returning({ itemCode: catalogProductsTable.itemCode });
        if (changed.length !== 1) throw new Error(`Concurrent change at exact code ${c.itemCode}; rolled back.`);
      }
      const after = await tx.select(fields).from(catalogProductsTable);
      // Undo intentionally restores captured originals, including composite strings.
      // Apply may write only its exact reviewed targets, each a single valid division.
      if (action === "apply") {
        const byCode = new Map(after.map(p => [p.itemCode, p.division]));
        if (preview.changes.some(c => !byCode.has(c.itemCode) || byCode.get(c.itemCode) !== c.to))
          throw new Error("Applied target differs from the reviewed division; rolled back.");
      }
      const counts = (rows: typeof products) => rows.reduce<Record<string, number>>((out, p) => {
        const key = p.division ?? "(blank)"; out[key] = (out[key] ?? 0) + 1; return out;
      }, {});
      const result = { changed: preview.changes.length, loadBatchId: load.id, status: action === "apply" ? "applied" : "undone", pricesRead: 0, pricesWritten: 0,
        before: counts(products), after: counts(after),
        catalogueBefore: divisionCatalogueState(products), catalogueAfter: divisionCatalogueState(after) };
      await tx.update(mrpPendingBatchesTable).set({ status: result.status, result: JSON.stringify(result),
        ...(action === "apply" ? { appliedAt: new Date(), appliedBy: req.user!.id } : { discardedAt: new Date(), discardedBy: req.user!.id }),
      }).where(eq(mrpPendingBatchesTable.id, id));
      await tx.update(mrpLoadBatchesTable).set({ notes: JSON.stringify({ kind: "division_mapping", status: result.status, previewId: id, actor: req.user!.id,
        fileSha256: pending.fileSha256, payloadFingerprint: preview.payloadFingerprint, catalogueFingerprint: preview.catalogueFingerprint, result }) }).where(eq(mrpLoadBatchesTable.id, load.id));
      return result;
    });
    return res.json({ ok: true, result });
  } catch (e) { return res.status(409).json({ error: failure(e) }); }
});
export default router;
