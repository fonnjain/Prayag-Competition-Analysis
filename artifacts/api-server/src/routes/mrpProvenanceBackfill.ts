import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { requireAdmin } from "../middlewares/authMiddleware";
import {
  db,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpProvenanceBackfillRunsTable,
  mrpSourcesTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();
const ORIGIN = "retrospective legacy NULL load_batch_id";
const instant = (value: unknown): string | null =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

type LegacyRow = {
  id: number; itemCode: string; mrp: number | null; netPrice: number | null;
  discountPct: number | null; priceBasis: string; effectiveDate: string;
  loadDate: string; sourceFile: string | null; isCurrent: boolean;
  notes: string | null; reviewStatus: string; reviewReasons: string | null;
  importBatchId: string | null; variant: string; lastRevisionBatchId: number | null;
  reviewedAt: string | null; loadBatchId: number | null;
  actor: string | null; createdAt: string | null;
};

async function legacyRows(executor: { execute: Function } = db, lock = false): Promise<LegacyRow[]> {
  const result = await executor.execute(sql`
      SELECT h.id, h.item_code AS "itemCode", h.mrp,
        h.net_price AS "netPrice", h.discount_pct AS "discountPct",
        h.price_basis AS "priceBasis", h.effective_date AS "effectiveDate",
        h.load_date AS "loadDate", h.source_file AS "sourceFile",
        h.is_current AS "isCurrent", h.notes, h.review_status AS "reviewStatus",
        h.review_reasons AS "reviewReasons", h.import_batch_id AS "importBatchId",
        h.variant, h.last_revision_batch_id AS "lastRevisionBatchId",
        h.reviewed_at AS "reviewedAt", h.load_batch_id AS "loadBatchId",
        a.actor, a.created_at AS "createdAt"
    FROM mrp_price_history h
    LEFT JOIN LATERAL (
      SELECT c.actor, c.created_at
      FROM catalog_price_edit_audits c
      WHERE c.target_row_id = h.id AND c.item_code = h.item_code
        AND c.series = 'Prayag MRP' AND c.effective_date = h.effective_date
        AND c.operation_type = 'save' AND c.old_value IS NULL
      ORDER BY c.created_at DESC, c.id DESC LIMIT 1
    ) a ON TRUE
    WHERE h.load_batch_id IS NULL
    ORDER BY h.id ${lock ? sql`FOR UPDATE OF h` : sql``}
  `);
  return (result.rows as LegacyRow[]).map((row) => ({
    ...row,
    reviewedAt: instant(row.reviewedAt),
    createdAt: instant(row.createdAt),
  }));
}

async function fullTableStats() {
  const result = await db.execute(sql`SELECT * FROM mrp_price_history ORDER BY id`);
  const values = await db.execute(sql`
    SELECT id, item_code, mrp, net_price, discount_pct, price_basis,
      effective_date, variant
    FROM mrp_price_history ORDER BY id
  `);
  return {
    rowCount: result.rows.length,
    sha256: createHash("sha256").update(JSON.stringify(result.rows)).digest("hex"),
    valueOnlySha256: createHash("sha256").update(JSON.stringify(values.rows)).digest("hex"),
  };
}

function report(rows: LegacyRow[]) {
  const groups = new Map<string, LegacyRow[]>();
  for (const row of rows) {
    const key = row.actor?.trim() && row.createdAt ? `${row.actor.trim()}|${row.createdAt}` : "UNKNOWN";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const canonical = (r: LegacyRow) => JSON.stringify([
    r.id, r.itemCode, r.mrp, r.netPrice, r.discountPct, r.priceBasis, r.effectiveDate,
    r.loadDate, r.sourceFile, r.isCurrent, r.notes, r.reviewStatus, r.reviewReasons,
    r.importBatchId, r.variant, r.lastRevisionBatchId,
    instant(r.reviewedAt),
    r.loadBatchId, r.actor, instant(r.createdAt),
  ]);
  const valuePayload = rows.map((r) => `${r.itemCode}|${r.effectiveDate}|${r.mrp ?? ""}`).join("\n");
  const existingPayload = rows.map(canonical).join("\n");
  return {
    rowCount: rows.length,
    batchCount: groups.size,
    actorCoverage: {
      knownRows: rows.filter((r) => r.actor?.trim() && r.createdAt).length,
      unknownRows: rows.filter((r) => !(r.actor?.trim() && r.createdAt)).length,
    },
    valueOnlyChecksum: createHash("sha256").update(valuePayload).digest("hex"),
    existingChecksum: createHash("sha256").update(existingPayload).digest("hex"),
    origins: [...groups].map(([key, members]) => ({
      origin: key === "UNKNOWN" ? { actor: "not recorded", createdAt: null } : { actor: members[0]!.actor, createdAt: members[0]!.createdAt },
      rowCount: members.length,
      rowIds: members.map((r) => r.id),
    })),
  };
}

router.get("/admin/mrp-provenance-backfill/preview", requireAdmin, async (_req, res): Promise<any> => {
  const rows = await legacyRows();
  return res.json({ ok: true, ...report(rows), rows, fullTableBefore: await fullTableStats() });
});

router.post("/admin/mrp-provenance-backfill/apply", requireAdmin, async (req, res): Promise<any> => {
  const rows = await legacyRows();
  if (!rows.length) return res.json({ ok: true, status: "nothing_to_apply", rowCount: 0 });
  const expected = req.body?.existingChecksum;
  const preview = report(rows);
  if (typeof expected !== "string" || expected !== preview.existingChecksum) {
    return res.status(409).json({ error: "Preview is stale; apply requires the exact existing checksum." });
  }
  const actor = req.user?.email ?? req.user?.id ?? "unknown";
  const result = await db.transaction(async (tx) => {
    const lockedRows = await legacyRows(tx, true);
    const lockedReport = report(lockedRows);
    if (lockedRows.length !== rows.length || lockedReport.existingChecksum !== preview.existingChecksum) {
      throw Object.assign(new Error("Eligible rows changed while waiting for lock; preview is stale."), { status: 409 });
    }
    const [source] = await tx.insert(mrpSourcesTable).values({
      division: "Retrospective legacy provenance",
      sheetId: "retrospective-legacy-provenance",
      sheetUrl: "about:blank",
      expectedFileName: null,
      notes: "Internal retrospective linkage; no source file, hash, or creation timestamp was inferred.",
      sourceKind: "manual",
    }).onConflictDoNothing({ target: mrpSourcesTable.sheetId }).returning({ id: mrpSourcesTable.id });
    const sourceRow = source ?? (await tx.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(sql`${mrpSourcesTable.sheetId} = 'retrospective-legacy-provenance'`).limit(1))[0]!;
    const batches: Array<{ id: number; rowIds: number[] }> = [];
    for (const origin of lockedReport.origins) {
      const members = lockedRows.filter((r) => (origin.origin.createdAt && origin.origin.actor) ? r.actor === origin.origin.actor && r.createdAt === origin.origin.createdAt : !(r.actor?.trim() && r.createdAt));
      const [batch] = await tx.insert(mrpLoadBatchesTable).values({
        sourceId: sourceRow.id, fileName: null, fileSha256: null, fileSizeBytes: null,
        downloadedAt: null, loadedBy: actor, rowCount: members.length,
        notes: JSON.stringify({ origin: ORIGIN, actor: origin.origin.actor, createdAt: origin.origin.createdAt, creationTimeStatus: origin.origin.createdAt ? "known_from_catalog_price_edit_audit" : "UNKNOWN" }),
      }).returning({ id: mrpLoadBatchesTable.id });
      await tx.execute(sql`UPDATE mrp_price_history SET load_batch_id = ${batch.id} WHERE id IN (${sql.join(members.map((r) => sql`${r.id}`), sql`, `)}) AND load_batch_id IS NULL`);
      batches.push({ id: batch.id, rowIds: members.map((r) => r.id) });
    }
    const [run] = await tx.insert(mrpProvenanceBackfillRunsTable).values({
      status: "applied", actor, preview: JSON.stringify(lockedReport), snapshot: JSON.stringify({ rows: lockedRows, batches }),
      appliedAt: new Date(),
    }).returning({ id: mrpProvenanceBackfillRunsTable.id });
    return { runId: run.id, batchIds: batches.map((b) => b.id) };
  });
  return res.json({ ok: true, ...result, rowCount: rows.length, fullTableAfter: await fullTableStats() });
});

router.post("/admin/mrp-provenance-backfill/undo/:runId", requireAdmin, async (req, res): Promise<any> => {
  const runId = Number(req.params.runId);
  if (!Number.isInteger(runId)) return res.status(400).json({ error: "Invalid run id." });
  const result = await db.transaction(async (tx) => {
    const run = (await tx.select().from(mrpProvenanceBackfillRunsTable).where(sql`${mrpProvenanceBackfillRunsTable.id} = ${runId}`).limit(1).for("update"))[0];
    if (!run || run.status !== "applied") throw Object.assign(new Error("Backfill run is missing or already undone."), { status: 409 });
    const snapshot = JSON.parse(run.snapshot) as { rows: LegacyRow[]; batches: Array<{ id: number; rowIds: number[] }> };
    const assigned = new Map<number, number>();
    for (const batch of snapshot.batches) for (const rowId of batch.rowIds) assigned.set(rowId, batch.id);
    for (const row of snapshot.rows) {
      const batchId = assigned.get(row.id);
      const current = (await tx.execute(sql`SELECT * FROM mrp_price_history WHERE id = ${row.id} FOR UPDATE`)).rows[0] as Record<string, unknown> | undefined;
      if (!current || current.load_batch_id !== batchId) {
        throw Object.assign(new Error(`Row ${row.id} changed after backfill; undo rejected.`), { status: 409 });
      }
      const snapshotValues = [row.itemCode, row.mrp, row.netPrice, row.discountPct, row.priceBasis, row.effectiveDate,
        row.loadDate, row.sourceFile, row.isCurrent, row.notes, row.reviewStatus, row.reviewReasons,
        row.importBatchId, row.variant, row.lastRevisionBatchId, row.reviewedAt];
      const currentValues = [current.item_code, current.mrp, current.net_price, current.discount_pct, current.price_basis,
        current.effective_date, current.load_date, current.source_file, current.is_current, current.notes,
        current.review_status, current.review_reasons, current.import_batch_id, current.variant,
         current.last_revision_batch_id, instant(current.reviewed_at)];
      if (JSON.stringify(snapshotValues) !== JSON.stringify(currentValues)) {
        throw Object.assign(new Error(`Row ${row.id} changed after backfill; undo rejected.`), { status: 409 });
      }
      const audit = (await tx.execute(sql`
        SELECT actor, created_at AS "createdAt"
        FROM catalog_price_edit_audits
        WHERE target_row_id = ${row.id} AND series = 'Prayag MRP'
          AND item_code = ${row.itemCode} AND effective_date = ${row.effectiveDate}
           AND operation_type = 'save' AND old_value IS NULL
        ORDER BY created_at DESC, id DESC LIMIT 1
      `)).rows[0] as { actor: string | null; createdAt: unknown } | undefined;
      if ((audit?.actor ?? null) !== (row.actor ?? null) ||
          instant(audit?.createdAt) !== instant(row.createdAt)) {
        throw Object.assign(new Error(`Audit provenance for row ${row.id} changed; undo rejected.`), { status: 409 });
      }
      await tx.execute(sql`UPDATE mrp_price_history SET load_batch_id = NULL WHERE id = ${row.id} AND load_batch_id = ${batchId}`);
    }
    await tx.update(mrpProvenanceBackfillRunsTable).set({ status: "undone", undoneAt: new Date() }).where(sql`${mrpProvenanceBackfillRunsTable.id} = ${runId}`);
    return { runId, restoredRows: snapshot.rows.length };
  });
  return res.json({ ok: true, ...result, fullTableAfterUndo: await fullTableStats() });
});

router.use((error: any, _req: any, res: any, _next: any) => {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({ error: error?.message ?? "MRP provenance backfill failed." });
});

export default router;