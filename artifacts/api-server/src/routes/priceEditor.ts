import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  catalogProductsTable,
  catalogPriceEditAuditsTable,
  mrpPriceHistoryTable,
  mrpLoadBatchesTable,
  competitorPricesTable,
  competitorPriceStagingTable,
  mrpHistoryProvenanceEventsTable,
  newProductPreviewStatesTable,
  competitorCodeAliasesTable,
  importBatchesTable,
  mrpRevisionBatchesTable,
  mrpRevisionRowsTable,
  mrpGeneratorRunsTable,
  mrpGeneratorResultsTable,
  mrpSourcesTable,
  locallyAddedDivisionsTable,
  locallyAddedCategoriesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";
import {
  recomputeCurrentFlagsInTransaction,
  recomputeCompetitorCurrentFlagsInTransaction,
} from "../lib/catalog";
import { warningFor } from "./mrpRevision";
import { sha256ForManualCorrection } from "../lib/mrpProvenance";

const router: IRouter = Router();
const iso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const today = () => new Date().toISOString().slice(0, 10);
const actor = (req: Request) => req.user?.email ?? req.user?.id ?? "unknown";
const normalizeNewCode = (value: unknown) => String(value ?? "").toUpperCase().replace(/\s+/g, "").replace(/\.0$/, "");
const normalizeVocabularyKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ")
  .toLocaleLowerCase("en").replace(/[\p{P}\p{S}]/gu, " ").trim().replace(/\s+/g, " ")
  .split(" ").filter(Boolean).map((word) => {
    if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }).join(" ");
const SALES_KNOWN_DIVISIONS = [
  "Pipes & Fittings",
  "PTMT & Plastic Fittings",
  "CP Fittings / Faucets",
  "Hardware",
  "Ceramic Sanitaryware",
  "CP (QUAA / FERN)",
  "QUAA & FERN",
];
const UNKNOWN_SALES_DIVISION_WARNING = "This division is not known to the Sales application. Products in it will not appear in Sales reporting until it is mapped there.";
function duplicateVocabulary(existingValue: string) {
  return { code: "VOCABULARY_DUPLICATE", existingValue };
}
const editDistance = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const prior = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = prior;
    }
  }
  return row[b.length]!;
};

async function product(code: string) {
  return (await db.select().from(catalogProductsTable)
    .where(eq(catalogProductsTable.itemCode, code)).limit(1))[0];
}

async function resolveMrp(code: string, date: string) {
  return (await db.select().from(mrpPriceHistoryTable).where(and(
    eq(mrpPriceHistoryTable.itemCode, code), eq(mrpPriceHistoryTable.variant, "Standard"),
    eq(mrpPriceHistoryTable.reviewStatus, "approved"),
    sql`${mrpPriceHistoryTable.effectiveDate} <= ${date}`,
  )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id)).limit(1))[0] ?? null;
}

async function resolveCompetitor(code: string, brand: string, date: string) {
  return (await db.select().from(competitorPricesTable).where(and(
    eq(competitorPricesTable.matchedPrayagCode, code), eq(competitorPricesTable.competitor, brand),
    sql`${competitorPricesTable.effectiveDate} <= ${date}`,
  )).orderBy(desc(competitorPricesTable.effectiveDate), desc(competitorPricesTable.id)).limit(1))[0] ?? null;
}

async function previousMrp(code: string, effectiveDate: string) {
  return (await db.select().from(mrpPriceHistoryTable).where(and(
    eq(mrpPriceHistoryTable.itemCode, code), eq(mrpPriceHistoryTable.variant, "Standard"),
    eq(mrpPriceHistoryTable.reviewStatus, "approved"),
    sql`${mrpPriceHistoryTable.effectiveDate} < ${effectiveDate}`,
  )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id)).limit(1))[0] ?? null;
}

async function previousCompetitor(code: string, brand: string, effectiveDate: string) {
  return (await db.select().from(competitorPricesTable).where(and(
    eq(competitorPricesTable.matchedPrayagCode, code), eq(competitorPricesTable.competitor, brand),
    sql`${competitorPricesTable.effectiveDate} < ${effectiveDate}`,
  )).orderBy(desc(competitorPricesTable.effectiveDate), desc(competitorPricesTable.id)).limit(1))[0] ?? null;
}

export function dateMeaning(date: string, exists: boolean) {
  if (exists) return { operation: "correction", wording: "This corrects the existing price for this period." };
  if (date <= today()) return { operation: "immediate", wording: "This takes effect immediately." };
  return { operation: "scheduled", wording: "This is scheduled; the current price remains until then." };
}

async function editorProduct(req: Request, res: any) {
  const code = String(req.query.itemCode ?? "").trim();
  if (!code) return res.status(400).json({ error: "itemCode is required." });
  const p = await product(code);
  if (!p) return res.status(404).json({ error: "Product not found." });
  const asOf = iso(req.query.asOf) ? String(req.query.asOf) : today();
  const [mrp, competitors] = await Promise.all([
    resolveMrp(code, asOf),
    db.select({ competitor: competitorPricesTable.competitor }).from(competitorPricesTable)
      .where(sql`${competitorPricesTable.competitor} is not null`)
      .groupBy(competitorPricesTable.competitor).orderBy(asc(competitorPricesTable.competitor)),
  ]);
  const series = await Promise.all(competitors.map(async ({ competitor }) => {
    const current = await resolveCompetitor(code, competitor, asOf);
    const previous = current ? await previousCompetitor(code, competitor, String(current.effectiveDate)) : null;
    return {
      series: competitor, current, previous,
    };
  }));
  const mrpPrevious = mrp ? await previousMrp(code, String(mrp.effectiveDate)) : null;
  const edits = await db.select().from(catalogPriceEditAuditsTable)
    .where(eq(catalogPriceEditAuditsTable.itemCode, code))
    .orderBy(desc(catalogPriceEditAuditsTable.createdAt), desc(catalogPriceEditAuditsTable.id)).limit(20);
  return res.json({ product: p, series: [{ series: "Prayag MRP", current: mrp, previous: mrpPrevious }, ...series], recentEdits: edits });
}

router.get("/catalog/price-editor/product", requireAdmin, editorProduct);
router.get("/catalog/price-editor/edits", requireAdmin, async (req, res): Promise<any> => {
  const code = String(req.query.itemCode ?? "").trim();
  if (!code) return res.status(400).json({ error: "itemCode is required." });
  res.json({ edits: await db.select().from(catalogPriceEditAuditsTable)
    .where(eq(catalogPriceEditAuditsTable.itemCode, code))
    .orderBy(desc(catalogPriceEditAuditsTable.createdAt), desc(catalogPriceEditAuditsTable.id)).limit(50) });
});

