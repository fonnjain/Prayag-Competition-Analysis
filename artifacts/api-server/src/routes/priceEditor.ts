import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  catalogProductsTable,
  catalogPriceEditAuditsTable,
  mrpPriceHistoryTable,
  competitorPricesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";
import {
  recomputeCurrentFlagsInTransaction,
  recomputeCompetitorCurrentFlagsInTransaction,
} from "../lib/catalog";
import { warningFor } from "./mrpRevision";

const router: IRouter = Router();
const iso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const today = () => new Date().toISOString().slice(0, 10);
const actor = (req: Request) => req.user?.email ?? req.user?.id ?? "unknown";

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
      if (series === "Prayag MRP") {
        const existing = (await tx.select().from(mrpPriceHistoryTable).where(and(eq(mrpPriceHistoryTable.itemCode, code), eq(mrpPriceHistoryTable.effectiveDate, effectiveDate), eq(mrpPriceHistoryTable.variant, "Standard"), eq(mrpPriceHistoryTable.reviewStatus, "approved"))).limit(1).for("update"))[0];
        old = existing?.mrp ?? null; targetWasExisting = !!existing;
        if (existing) { const rows = await tx.update(mrpPriceHistoryTable).set({ mrp: value, notes: remarks }).where(eq(mrpPriceHistoryTable.id, existing.id)).returning({ id: mrpPriceHistoryTable.id }); rowId = rows[0]!.id; mutation = rows.length; }
        else { const rows = await tx.insert(mrpPriceHistoryTable).values({ itemCode: code, mrp: value, netPrice: null, discountPct: null, priceBasis: "MRP", effectiveDate, loadDate: today(), sourceFile: "single-product-editor", reviewStatus: "approved", variant: "Standard", notes: remarks }).returning({ id: mrpPriceHistoryTable.id }); rowId = rows[0]!.id; mutation = rows.length; }
      } else {
        const existing = (await tx.select().from(competitorPricesTable).where(and(eq(competitorPricesTable.matchedPrayagCode, code), eq(competitorPricesTable.competitor, series), eq(competitorPricesTable.effectiveDate, effectiveDate))).limit(1).for("update"))[0];
        old = existing?.price ?? null; targetWasExisting = !!existing;
        if (existing) { const rows = await tx.update(competitorPricesTable).set({ price: value, updatedAt: new Date() }).where(eq(competitorPricesTable.id, existing.id)).returning({ id: competitorPricesTable.id }); rowId = rows[0]!.id; mutation = rows.length; }
        else { const rows = await tx.insert(competitorPricesTable).values({ competitor: series, price: value, effectiveDate, matchedPrayagCode: code, matchStatus: "matched", description: p.productName, category: p.category, size: p.size }).returning({ id: competitorPricesTable.id }); rowId = rows[0]!.id; mutation = rows.length; }
      }
      if (mutation !== 1) throw new Error("Price edit changed an unexpected number of rows.");
      if (!targetWasExisting) previousResolvedValue = resolvedValue;
      if (series === "Prayag MRP") await recomputeCurrentFlagsInTransaction(tx);
      else await recomputeCompetitorCurrentFlagsInTransaction(series, tx);
      return (await tx.insert(catalogPriceEditAuditsTable).values({ actor: actor(req), itemCode: code, series, operationType: "save", oldValue: old, previousResolvedValue, newValue: value, effectiveDate, remarks, targetRowId: rowId }).returning())[0]!;
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
          const updated = await tx.update(mrpPriceHistoryTable).set({ mrp: original.oldValue }).where(and(eq(mrpPriceHistoryTable.id, target.id), eq(mrpPriceHistoryTable.mrp, original.newValue))).returning({ id: mrpPriceHistoryTable.id });
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
          const updated = await tx.update(competitorPricesTable).set({ price: original.oldValue, updatedAt: new Date() }).where(and(eq(competitorPricesTable.id, target.id), eq(competitorPricesTable.price, original.newValue))).returning({ id: competitorPricesTable.id });
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

export default router;