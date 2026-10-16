import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import * as XLSX from "xlsx";
import {
  resolveCalculator, summarizeCalculator, calculatorDisclosures, discountError, quantityError,
  type CalculatorEvidence, type CalculatorBlock, applyIndianNumberFormats,
} from "@workspace/formatting";
import { requireAuth, requireWorkspaceReadAccess } from "../middlewares/authMiddleware";
import { bucketExportBanner, bucketExportRows } from "../lib/bucketFilter";
import { exactQueryCodes, finderAsOf } from "../lib/priceFinderCompetitors";
import { readFinderEvidence } from "../lib/priceFinderEvidence";

const router = Router();
function scopeDisclosure() {
  return [...new Set([bucketExportBanner(), ...bucketExportRows<string[]>([]).flat().filter((v): v is string => typeof v === "string" && v.length > 0)])];
}
export async function calculatorEvidence(codes: string[], asOf: string) {
  const raw = await readFinderEvidence(codes, asOf);
  const unitKey = (s: string | null) => s?.trim().toLowerCase().replace(/^(nos\.?|pcs\.?|pieces?|each)$/, "each") ?? "";
  const rows: CalculatorEvidence[] = raw.products.map(p => ({
    itemCode: p.item_code, productName: p.product_name, division: p.division, category: p.category,
    priceBasis: `MRP · ${p.uom || "unit not recorded"}`, hasRecordedCompetitorPrice: p.has_recorded_competitor_price,
    prayag: { price: p.current_mrp, effectiveDate: p.current_effective_date },
    variants: [{ variant: "Standard", price: p.current_mrp, effectiveDate: p.current_effective_date },
      ...raw.variants.filter(v => v.item_code === p.item_code).map(v => ({
        variant: v.variant, price: v.current_mrp, effectiveDate: v.current_effective_date,
      }))],
    competitors: raw.competitors.filter(q => q.item_code === p.item_code).map(q => ({
      competitor: q.competitor, price: q.price, effectiveDate: q.effective_date,
      priceBasis: `${q.price_basis || "basis not recorded"} · ${q.unit || "unit not recorded"}${q.price_basis?.toLowerCase() === "ex-gst" ? ` · incl. ${q.gst_pct ?? 18}% GST equivalent` : ""}`,
      // Unknown unit/tax metadata is not proof of comparability. Do not invent it.
      basisMismatch: q.price_basis?.toLowerCase() !== "mrp" || !q.unit || unitKey(q.unit) !== unitKey(p.uom),
    })),
  }));
  return { asOfDate: asOf, rows, scopeDisclosure: scopeDisclosure(),
    unavailableCodes: codes.filter(code => !rows.some(p => p.itemCode === code)) };
}

router.get("/price-finder/calculator/rows", async (req, res) => {
  try {
    const raw = req.query.code;
    // Raw count is capped too; 51 repeated codes must not bypass the limit.
    if (Array.isArray(raw) && raw.length > 50) throw new Error("Select at most 50 products.");
    const codes = exactQueryCodes(raw);
    if (!codes.length) throw new Error("Select between 1 and 50 products.");
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await calculatorEvidence(codes, finderAsOf(req.query.asOf)));
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Prices could not be resolved." }); }
});

// Public calculator, private saved defaults. Read stored rows only: unlike the
// administrator analysis-settings route, this endpoint never seeds defaults.
router.get("/price-finder/discount-defaults", requireAuth, requireWorkspaceReadAccess, async (_req, res) => {
  const result = await db.execute<{ scope: string; discount_pct: number }>(sql`
    SELECT scope,discount_pct FROM discount_settings
    WHERE scope='Our' OR scope IN (SELECT DISTINCT competitor FROM competitor_prices)
    ORDER BY scope
  `);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(result.rows.map(r => ({ scope: r.scope, discountPct: r.discount_pct })));
});

const text = z.string().min(1).max(1024);
const entry = z.object({ id: text, competitor: text.nullable(), discount: z.string().max(20) }).strict();
const block = z.object({
  id: text, itemCode: text.nullable(), variant: text, discount: z.string().max(20),
  quantity: z.string().max(24), competitors: z.array(entry).max(10),
}).strict();
const exportBody = z.object({ asOf: text, blocks: z.array(block).min(1).max(50) }).strict();
type Cell = string | number | null;

/** POST is only transport for an in-memory calculation too large for a link.
 * It re-resolves source prices and bucket scope; it performs no database writes. */