router.post("/catalog/price-editor/preview", requireAdmin, async (req, res): Promise<any> => {
  const code = String(req.body?.itemCode ?? "").trim();
  const series = String(req.body?.series ?? "").trim();
  const value = Number(req.body?.value);
  const effectiveDate = String(req.body?.effectiveDate ?? "");
  if (!code || !series || !Number.isFinite(value) || value <= 0 || !iso(effectiveDate)) {
    return res.status(400).json({ error: "itemCode, series, positive value, and valid effectiveDate are required." });
  }
  const p = await product(code);
  if (!p) return res.status(404).json({ error: "Product not found." });
  if (series !== "Prayag MRP") {
    const configured = await db.select({ competitor: competitorPricesTable.competitor }).from(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, series)).limit(1);
    if (!configured[0]) return res.status(404).json({ error: "Competitor is not configured." });
  }
  const old = series === "Prayag MRP" ? await resolveMrp(code, effectiveDate) : await resolveCompetitor(code, series, effectiveDate);
  const exact = series === "Prayag MRP"
    ? (await db.select().from(mrpPriceHistoryTable).where(and(eq(mrpPriceHistoryTable.itemCode, code), eq(mrpPriceHistoryTable.effectiveDate, effectiveDate), eq(mrpPriceHistoryTable.variant, "Standard"), eq(mrpPriceHistoryTable.reviewStatus, "approved"))).limit(1))[0]
    : (await db.select().from(competitorPricesTable).where(and(eq(competitorPricesTable.matchedPrayagCode, code), eq(competitorPricesTable.competitor, series), eq(competitorPricesTable.effectiveDate, effectiveDate))).limit(1))[0];
  const previous = old
    ? (series === "Prayag MRP"
      ? (old as typeof mrpPriceHistoryTable.$inferSelect).mrp
      : (old as typeof competitorPricesTable.$inferSelect).price)
    : null;
  const priorResolved = series === "Prayag MRP"
    ? await previousMrp(code, effectiveDate)
    : await previousCompetitor(code, series, effectiveDate);
  const previousResolvedValue = priorResolved
    ? (series === "Prayag MRP"
      ? (priorResolved as typeof mrpPriceHistoryTable.$inferSelect).mrp
      : (priorResolved as typeof competitorPricesTable.$inferSelect).price)
    : null;
  const warnings = warningFor(code, p.division, previous, value);
  const prayag = series === "Prayag MRP" ? value : (await resolveMrp(code, effectiveDate))?.mrp ?? null;
  const gapPct = series === "Prayag MRP" || prayag == null ? null : ((value - prayag) / prayag) * 100;
  const existingSameDateValue = exact
    ? (series === "Prayag MRP"
      ? (exact as typeof mrpPriceHistoryTable.$inferSelect).mrp
      : (exact as typeof competitorPricesTable.$inferSelect).price)
    : null;
  return res.json({ itemCode: code, series, value, previous, previousResolvedValue, effectiveDate, existingSameDateValue,
    dateMeaning: dateMeaning(effectiveDate, !!exact), warnings, competitorGapPct: gapPct, currentUntil: effectiveDate > today() ? (old?.effectiveDate ?? null) : null,
    firstCompetitorMapping: series !== "Prayag MRP" && !(await db.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(and(eq(competitorPricesTable.competitor, series), eq(competitorPricesTable.matchedPrayagCode, code))).limit(1))[0] });
});

router.post("/catalog/price-editor/save", requireAdmin, async (req, res): Promise<any> => {
  const code = String(req.body?.itemCode ?? "").trim();
  const series = String(req.body?.series ?? "").trim();
  const value = Number(req.body?.value);
  const effectiveDate = String(req.body?.effectiveDate ?? "");
  const remarks = typeof req.body?.remarks === "string" ? req.body.remarks.trim() : "";
  if (!remarks) return res.status(400).json({ error: "Remarks are required." });
  if (!code || !series || !Number.isFinite(value) || value <= 0 || !iso(effectiveDate)) return res.status(400).json({ error: "Invalid price edit." });
  const p = await product(code);
  if (!p) return res.status(404).json({ error: "Product not found." });
  if (series !== "Prayag MRP" && !(await db.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(eq(competitorPricesTable.competitor, series)).limit(1))[0])
    return res.status(404).json({ error: "Competitor is not configured." });
  let hadCompetitorMapping = false;
  let previousResolvedValue: number | null = null;
  try {
    const audit = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"price-editor:" + code + ":" + series}))`);
      hadCompetitorMapping = series !== "Prayag MRP" &&
        !!(await tx.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
          .where(and(eq(competitorPricesTable.competitor, series), eq(competitorPricesTable.matchedPrayagCode, code))).limit(1))[0];
      const resolvedBefore = series === "Prayag MRP"
        ? (await tx.select().from(mrpPriceHistoryTable).where(and(
          eq(mrpPriceHistoryTable.itemCode, code), eq(mrpPriceHistoryTable.variant, "Standard"),
          eq(mrpPriceHistoryTable.reviewStatus, "approved"),
          sql`${mrpPriceHistoryTable.effectiveDate} <= ${effectiveDate}`,
        )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id)).limit(1).for("update"))[0]
        : (await tx.select().from(competitorPricesTable).where(and(
          eq(competitorPricesTable.competitor, series), eq(competitorPricesTable.matchedPrayagCode, code),
          sql`${competitorPricesTable.effectiveDate} <= ${effectiveDate}`,
        )).orderBy(desc(competitorPricesTable.effectiveDate), desc(competitorPricesTable.id)).limit(1).for("update"))[0];
      const resolvedValue = resolvedBefore
        ? (series === "Prayag MRP"
          ? (resolvedBefore as typeof mrpPriceHistoryTable.$inferSelect).mrp
          : (resolvedBefore as typeof competitorPricesTable.$inferSelect).price)
        : null;
      const priorResolved = series === "Prayag MRP"
        ? (resolvedBefore ? (await tx.select().from(mrpPriceHistoryTable).where(and(
          eq(mrpPriceHistoryTable.itemCode, code), eq(mrpPriceHistoryTable.variant, "Standard"),
          eq(mrpPriceHistoryTable.reviewStatus, "approved"),
          sql`${mrpPriceHistoryTable.effectiveDate} < ${resolvedBefore.effectiveDate}`,
        )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id)).limit(1))[0] : null)
        : (resolvedBefore ? (await tx.select().from(competitorPricesTable).where(and(
          eq(competitorPricesTable.competitor, series), eq(competitorPricesTable.matchedPrayagCode, code),
          sql`${competitorPricesTable.effectiveDate} < ${resolvedBefore.effectiveDate}`,
        )).orderBy(desc(competitorPricesTable.effectiveDate), desc(competitorPricesTable.id)).limit(1))[0] : null);
      previousResolvedValue = priorResolved
        ? (series === "Prayag MRP"
          ? (priorResolved as typeof mrpPriceHistoryTable.$inferSelect).mrp
          : (priorResolved as typeof competitorPricesTable.$inferSelect).price)
        : null;
      let old: number | null = null; let rowId: number; let mutation = 0; let targetWasExisting = false;
      let previousLoadBatchId: number | null = null;
      let provenanceBatchId: number | null = null;
      if (series === "Prayag MRP") {
        const [manualSource] = await tx.insert(mrpSourcesTable).values({
          division: "Manual MRP corrections", sheetId: "manual-mrp-corrections",
          sheetUrl: "about:blank", expectedFileName: null,
          notes: "Internal audit source for reviewed corrections without an official workbook.",
          sourceKind: "manual",
        }).onConflictDoNothing({ target: mrpSourcesTable.sheetId }).returning({ id: mrpSourcesTable.id });
        const manualSourceId = manualSource?.id ?? (await tx.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable)
          .where(eq(mrpSourcesTable.sheetId, "manual-mrp-corrections")).limit(1))[0]?.id;
        if (!manualSourceId) throw new Error("Manual MRP provenance source could not be created.");
        const existing = (await tx.select().from(mrpPriceHistoryTable).where(and(eq(mrpPriceHistoryTable.itemCode, code), eq(mrpPriceHistoryTable.effectiveDate, effectiveDate), eq(mrpPriceHistoryTable.variant, "Standard"), eq(mrpPriceHistoryTable.reviewStatus, "approved"))).limit(1).for("update"))[0];
        old = existing?.mrp ?? null; targetWasExisting = !!existing; previousLoadBatchId = existing?.loadBatchId ?? null;
        // The MRP provenance batch is deliberately separate from competitor
        // import batches; source metadata is an internal correction record.
        const [provenance] = await tx.insert(mrpLoadBatchesTable).values({
          sourceId: manualSourceId!,
          fileName: `manual-correction:${code}:${effectiveDate}`,
          fileSha256: null,
          fileSizeBytes: null,
          downloadedAt: null,
          loadedBy: actor(req),
          rowCount: 1,
          notes: `Single-product editor correction: ${remarks}; content hash: ${sha256ForManualCorrection({ itemCode: code, effectiveDate, mrp: value, reason: remarks })}`,
        }).returning({ id: mrpLoadBatchesTable.id });
        provenanceBatchId = provenance.id;
        if (existing) { const rows = await tx.update(mrpPriceHistoryTable).set({ mrp: value, notes: remarks }).where(eq(mrpPriceHistoryTable.id, existing.id)).returning({ id: mrpPriceHistoryTable.id }); rowId = rows[0]!.id; mutation = rows.length; }
        else { const rows = await tx.insert(mrpPriceHistoryTable).values({ itemCode: code, mrp: value, netPrice: null, discountPct: null, priceBasis: "MRP", effectiveDate, loadDate: today(), sourceFile: "single-product-editor", loadBatchId: provenanceBatchId, reviewStatus: "approved", variant: "Standard", notes: remarks }).returning({ id: mrpPriceHistoryTable.id }); rowId = rows[0]!.id; mutation = rows.length; }
        if (existing) await tx.update(mrpPriceHistoryTable).set({ loadBatchId: provenanceBatchId }).where(eq(mrpPriceHistoryTable.id, existing.id));
        await tx.insert(mrpHistoryProvenanceEventsTable).values({
          historyRowId: rowId, itemCode: code, effectiveDate, action: "manual_correction",
          reason: remarks, sourceFile: "single-product-editor", loadBatchId: provenanceBatchId,
          previousMrp: old, mrp: value,
        });
      } else {
        const existing = (await tx.select().from(competitorPricesTable).where(and(eq(competitorPricesTable.matchedPrayagCode, code), eq(competitorPricesTable.competitor, series), eq(competitorPricesTable.effectiveDate, effectiveDate))).limit(1).for("update"))[0];
        old = existing?.price ?? null; targetWasExisting = !!existing;
        previousLoadBatchId = existing?.loadBatchId ?? null;
        const [manualSource] = await tx.insert(mrpSourcesTable).values({
          division: "Manual competitor corrections", sheetId: "manual-competitor-corrections",
          sheetUrl: "about:blank", expectedFileName: null,
          notes: "Internal audit source for reviewed competitor corrections.",
          sourceKind: "manual",
        }).onConflictDoNothing({ target: mrpSourcesTable.sheetId }).returning({ id: mrpSourcesTable.id });
        const manualSourceId = manualSource?.id ?? (await tx.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable)
          .where(eq(mrpSourcesTable.sheetId, "manual-competitor-corrections")).limit(1))[0]?.id;
        if (!manualSourceId) throw new Error("Manual competitor provenance source could not be created.");
        const [provenance] = await tx.insert(mrpLoadBatchesTable).values({
          sourceId: manualSourceId, fileName: `manual-competitor-correction:${series}:${code}:${effectiveDate}`,
          fileSha256: null, fileSizeBytes: null, downloadedAt: null, loadedBy: actor(req), rowCount: 1,
          notes: `Single-product competitor correction: ${remarks}`,
        }).returning({ id: mrpLoadBatchesTable.id });
        if (!provenance) throw new Error("Manual competitor provenance batch could not be created.");
        provenanceBatchId = provenance.id;
        if (existing) { const rows = await tx.update(competitorPricesTable).set({ price: value, loadBatchId: provenanceBatchId, updatedAt: new Date() }).where(eq(competitorPricesTable.id, existing.id)).returning({ id: competitorPricesTable.id }); rowId = rows[0]!.id; mutation = rows.length; }
        else { const rows = await tx.insert(competitorPricesTable).values({ competitor: series, price: value, effectiveDate, matchedPrayagCode: code, loadBatchId: provenanceBatchId, matchStatus: "matched", codeSource: "unverified", description: p.productName, category: p.category, size: p.size }).returning({ id: competitorPricesTable.id }); rowId = rows[0]!.id; mutation = rows.length; }
      }
      if (mutation !== 1) throw new Error("Price edit changed an unexpected number of rows.");
      if (!targetWasExisting) previousResolvedValue = resolvedValue;
      if (series === "Prayag MRP") await recomputeCurrentFlagsInTransaction(tx);
      else await recomputeCompetitorCurrentFlagsInTransaction(series, tx);
        return (await tx.insert(catalogPriceEditAuditsTable).values({ actor: actor(req), itemCode: code, series, operationType: "save", oldValue: old, previousResolvedValue, newValue: value, effectiveDate, remarks, targetRowId: rowId, creationMetadata: JSON.stringify({ provenanceBatchId, previousLoadBatchId }) }).returning())[0]!;
    });
    res.json({ ok: true, audit, firstCompetitorMapping: series !== "Prayag MRP" && !hadCompetitorMapping });
  } catch (e) { req.log.error({ err: e }, "single price save failed"); res.status(409).json({ error: e instanceof Error ? e.message : "Could not save price." }); }
});

router.post("/catalog/price-editor/undo/:auditId", requireAdmin, async (req, res): Promise<any> => {
  const id = Number(req.params.auditId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid audit id." });
  try {
    const reversal = await db.transaction(async (tx) => {
      const original = (await tx.select().from(catalogPriceEditAuditsTable).where(eq(catalogPriceEditAuditsTable.id, id)).limit(1))[0];
      if (!original || original.operationType !== "save") throw Object.assign(new Error("Original edit not found."), { status: 404 });
      const already = await tx.select({ id: catalogPriceEditAuditsTable.id }).from(catalogPriceEditAuditsTable).where(eq(catalogPriceEditAuditsTable.originalAuditId, id)).limit(1);
      if (already[0]) throw Object.assign(new Error("Edit has already been undone."), { status: 409 });
      if (!original.targetRowId) throw Object.assign(new Error("Original edit has no target row."), { status: 409 });
      if (original.newValue == null) throw Object.assign(new Error("Original edit has no value; undo rejected."), { status: 409 });
      if (original.series === "Prayag MRP") {
        const metadata = original.creationMetadata ? JSON.parse(original.creationMetadata) as { previousLoadBatchId?: number | null } : {};
        if (original.oldValue != null && !original.creationMetadata) {
          throw Object.assign(new Error("Legacy edit lacks prior provenance metadata; undo rejected to protect the existing batch."), { status: 409 });
        }
        const target = (await tx.select().from(mrpPriceHistoryTable).where(and(
          eq(mrpPriceHistoryTable.id, original.targetRowId),
          eq(mrpPriceHistoryTable.itemCode, original.itemCode),
          eq(mrpPriceHistoryTable.variant, "Standard"),
          eq(mrpPriceHistoryTable.effectiveDate, original.effectiveDate),
        )).for("update"))[0];
        if (!target || target.mrp !== original.newValue) throw Object.assign(new Error("Target MRP changed or is missing; undo rejected."), { status: 409 });
        if (original.oldValue == null) {
          const deleted = await tx.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.id, target.id)).returning({ id: mrpPriceHistoryTable.id });
          if (deleted.length !== 1) throw Object.assign(new Error("Undo changed an unexpected number of MRP rows."), { status: 409 });
        } else {
          if (metadata.previousLoadBatchId == null) {
            throw Object.assign(new Error("Undo rejected: prior MRP provenance is missing and load_batch_id cannot be null."), { status: 409 });
          }
          const updated = await tx.update(mrpPriceHistoryTable).set({ mrp: original.oldValue, loadBatchId: metadata.previousLoadBatchId }).where(and(eq(mrpPriceHistoryTable.id, target.id), eq(mrpPriceHistoryTable.mrp, original.newValue))).returning({ id: mrpPriceHistoryTable.id });
          if (updated.length !== 1) throw Object.assign(new Error("Undo changed an unexpected number of MRP rows."), { status: 409 });
        }
      } else {
        const target = (await tx.select().from(competitorPricesTable).where(and(
          eq(competitorPricesTable.id, original.targetRowId),
          eq(competitorPricesTable.competitor, original.series),
          eq(competitorPricesTable.matchedPrayagCode, original.itemCode),
          eq(competitorPricesTable.effectiveDate, original.effectiveDate),
        )).for("update"))[0];
        if (!target || target.price !== original.newValue) throw Object.assign(new Error("Target competitor price changed or is missing; undo rejected."), { status: 409 });
        if (original.oldValue == null) {
          const deleted = await tx.delete(competitorPricesTable).where(eq(competitorPricesTable.id, target.id)).returning({ id: competitorPricesTable.id });
          if (deleted.length !== 1) throw Object.assign(new Error("Undo changed an unexpected number of competitor rows."), { status: 409 });
        } else {
          const metadata = original.creationMetadata ? JSON.parse(original.creationMetadata) as { previousLoadBatchId?: number | null } : {};
          if (!original.creationMetadata || !Object.prototype.hasOwnProperty.call(metadata, "previousLoadBatchId")) {
            throw Object.assign(new Error("Undo rejected: prior competitor provenance is missing; existing batch must be preserved."), { status: 409 });
          }
          const updated = await tx.update(competitorPricesTable).set({ price: original.oldValue, loadBatchId: metadata.previousLoadBatchId ?? null, updatedAt: new Date() }).where(and(eq(competitorPricesTable.id, target.id), eq(competitorPricesTable.price, original.newValue))).returning({ id: competitorPricesTable.id });
          if (updated.length !== 1) throw Object.assign(new Error("Undo changed an unexpected number of competitor rows."), { status: 409 });
        }
      }
      if (original.series === "Prayag MRP") await recomputeCurrentFlagsInTransaction(tx);
      else await recomputeCompetitorCurrentFlagsInTransaction(original.series, tx);
      return (await tx.insert(catalogPriceEditAuditsTable).values({ actor: actor(req), itemCode: original.itemCode, series: original.series, operationType: "reversal", oldValue: original.newValue, newValue: original.oldValue, effectiveDate: original.effectiveDate, remarks: `Undo of edit #${id}`, originalAuditId: id, targetRowId: original.targetRowId }).returning())[0]!;
    });
    res.json({ ok: true, reversal });
  } catch (e: any) { res.status(e.status ?? 409).json({ error: e.message ?? "Could not undo edit." }); }
});