router.post("/price-finder/calculator/export", async (req, res) => {
  try {
    const body = exportBody.parse(req.body);
    const asOf = finderAsOf(body.asOf);
    const blocks: CalculatorBlock[] = body.blocks;
    for (const b of blocks) {
      if (!b.itemCode) continue;
      const err = discountError(b.discount) ?? quantityError(b.quantity)
        ?? b.competitors.map(c => discountError(c.discount)).find(Boolean);
      if (err) throw new Error(err);
      const names = b.competitors.map(c => c.competitor).filter(Boolean);
      if (new Set(names).size !== names.length) throw new Error("Choose each competitor only once per product.");
    }
    const codes = [...new Set(blocks.map(b => b.itemCode).filter((v): v is string => !!v))];
    if (!codes.length) throw new Error("Select at least one product.");
    const evidence = await calculatorEvidence(codes, asOf);
    const resolved = resolveCalculator(blocks, evidence.rows);
    if (resolved.some(r => r.product && (r.our.errors.discount || r.our.errors.quantity ||
      r.competitors.some(c => c.errors.discount || c.errors.quantity)))) throw new Error("Correct invalid calculation inputs before exporting.");
    const summary = summarizeCalculator(resolved);
    const disclosures = calculatorDisclosures(summary, asOf, evidence.scopeDisclosure);
    const detail: Cell[][] = [[
      "Code", "Name", "Division", "Category", "Variant", "As of",
      "Our MRP", "Our effective date", "Our discount %", "Our net unit", "Quantity", "Our total",
      "Competitor", "Competitor price", "Competitor effective date", "Competitor discount %",
      "Competitor net unit", "Competitor total", "Difference per unit ₹", "Difference %",
      "Difference total ₹", "Position", "Basis warning", "Our price basis", "Competitor price basis",
    ]];
    for (const r of resolved) {
      if (!r.product) continue;
      for (const c of r.competitors) detail.push([
        r.block.itemCode, r.product.productName, r.product.division, r.product.category, r.block.variant, asOf,
        r.price?.price ?? "No price", r.price?.effectiveDate ?? null, Number(r.block.discount),
        r.our.netUnit ?? "No price", r.our.quantity, r.our.total ?? "No price", c.competitor,
        c.quote?.price ?? "No price", c.quote?.effectiveDate ?? null, Number(c.discount),
        c.netUnit ?? "No price", c.total ?? "No price", c.position.diffUnit, c.position.diffPct == null ? null : c.position.diffPct / 100,
        c.diffTotal, c.position.label, c.basisMismatch ? "Different price basis — check before relying on this" : "",
        r.product.priceBasis, c.quote?.priceBasis ?? "No price",
      ]);
    }
    const summaryRows: Cell[][] = [
      ["Price calculator summary"], ...disclosures.map(d => [d]), [],
      ["Products compared", summary.products], ["Total quantity", summary.totalQuantity], ["Our total value", summary.ourValue], [],
      ["Competitor", "Coverage", "Our subtotal on same products", "Competitor subtotal", "Difference %", "Position", "We are cheaper", "At par", "We are higher"],
      ...summary.brands.map(b => [b.brand, `compared on ${b.compared} of ${b.products} products`, b.ourValue, b.competitorValue,
        b.position.diffPct == null ? null : b.position.diffPct / 100, b.position.label, b.cheaper, b.par, b.higher]),
      [], ["Product code", "Name", "Variant", "Quantity", "Our total", ...summary.brands.map(b => b.brand)],
      ...resolved.filter(r => r.product).map(r => [r.block.itemCode, r.product!.productName, r.block.variant, r.our.quantity,
        r.our.total ?? "No price", ...summary.brands.map(b => r.competitors.find(c => c.competitor === b.brand)?.total ?? "—")]),
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(detail), "Calculator detail");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");
    const detailSheet = workbook.Sheets["Calculator detail"];
    applyIndianNumberFormats(detailSheet, { moneyColumns: [6, 9, 11, 13, 16, 17, 18, 20], countColumns: [10] });
    for (let i = 1; i < detail.length; i++) if (detailSheet[`T${i + 1}`]?.t === "n") detailSheet[`T${i + 1}`].z = "0.0%";
    const summarySheet = workbook.Sheets.Summary;
    const brandHeader = summaryRows.findIndex(r => r[0] === "Competitor" && r[1] === "Coverage");
    const productHeader = summaryRows.findIndex(r => r[0] === "Product code");
    summaryRows.forEach((row, index) => {
      const columns = row[0] === "Our total value" ? [1]
        : index > brandHeader && index < productHeader ? [2, 3]
        : index > productHeader ? [4, ...summary.brands.map((_b, i) => i + 5)] : [];
      for (const col of columns) {
        const cell = summarySheet[XLSX.utils.encode_cell({ r: index, c: col })];
        if (cell?.t === "n") cell.z = "#,##,##0.00";
      }
      if (index > brandHeader && index < productHeader) {
        const percent = summarySheet[XLSX.utils.encode_cell({ r: index, c: 4 })];
        if (percent?.t === "n") percent.z = "0.0%";
      }
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="prayag-price-calculator-${asOf}.xlsx"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Calculation could not be exported." }); }
});
export default router;