// P020: one-product creation stays beside the correction editor.  These routes
// intentionally never accept a competitor name or write competitor_prices.
router.get("/catalog/price-editor/new-product/options", requireAdmin, async (_req, res): Promise<any> => {
  const rows = await db.select({
    division: catalogProductsTable.division,
    series: catalogProductsTable.seriesRange,
    category: catalogProductsTable.category,
  }).from(catalogProductsTable).where(eq(catalogProductsTable.isActive, true));
  const addedDivisions = await db.select().from(locallyAddedDivisionsTable).orderBy(asc(locallyAddedDivisionsTable.name));
  const addedCategories = await db.select().from(locallyAddedCategoriesTable).orderBy(asc(locallyAddedCategoriesTable.name));
  const divisions = [...new Set([
    ...rows.map((r) => r.division).filter((v): v is string => !!v),
    ...addedDivisions.map((d) => d.name),
  ])].sort();
  const categories = [...new Set([
    ...rows.map((r) => r.category).filter((v): v is string => !!v),
    ...addedCategories.map((c) => c.name),
  ])].sort();
  const series = [...new Set(rows.map((r) => r.series).filter((v): v is string => !!v))].sort();
  const byDivision = divisions.map((division) => ({
    division,
    categories: [...new Set([
      ...rows.filter((r) => r.division === division).map((r) => r.category).filter((v): v is string => !!v),
      ...addedCategories.filter((c) => c.divisionKey === normalizeVocabularyKey(division)).map((c) => c.name),
    ])].sort(),
    series: [...new Set(rows.filter((r) => r.division === division).map((r) => r.series).filter((v): v is string => !!v))].sort(),
  }));
  const locallyAdded = addedDivisions.map(({ name, actor: createdBy, createdAt, reason }) => ({
    name, actor: createdBy, createdAt, reason, salesMapped: SALES_KNOWN_DIVISIONS.includes(name),
  }));
  return res.json({ divisions, categories, series, byDivision, locallyAddedDivisions: locallyAdded, salesKnownDivisions: SALES_KNOWN_DIVISIONS });
});

router.post("/catalog/price-editor/divisions", requireAdmin, async (req, res): Promise<any> => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) return res.status(400).json({ error: "Reason is required." });
  if (!name) return res.status(400).json({ error: "Name is required." });
  const normalizedKey = normalizeVocabularyKey(name);
  if (!normalizedKey) return res.status(400).json({ error: "Name must contain letters or numbers." });
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"price-editor:vocabulary"}))`);
      const productDivisions = await tx.select({ division: catalogProductsTable.division }).from(catalogProductsTable)
        .where(sql`${catalogProductsTable.division} is not null`);
      const duplicateProduct = productDivisions.find((row) => row.division && normalizeVocabularyKey(row.division) === normalizedKey);
      const duplicateAdded = (await tx.select().from(locallyAddedDivisionsTable)
        .where(eq(locallyAddedDivisionsTable.normalizedKey, normalizedKey)).limit(1))[0];
      if (duplicateProduct || duplicateAdded) {
        return { conflict: duplicateVocabulary(duplicateProduct?.division ?? duplicateAdded!.name) };
      }
      // Sales uses an exact string lookup, not our near-duplicate normalizer.
      const salesMapped = SALES_KNOWN_DIVISIONS.includes(name);
      const [created] = await tx.insert(locallyAddedDivisionsTable).values({
        name, normalizedKey, actor: actor(req), reason, salesMapped,
      }).returning();
      return {
        name: created!.name, actor: created!.actor, createdAt: created!.createdAt,
        reason: created!.reason, salesMapped: created!.salesMapped,
        warning: created!.salesMapped ? null : UNKNOWN_SALES_DIVISION_WARNING,
      };
    });
    if ("conflict" in result) return res.status(409).json(result.conflict);
    return res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === "23505") {
      const existing = (await db.select().from(locallyAddedDivisionsTable)
        .where(eq(locallyAddedDivisionsTable.normalizedKey, normalizedKey)).limit(1))[0];
      if (existing) return res.status(409).json(duplicateVocabulary(existing.name));
    }
    req.log.error({ err: e }, "local division creation failed");
    return res.status(409).json({ error: "Could not add division." });
  }
});

router.post("/catalog/price-editor/categories", requireAdmin, async (req, res): Promise<any> => {
  const divisionInput = typeof req.body?.division === "string" ? req.body.division.trim() : "";
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) return res.status(400).json({ error: "Reason is required." });
  if (!divisionInput) return res.status(400).json({ error: "Division is required." });
  if (!name) return res.status(400).json({ error: "Name is required." });
  const divisionKey = normalizeVocabularyKey(divisionInput);
  const normalizedKey = normalizeVocabularyKey(name);
  if (!normalizedKey) return res.status(400).json({ error: "Name must contain letters or numbers." });
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"price-editor:vocabulary"}))`);
      const productDivisions = await tx.select({ division: catalogProductsTable.division }).from(catalogProductsTable)
        .where(sql`${catalogProductsTable.division} is not null`);
      const matchingDivision = productDivisions.find((row) => row.division === divisionInput)
        ?? productDivisions.find((row) => row.division && normalizeVocabularyKey(row.division) === divisionKey);
      const locallyAddedDivision = (await tx.select().from(locallyAddedDivisionsTable)
        .where(eq(locallyAddedDivisionsTable.normalizedKey, divisionKey)).limit(1))[0];
      const division = matchingDivision?.division ?? locallyAddedDivision?.name;
      if (!division) return { error: "Division must be selected from existing catalogue divisions or locally added divisions." };

      const products = await tx.select({ category: catalogProductsTable.category })
        .from(catalogProductsTable).where(eq(catalogProductsTable.division, division));
      const duplicateProduct = products.find((row) => row.category && normalizeVocabularyKey(row.category) === normalizedKey);
      const duplicateAdded = (await tx.select().from(locallyAddedCategoriesTable).where(and(
        eq(locallyAddedCategoriesTable.divisionKey, divisionKey),
        eq(locallyAddedCategoriesTable.normalizedKey, normalizedKey),
      )).limit(1))[0];
      if (duplicateProduct || duplicateAdded) {
        return { conflict: duplicateVocabulary(duplicateProduct?.category ?? duplicateAdded!.name) };
      }
      const [created] = await tx.insert(locallyAddedCategoriesTable).values({
        division, divisionKey, name, normalizedKey, actor: actor(req), reason,
      }).returning();
      return {
        division: created!.division, name: created!.name, actor: created!.actor,
        createdAt: created!.createdAt, reason: created!.reason,
      };
    });
    if ("error" in result) return res.status(400).json({ error: result.error });
    if ("conflict" in result) return res.status(409).json(result.conflict);
    return res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === "23505") {
      const existing = (await db.select().from(locallyAddedCategoriesTable).where(and(
        eq(locallyAddedCategoriesTable.divisionKey, divisionKey),
        eq(locallyAddedCategoriesTable.normalizedKey, normalizedKey),
      )).limit(1))[0];
      if (existing) return res.status(409).json(duplicateVocabulary(existing.name));
    }
    req.log.error({ err: e }, "local category creation failed");
    return res.status(409).json({ error: "Could not add category." });
  }
});

router.get("/catalog/price-editor/new-product/check", requireAdmin, async (req, res): Promise<any> => {
  const code = normalizeNewCode(req.query.itemCode);
  const division = String(req.query.division ?? "").trim();
  if (!code) return res.status(400).json({ error: "itemCode is required." });
  const products = await db.select({
    itemCode: catalogProductsTable.itemCode,
    productName: catalogProductsTable.productName,
    division: catalogProductsTable.division,
  }).from(catalogProductsTable);
  const duplicateBase = products.find((p) => normalizeNewCode(p.itemCode) === code);
  const duplicateMrp = duplicateBase ? await resolveMrp(duplicateBase.itemCode, today()) : null;
  const duplicate = duplicateBase ? {
    itemCode: duplicateBase.itemCode, productName: duplicateBase.productName,
    division: duplicateBase.division, category: (await product(duplicateBase.itemCode))?.category ?? null,
    series: (await product(duplicateBase.itemCode))?.seriesRange ?? null,
    currentMrp: duplicateMrp?.mrp ?? null, currentEffectiveDate: duplicateMrp?.effectiveDate ?? null,
    mrp: duplicateMrp?.mrp ?? null,
  } : null;
  const inDivision = products.filter((p) => !division || p.division === division);
  const closest = inDivision
    .map((p) => ({ itemCode: p.itemCode, distance: editDistance(code, normalizeNewCode(p.itemCode)) }))
    .sort((a, b) => a.distance - b.distance || a.itemCode.localeCompare(b.itemCode))
    .slice(0, 3);
  const unusual = closest.length > 0 && closest[0]!.distance > Math.max(2, Math.ceil(code.length * 0.55));
  return res.json({
    normalizedCode: code,
    duplicate,
    unusualShape: unusual,
    closest: closest.map(({ itemCode }) => itemCode),
  });
});

function newProductInput(body: any) {
  const itemCode = normalizeNewCode(body?.itemCode);
  const productName = String(body?.productName ?? "").trim();
  const division = String(body?.division ?? "").trim();
  const series = String(body?.series ?? "").trim();
  const category = String(body?.category ?? "").trim();
  const size = String(body?.size ?? "").trim() || null;
  const mrp = Number(body?.mrp);
  const effectiveDate = String(body?.effectiveDate ?? "");
  const reason = String(body?.reason ?? "").trim();
  const newSeriesConfirmed = body?.newSeriesConfirmed === true;
  const unusualCodeConfirmed = body?.unusualCodeConfirmed === true;
  return { itemCode, productName, division, series, category, size, mrp, effectiveDate, reason, newSeriesConfirmed, unusualCodeConfirmed };
}

async function creationReferences(q: any, code: string, auditId: number) {
  const refs: string[] = [];
  if ((await q.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(eq(competitorPricesTable.matchedPrayagCode, code))).length) refs.push("live competitor mapping");
  if ((await q.select({ id: competitorPriceStagingTable.id }).from(competitorPriceStagingTable).where(sql`${competitorPriceStagingTable.matchedPrayagCode} = ${code} OR ${competitorPriceStagingTable.competitorCodeCatalogue} = ${code}`)).length) refs.push("competitor staging");
  if ((await q.select({ id: competitorCodeAliasesTable.id }).from(competitorCodeAliasesTable).where(sql`${competitorCodeAliasesTable.oldCode} = ${code} OR ${competitorCodeAliasesTable.newCode} = ${code}`)).length) refs.push("competitor alias");
  if ((await q.select({ id: catalogPriceEditAuditsTable.id }).from(catalogPriceEditAuditsTable).where(and(eq(catalogPriceEditAuditsTable.itemCode, code), sql`${catalogPriceEditAuditsTable.id} <> ${auditId}`))).length) refs.push("later price/product audit");
  if ((await q.select({ id: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, code))).length > 1) refs.push("additional MRP history");
  if ((await q.select({ id: mrpRevisionRowsTable.id }).from(mrpRevisionRowsTable).where(eq(mrpRevisionRowsTable.itemCode, code))).length) refs.push("revision preview");
  if ((await q.select({ id: mrpRevisionBatchesTable.id }).from(mrpRevisionBatchesTable).where(sql`${mrpRevisionBatchesTable.fileName} LIKE ${"%" + code + "%"}`)).length) refs.push("revision batch");
  if ((await q.select({ id: mrpGeneratorResultsTable.id }).from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.itemCode, code))).length) refs.push("scenario result");
  if ((await q.select({ id: mrpGeneratorRunsTable.id }).from(mrpGeneratorRunsTable).where(sql`${mrpGeneratorRunsTable.inputSnapshot} LIKE ${"%" + code + "%"}`)).length) refs.push("scenario snapshot");
  return refs;
}

async function validateNewProductInput(input: ReturnType<typeof newProductInput>) {
  if (!input.itemCode || !input.productName || !input.division || !input.series || !input.category ||
      !Number.isFinite(input.mrp) || input.mrp <= 0 || !iso(input.effectiveDate) || !input.reason) {
    return "Code, product name, division, series, category, positive MRP, effective date, and reason are required.";
  }
  const products = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.isActive, true));
  const addedDivisions = await db.select({ name: locallyAddedDivisionsTable.name }).from(locallyAddedDivisionsTable);
  const addedCategories = await db.select({
    divisionKey: locallyAddedCategoriesTable.divisionKey,
    name: locallyAddedCategoriesTable.name,
  }).from(locallyAddedCategoriesTable);
  if (products.some((p) => normalizeNewCode(p.itemCode) === input.itemCode)) return `Code ${input.itemCode} already exists. Use the price editor above to change its price.`;
  const divisionExists = products.some((p) => p.division === input.division) ||
    addedDivisions.some((division) => division.name === input.division);
  if (!divisionExists) return "Division must be selected from the catalogue.";
  const categoryExists = products.some((p) => p.division === input.division && p.category === input.category) ||
    addedCategories.some((category) => category.divisionKey === normalizeVocabularyKey(input.division) && category.name === input.category);
  if (!categoryExists) return "Category must be selected from this division's catalogue.";
  const matchingSeries = products.some((p) => p.division === input.division && p.seriesRange === input.series);
  if (!matchingSeries && !input.newSeriesConfirmed) return `Series "${input.series}" is new in ${input.division}; explicit confirmation is required.`;
  return null;
}

router.post("/catalog/price-editor/new-product/preview", requireAdmin, async (req, res): Promise<any> => {
  const input = newProductInput(req.body);
  const error = await validateNewProductInput(input);
  if (error) return res.status(400).json({ error });
  const nearby = (await db.select({ series: catalogProductsTable.seriesRange }).from(catalogProductsTable)
    .where(eq(catalogProductsTable.division, input.division)))
    .map((r) => r.series).filter((v): v is string => !!v)
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((series) => ({ series, distance: editDistance(input.series.toUpperCase(), series.toUpperCase()) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 3).map(({ series }) => series);
  const period = await db.select({ id: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable)
    .where(and(eq(mrpPriceHistoryTable.effectiveDate, input.effectiveDate), eq(mrpPriceHistoryTable.variant, "Standard")));
  const divisionCodes = await db.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable)
    .where(eq(catalogProductsTable.division, input.division));
  const unusualShape = divisionCodes.length > 0 && Math.min(...divisionCodes.map((r) => editDistance(input.itemCode, normalizeNewCode(r.itemCode)))) > Math.max(2, Math.ceil(input.itemCode.length * 0.55));
  const payload = JSON.stringify({ ...input, unusualCodeConfirmed: false });
  const token = randomUUID();
  await db.insert(newProductPreviewStatesTable).values({
    token, payload, createdBy: actor(req), expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  return res.json({
    ...input,
    normalizedCode: input.itemCode,
    token,
    periodExists: period.length > 0,
    periodCount: period.length,
    goesLiveImmediately: input.effectiveDate <= today(),
    dateMeaning: input.effectiveDate <= today() ? "The date has passed; this product goes live immediately." : "This product is scheduled and will become current on its effective date.",
    nearbySeries: nearby,
    unusualShape,
  });
});

router.post("/catalog/price-editor/new-product/apply", requireAdmin, async (req, res): Promise<any> => {
  const input = newProductInput(req.body);
  const token = String(req.body?.token ?? "");
  const error = await validateNewProductInput(input);
  if (error) return res.status(400).json({ error });
  const codeCheck = await (async () => {
    const rows = await db.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable).where(eq(catalogProductsTable.division, input.division));
    return rows.length > 0 && Math.min(...rows.map((r) => editDistance(input.itemCode, normalizeNewCode(r.itemCode)))) > Math.max(2, Math.ceil(input.itemCode.length * 0.55));
  })();
  if (codeCheck && !input.unusualCodeConfirmed) return res.status(400).json({ error: "This code is unusual for the selected division. Confirm Continue anyway before creating it." });
  try {
    const result = await db.transaction(async (tx) => {
      const preview = (await tx.select().from(newProductPreviewStatesTable).where(and(
        eq(newProductPreviewStatesTable.token, token),
        eq(newProductPreviewStatesTable.status, "preview"),
        eq(newProductPreviewStatesTable.createdBy, actor(req)),
        sql`${newProductPreviewStatesTable.expiresAt} > now()`,
      )).limit(1).for("update"))[0];
      const previewInput = { ...input, unusualCodeConfirmed: false };
      if (!preview || preview.payload !== JSON.stringify(previewInput)) throw new Error("Preview is stale, expired, already used, or does not match this product.");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"new-product:" + input.itemCode}))`);
      const allProducts = await tx.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable).for("update");
      const existing = allProducts.filter((p) => normalizeNewCode(p.itemCode) === input.itemCode);
      if (existing[0]) throw new Error(`Code ${input.itemCode} already exists.`);
      const [manualSource] = await tx.insert(mrpSourcesTable).values({
        division: "Manual MRP corrections", sheetId: "manual-mrp-corrections",
        sheetUrl: "about:blank", expectedFileName: null,
        notes: "Internal audit source for reviewed corrections without an official workbook.",
        sourceKind: "manual",
      }).onConflictDoNothing({ target: mrpSourcesTable.sheetId }).returning({ id: mrpSourcesTable.id });
      const manualSourceId = manualSource?.id ?? (await tx.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable)
        .where(eq(mrpSourcesTable.sheetId, "manual-mrp-corrections")).limit(1))[0]?.id;
      if (!manualSourceId) throw new Error("Manual MRP provenance source could not be created.");
      const [provenanceBatch] = await tx.insert(mrpLoadBatchesTable).values({
        sourceId: manualSourceId,
        fileName: `manual-creation:${input.itemCode}:${input.effectiveDate}`,
        fileSha256: null, fileSizeBytes: null, downloadedAt: null,
        loadedBy: actor(req),
        rowCount: 1,
        notes: `Single-product editor creation: ${input.reason}; content hash: ${sha256ForManualCorrection({
          itemCode: input.itemCode, effectiveDate: input.effectiveDate,
          mrp: input.mrp, reason: input.reason,
        })}`,
      }).returning({ id: mrpLoadBatchesTable.id });
      const productRows = await tx.insert(catalogProductsTable).values({
        itemCode: input.itemCode, productName: input.productName, division: input.division,
        seriesRange: input.series, category: input.category, size: input.size,
        sourceFiles: "single-product-editor", dataFlag: "manual_creation",
      }).returning();
      const historyRows = await tx.insert(mrpPriceHistoryTable).values({
        itemCode: input.itemCode, mrp: input.mrp, netPrice: null, discountPct: null,
        priceBasis: "MRP", effectiveDate: input.effectiveDate, loadDate: today(),
        sourceFile: "single-product-editor", loadBatchId: provenanceBatch.id,
        reviewStatus: "approved", variant: "Standard",
        notes: input.reason,
      }).returning();
      await tx.insert(mrpHistoryProvenanceEventsTable).values({
        historyRowId: historyRows[0]!.id, itemCode: input.itemCode, effectiveDate: input.effectiveDate,
        action: "new_product_manual", reason: input.reason, sourceFile: "single-product-editor",
        loadBatchId: provenanceBatch.id, mrp: input.mrp,
      });
      const audit = (await tx.insert(catalogPriceEditAuditsTable).values({
        actor: actor(req), itemCode: input.itemCode, series: "Product creation", operationType: "save",
        oldValue: null, newValue: input.mrp,
        effectiveDate: input.effectiveDate, remarks: input.reason, targetRowId: historyRows[0]!.id,
         creationMetadata: JSON.stringify({ product: productRows[0], history: historyRows[0], provenanceBatchId: provenanceBatch.id }),
      }).returning())[0]!;
      await recomputeCurrentFlagsInTransaction(tx);
      const candidates = await tx.select().from(competitorPriceStagingTable).where(and(
        eq(competitorPriceStagingTable.status, "needs_review"),
        sql`${competitorPriceStagingTable.matchedPrayagCode} IS NULL`,
        eq(competitorPriceStagingTable.reviewReason, "No verified Prayag product match."),
      ));
      const eligible = candidates.filter((row) =>
        normalizeNewCode(row.competitorCodeCatalogue) === input.itemCode ||
        normalizeNewCode(row.competitorCodeMaster) === input.itemCode);
      const movedCompetitorRows: Array<{ competitor: string; sourceCode: string; prayagCode: string; batchId: number }> = [];
      const movedCompetitorIds: number[] = [];
      const affectedBatches = new Set<number>();
      if (eligible.length === 1) {
        const candidate = eligible[0]!;
        const batch = (await tx.select({ effectiveDate: importBatchesTable.effectiveDate }).from(importBatchesTable).where(eq(importBatchesTable.id, candidate.batchId)).limit(1))[0];
        const effectiveDate = batch?.effectiveDate ?? input.effectiveDate;
        const activeOnDate = productRows[0]!.isActive && (!productRows[0]!.discontinuedFrom || productRows[0]!.discontinuedFrom > effectiveDate);
        const aligned = activeOnDate ? (await tx.select({ mrp: mrpPriceHistoryTable.mrp }).from(mrpPriceHistoryTable).where(and(
          eq(mrpPriceHistoryTable.itemCode, input.itemCode), eq(mrpPriceHistoryTable.variant, "Standard"),
          eq(mrpPriceHistoryTable.reviewStatus, "approved"), sql`${mrpPriceHistoryTable.effectiveDate} <= ${effectiveDate}`,
        )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id)).limit(1))[0] : null;
        if (activeOnDate && aligned) {
          const competitorPrice = candidate.newMrp ?? candidate.oldMrp;
          const gapPct = competitorPrice != null && aligned.mrp ? ((competitorPrice - aligned.mrp) / aligned.mrp) * 100 : null;
          await tx.update(competitorPriceStagingTable).set({
            matchedPrayagCode: input.itemCode, status: "ok", matchMethod: "new_product_exact",
            reviewReason: null, prayagMrpCurrent: aligned.mrp, gapPct,
          }).where(eq(competitorPriceStagingTable.id, candidate.id));
          movedCompetitorRows.push({
            competitor: candidate.competitor,
            sourceCode: candidate.competitorCodeCatalogue ?? candidate.competitorCodeMaster ?? "",
            prayagCode: input.itemCode, batchId: candidate.batchId,
          });
          movedCompetitorIds.push(candidate.id);
          affectedBatches.add(candidate.batchId);
        }
      }
      for (const batchId of affectedBatches) {
        const counts = await tx.select({ status: competitorPriceStagingTable.status, count: sql<number>`count(*)::int` })
          .from(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, batchId)).groupBy(competitorPriceStagingTable.status);
        const batch = (await tx.select({ rowCounts: importBatchesTable.rowCounts }).from(importBatchesTable).where(eq(importBatchesTable.id, batchId)).limit(1))[0];
        const prior = batch?.rowCounts ? JSON.parse(batch.rowCounts) as Record<string, unknown> : {};
        const next: Record<string, unknown> = { ...prior, ok: 0, needs_review: 0, not_found: 0, new_products: 0 };
        for (const count of counts) next[count.status] = count.count;
        await tx.update(importBatchesTable).set({ rowCounts: JSON.stringify(next) }).where(eq(importBatchesTable.id, batchId));
      }
      await tx.update(newProductPreviewStatesTable).set({ status: "consumed", consumedAt: new Date() }).where(eq(newProductPreviewStatesTable.id, preview.id));
      return { product: productRows[0], history: historyRows[0], audit, movedCompetitorRows: movedCompetitorIds, movedCompetitorDetails: movedCompetitorRows };
    });
    return res.json({ ok: true, ...result });
  } catch (e) {
    req.log?.error({ err: e }, "single product creation failed");
    return res.status(409).json({ error: e instanceof Error ? e.message : "Could not create product." });
  }
});

router.get("/catalog/price-editor/new-product/undo/:auditId", requireAdmin, async (req, res): Promise<any> => {
  const id = Number(req.params.auditId);
  const original = Number.isInteger(id) ? (await db.select().from(catalogPriceEditAuditsTable).where(eq(catalogPriceEditAuditsTable.id, id)).limit(1))[0] : null;
  if (!original || original.series !== "Product creation") return res.status(404).json({ error: "Product creation not found." });
  const refs = await creationReferences(db, original.itemCode, id);
  return res.json({ canUndo: refs.length === 0, reason: refs.length ? `${refs.join(", ")} reference this product; deactivate it instead of deleting it.` : null, canDeactivate: refs.length > 0 });
});

router.post("/catalog/price-editor/new-product/undo/:auditId", requireAdmin, async (req, res): Promise<any> => {
  const id = Number(req.params.auditId);
  try {
    const reversal = await db.transaction(async (tx) => {
      const original = Number.isInteger(id) ? (await tx.select().from(catalogPriceEditAuditsTable).where(eq(catalogPriceEditAuditsTable.id, id)).limit(1).for("update"))[0] : null;
      if (!original || original.series !== "Product creation" || original.operationType !== "save") throw Object.assign(new Error("Product creation not found."), { status: 404 });
      const already = await tx.select({ id: catalogPriceEditAuditsTable.id }).from(catalogPriceEditAuditsTable).where(and(eq(catalogPriceEditAuditsTable.originalAuditId, id), eq(catalogPriceEditAuditsTable.operationType, "reversal")));
      if (already.length) throw Object.assign(new Error("Product creation has already been undone."), { status: 409 });
      const refs = await creationReferences(tx, original.itemCode, id);
      if (refs.length) throw Object.assign(new Error(`${refs.join(", ")} reference this product; deactivate it instead of deleting it.`), { status: 409 });
      const history = (await tx.select().from(mrpPriceHistoryTable).where(and(eq(mrpPriceHistoryTable.id, original.targetRowId!), eq(mrpPriceHistoryTable.itemCode, original.itemCode))).limit(1).for("update"))[0];
      const productRow = (await tx.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, original.itemCode)).limit(1).for("update"))[0];
      const metadata = original.creationMetadata ? JSON.parse(original.creationMetadata) as { product?: any; history?: any } : {};
      if (!history || !productRow || history.mrp !== original.newValue ||
          metadata.product && (productRow.productName !== metadata.product.productName || productRow.division !== metadata.product.division ||
            productRow.category !== metadata.product.category || productRow.seriesRange !== metadata.product.seriesRange ||
            productRow.size !== metadata.product.size) ||
          metadata.history && (history.effectiveDate !== metadata.history.effectiveDate || history.variant !== metadata.history.variant ||
            history.reviewStatus !== metadata.history.reviewStatus)) throw Object.assign(new Error("Created product or MRP changed; undo rejected."), { status: 409 });
      await tx.update(mrpHistoryProvenanceEventsTable).set({ historyRowId: null }).where(eq(mrpHistoryProvenanceEventsTable.historyRowId, history.id));
      await tx.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.id, history.id));
      await tx.delete(catalogProductsTable).where(eq(catalogProductsTable.id, productRow.id));
      await recomputeCurrentFlagsInTransaction(tx);
      return (await tx.insert(catalogPriceEditAuditsTable).values({
        actor: actor(req), itemCode: original.itemCode, series: "Product creation",
        operationType: "reversal", oldValue: original.newValue, newValue: null,
        effectiveDate: original.effectiveDate, remarks: `Undo of product creation #${id}`,
        originalAuditId: id, targetRowId: history.id,
      }).returning())[0]!;
    });
    return res.json({ ok: true, reversal });
  } catch (e: any) { return res.status(e.status ?? 409).json({ error: e.message ?? "Could not undo product." }); }
});

router.post("/catalog/price-editor/new-product/deactivate/:auditId", requireAdmin, async (req, res): Promise<any> => {
  const id = Number(req.params.auditId);
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) return res.status(400).json({ error: "Deactivation reason is required." });
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"new-product-deactivate:" + id}))`);
      const original = Number.isInteger(id) ? (await tx.select().from(catalogPriceEditAuditsTable).where(eq(catalogPriceEditAuditsTable.id, id)).limit(1).for("update"))[0] : null;
      if (!original || original.series !== "Product creation" || original.operationType !== "save") throw Object.assign(new Error("Product creation not found."), { status: 404 });
      const already = await tx.select({ id: catalogPriceEditAuditsTable.id }).from(catalogPriceEditAuditsTable).where(and(
        eq(catalogPriceEditAuditsTable.originalAuditId, id),
        eq(catalogPriceEditAuditsTable.series, "Product deactivation"),
        eq(catalogPriceEditAuditsTable.operationType, "save"),
      ));
      if (already.length) throw Object.assign(new Error("Product is already deactivated."), { status: 409 });
      const refs = await creationReferences(tx, original.itemCode, id);
      if (!refs.length) throw Object.assign(new Error("Undo is still safe; use Undo before deactivation."), { status: 409 });
      const updated = await tx.update(catalogProductsTable).set({ isActive: false, updatedAt: new Date(), discontinuedStatusNote: reason, discontinuedCheckedBy: actor(req) }).where(and(eq(catalogProductsTable.itemCode, original.itemCode), eq(catalogProductsTable.isActive, true))).returning();
      if (!updated.length) throw Object.assign(new Error("Product is already inactive or missing."), { status: 409 });
      await recomputeCurrentFlagsInTransaction(tx);
      const audit = (await tx.insert(catalogPriceEditAuditsTable).values({
        actor: actor(req), itemCode: original.itemCode, series: "Product deactivation",
        operationType: "save", oldValue: 1, newValue: 0, effectiveDate: today(),
        remarks: reason, originalAuditId: id,
      }).returning())[0]!;
      return { product: updated[0], audit };
    });
    return res.json({ ok: true, ...result });
  } catch (e: any) { return res.status(e.status ?? 409).json({ error: e.message ?? "Could not deactivate product." }); }
});

export default router;