import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import * as XLSX from "xlsx";
import {
  resolveCalculator, summarizeCalculator, calculatorDisclosures, discountError, quantityError,
  type CalculatorEvidence, type CalculatorBlock, applyIndianNumberFormats, compareCalculatorMetadata,
  CALCULATOR_SCOPE_DISCLOSURE, calculatorCompetitorKey, calculatorAssertedBanner,
  rankProductSearchRows, type ProductSearchRow, CALCULATOR_SEARCH_LIMIT,
} from "@workspace/formatting";
import { requireAuth, requireWorkspaceReadAccess } from "../middlewares/authMiddleware";
import { exactQueryCodes, finderAsOf } from "../lib/priceFinderCompetitors";
import { readFinderEvidence, type FinderProduct } from "../lib/priceFinderEvidence";
import { productSearchCondition } from "../lib/productSearchCondition";

const router = Router();
export async function calculatorEvidence(codes: string[], asOf: string) {
  const raw = await readFinderEvidence(codes, asOf, { calculatorUnscoped: true });
  const known = await db.execute<{ item_code: string; product_name: string | null; division: string | null; category: string | null; uom: string }>(sql`
    SELECT item_code,product_name,division,category,uom FROM catalog_products
    WHERE item_code IN (${codes.length ? sql.join(codes.map(c => sql`${c}`), sql`,`) : sql`NULL`})`);
  // Full catalogue identity includes inactive/date-ineligible records. Preserve
  // their actual metadata, but never resurrect an ineligible app MRP. A quote
  // for one of these products needs an Entered price, not an ad-hoc alias.
  const resolvedCodes = new Set(raw.products.map(p => p.item_code));
  const metadataOnly: FinderProduct[] = known.rows.filter(p => !resolvedCodes.has(p.item_code)).map(p => ({
    ...p, discontinued_from: null, current_mrp: null, current_price_basis: null, current_effective_date: null,
    upcoming_mrp: null, upcoming_effective_date: null,
    has_recorded_competitor_price: raw.competitors.some(c => c.item_code === p.item_code),
  }));
  const metadataOnlyCodes = new Set(metadataOnly.map(p => p.item_code));
  const rows: CalculatorEvidence[] = [...raw.products, ...metadataOnly].map(p => ({
    itemCode: p.item_code, productName: p.product_name, division: p.division, category: p.category,
    priceBasis: `${p.current_price_basis || "basis not recorded"} · ${p.uom || "unit not recorded"}`,
    basis: p.current_price_basis, unit: p.uom, hasRecordedCompetitorPrice: p.has_recorded_competitor_price,
    prayag: { price: p.current_mrp, effectiveDate: p.current_effective_date },
    variants: [{ variant: "Standard", price: p.current_mrp, effectiveDate: p.current_effective_date, basis: p.current_price_basis },
      ...raw.variants.filter(v => v.item_code === p.item_code && !metadataOnlyCodes.has(p.item_code)).map(v => ({
        variant: v.variant, price: v.current_mrp, effectiveDate: v.current_effective_date, basis: v.current_price_basis,
      }))],
    competitors: raw.competitors.filter(q => q.item_code === p.item_code).map(q => ({
      competitor: q.competitor, price: q.price, effectiveDate: q.effective_date,
      basis: q.price_basis, unit: q.unit,
      priceBasis: `${q.price_basis || "basis not recorded"} · ${q.unit || "unit not recorded"}${q.price_basis?.toLowerCase() === "ex-gst" ? ` · incl. ${q.gst_pct ?? 18}% GST equivalent` : ""}`,
      ...compareCalculatorMetadata({ basis: p.current_price_basis, unit: p.uom }, { basis: q.price_basis, unit: q.unit }),
    })),
  }));
  return { asOfDate: asOf, rows, catalogueCodes: known.rows.map(r => r.item_code), scopeDisclosure: [CALCULATOR_SCOPE_DISCLOSURE],
    unavailableCodes: codes.filter(code => !rows.some(p => p.itemCode === code)) };
}

const searchQuery = z.object({
  q: z.string().max(1024).optional(), division: z.string().max(1024).optional(),
  category: z.string().max(1024).optional(), asOf: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(CALCULATOR_SEARCH_LIMIT).optional(),
}).strict();
type ProductOption = { itemCode: string; productName: string | null; division: string | null; category: string | null };
router.get("/price-finder/calculator/search", async (req, res) => {
  try {
    const query = searchQuery.parse(req.query);
    finderAsOf(query.asOf);
    // Search may rank approximate suggestions. ONLY raw equality establishes identity.
    // Search identities across the full catalogue. Date eligibility controls
    // recorded price evidence, not whether an exact stored product exists.
    const available = sql`TRUE`;
    const division = query.division === undefined ? sql`TRUE` : sql`p.division=${query.division}`;
    const category = query.category === undefined ? sql`TRUE`
      : query.category === "__uncategorised__" ? sql`p.category IS NULL OR p.category=''` : sql`p.category=${query.category}`;
    const filters = query.q === undefined || query.q === "" ? [] : [query.q];
    const hint = filters.length ? productSearchCondition(filters[0]) : sql`TRUE`;
    const [results, divisions, categories, exact] = await Promise.all([
      db.execute<ProductSearchRow>(sql`SELECT p.item_code,p.product_name,p.division,p.category,p.size
        FROM catalog_products p WHERE ${available} AND ${division} AND (${category}) AND ${hint}
        ORDER BY p.item_code COLLATE "C"`),
      db.execute<{ division: string; count: number }>(sql`SELECT p.division,count(*)::int AS count
        FROM catalog_products p WHERE ${available} AND p.division IS NOT NULL
        GROUP BY p.division ORDER BY p.division`),
      db.execute<{ category: string | null; label: string; count: number }>(sql`SELECT nullif(p.category,'') AS category,
        coalesce(nullif(p.category,''),'Uncategorised') AS label,count(*)::int AS count
        FROM catalog_products p WHERE ${available} AND ${division} GROUP BY nullif(p.category,'') ORDER BY label`),
      query.q === undefined ? Promise.resolve({ rows: [] as ProductOption[] })
        : db.execute<ProductOption>(sql`SELECT item_code AS "itemCode",product_name AS "productName",division,category
          FROM catalog_products WHERE item_code=${query.q} LIMIT 1`),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    // Rank ALL candidates before limiting. Scope deliberately excludes bucket
    // conditions, unlike Price Finder. Identity below remains raw SQL equality.
    const ranked = rankProductSearchRows(results.rows, filters);
    res.json({
      results: ranked.slice(0, query.limit ?? CALCULATOR_SEARCH_LIMIT).map(row => ({
        itemCode: row.item_code, productName: row.product_name, division: row.division, category: row.category,
      })),
      totalCount: ranked.length,
      divisions: divisions.rows, categories: categories.rows, exactProduct: exact.rows[0] ?? null,
    });
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Search failed." }); }
});
router.get("/price-finder/calculator/competitors", async (req, res) => {
  try {
    const query = z.object({ asOf: z.string().optional() }).strict().parse(req.query);
    const asOf = finderAsOf(query.asOf);
    // Competitors are text on price rows, not a brand master. Read stored spellings;
    // one-off names remain exclusively in the caller's basket, never in this list.
    const result = await db.execute<{ competitor: string; pricedProducts: number; effectiveDate: string | null }>(sql`
      SELECT competitor,count(DISTINCT matched_prayag_code) FILTER
        (WHERE match_status='matched' AND price IS NOT NULL AND effective_date<=${asOf}::date)::int AS "pricedProducts",
        max(effective_date) FILTER (WHERE price IS NOT NULL AND effective_date<=${asOf}::date)::text AS "effectiveDate"
      FROM competitor_prices GROUP BY competitor ORDER BY competitor
    `);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ competitors: result.rows });
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Competitors could not be loaded." }); }
});

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
const entry = z.object({ id: text, competitor: text.nullable(), discount: z.string().max(20),
  mrp: z.string().max(4096).optional(), adHoc: z.boolean().optional() }).strict();
const block = z.object({
  id: text, itemCode: text.nullable(), variant: text, discount: z.string().max(20),
  quantity: z.string().max(24), competitors: z.array(entry).max(10),
  mrp: z.string().max(4096).optional(), adHocProduct: z.boolean().optional(), description: z.string().max(4096).optional(),
}).strict();
const exportBody = z.object({ asOf: text, blocks: z.array(block).min(1).max(50) }).strict();
type Cell = string | number | null;

/** POST is only transport for an in-memory calculation too large for a link.
 * It re-resolves source prices without bucket scope; it performs no database writes. */
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
      const names = b.competitors.filter(c => c.competitor).map(calculatorCompetitorKey);
      if (new Set(names).size !== names.length) throw new Error("Choose each competitor only once per product.");
    }
    const codes = [...new Set(blocks.map(b => b.itemCode).filter((v): v is string => !!v))];
    if (!codes.length) throw new Error("Select at least one product.");
    const evidence = await calculatorEvidence(codes, asOf);
    // A known but date-ineligible/inactive catalogue code must not be relabelled
    // as an ad-hoc product to fabricate provenance or infer a replacement product.
    const knownCodes = new Set(evidence.catalogueCodes);
    for (const b of blocks) {
      if (b.itemCode && knownCodes.has(b.itemCode)) b.adHocProduct = false;
      if (b.itemCode && !knownCodes.has(b.itemCode) && (!b.adHocProduct || !b.description?.trim()))
        throw new Error("An unknown item code requires an explicit ad-hoc product and description.");
    }
    const resolved = resolveCalculator(blocks, evidence.rows);
    if (resolved.some(r => r.product && (r.our.errors.discount || r.our.errors.quantity ||
      (r.our.errors.mrp && (r.block.mrp !== undefined || r.adHocProduct)) ||
      r.competitors.some(c => c.errors.discount || c.errors.quantity || (c.errors.mrp && (c.mrp !== undefined || c.adHoc))))))
      throw new Error("Correct invalid calculation inputs, including required positive MRPs, before exporting.");
    const summary = summarizeCalculator(resolved);
    const disclosures = calculatorDisclosures(summary, asOf, evidence.scopeDisclosure);
    const banner = summary.assertedPrices ? [calculatorAssertedBanner(summary.assertedPrices)] : null;
    const detail: Cell[][] = [...(banner ? [banner] : []), ...disclosures.map(d => [d]), [
      "Code", "Name", "Division", "Category", "Variant", "As of",
      "Our MRP", "Our effective date", "Our discount %", "Our net unit", "Quantity", "Our total",
      "Competitor", "Competitor price", "Competitor effective date", "Competitor discount %",
      "Competitor net unit", "Competitor total", "Difference per unit ₹", "Difference %",
      "Difference total ₹", "Position", "Evidence warnings", "Our price basis", "Competitor price basis", "Unit information",
      "Our provenance", "Our overridden app value", "Competitor provenance", "Competitor overridden app value",
      "Ad-hoc product", "Ad-hoc competitor",
    ]];
    for (const r of resolved) {
      if (!r.product) continue;
      const selections = r.competitors.length ? r.competitors : [null];
      for (const c of selections) detail.push([
        r.block.itemCode, r.product.productName, r.product.division, r.product.category, r.block.variant, asOf,
        r.our.effectivePrice ?? "No price", r.price?.effectiveDate ?? null, Number(r.block.discount),
        r.our.netUnit ?? "No price", r.our.quantity, r.our.total ?? "No price", c?.competitor ?? "Not selected",
        c?.effectivePrice ?? "No price", c?.quote?.effectiveDate ?? null, c ? Number(c.discount) : null,
        c?.netUnit ?? "No price", c?.total ?? "No price", c?.position.diffUnit ?? null,
        c?.position.diffPct == null ? null : c.position.diffPct / 100,
        c?.diffTotal ?? null, c?.position.label ?? "No price", c?.warnings.join(" ") ?? "",
        r.ourPriceBasis, c?.quote?.priceBasis ?? "basis not recorded", c?.notes.join(" ") ?? "",
        r.our.priceState, r.our.priceState === "Edited" ? r.our.appPrice : null,
        c?.priceState ?? null, c?.priceState === "Edited" ? c.appPrice : null,
        r.adHocProduct ? "Yes" : "No", c?.adHoc ? "Yes" : "No",
      ]);
    }
    const summaryRows: Cell[][] = [
      ...(banner ? [banner] : []), ["Price calculator summary"], ...disclosures.map(d => [d]), [],
      ["App prices", summary.priceCounts.App], ["Edited prices", summary.priceCounts.Edited], ["Entered prices", summary.priceCounts.Entered],
      ["Ad-hoc products", summary.adHocProducts], ["Ad-hoc competitors", summary.adHocCompetitors.length, ...summary.adHocCompetitors], [],
      ["Products compared", summary.products], ["Total quantity", summary.totalQuantity], ["Our total value", summary.ourValue], [],
      ["Competitor", "Coverage", "Our subtotal on same products", "Competitor subtotal", "Difference %", "Position", "We are cheaper", "At par", "We are higher"],
      ...summary.brands.map(b => [b.adHoc ? `${b.brand} (Ad-hoc)` : b.brand,
        `compared on ${b.compared} of ${b.products} products, ${b.adHocProducts} of which were hand-entered (Ad-hoc)`, b.ourValue, b.competitorValue,
        b.position.diffPct == null ? null : b.position.diffPct / 100, b.position.label, b.cheaper, b.par, b.higher]),
      [], ["Product code", "Name", "Variant", "Quantity", "Our total", ...summary.brands.map(b => b.adHoc ? `${b.brand} (Ad-hoc)` : b.brand),
        "Our provenance", "Our overridden app value", "Ad-hoc product",
        ...summary.brands.flatMap(b => [`${b.brand}${b.adHoc ? " (Ad-hoc)" : ""} provenance`,
          `${b.brand}${b.adHoc ? " (Ad-hoc)" : ""} overridden app value`])],
      ...resolved.filter(r => r.product).map(r => [r.block.itemCode, r.product!.productName, r.block.variant, r.our.quantity,
        r.our.total ?? "No price", ...summary.brands.map(b => r.competitors.find(c => calculatorCompetitorKey(c) === b.key)?.total ?? "—"),
        r.our.priceState, r.our.priceState === "Edited" ? r.our.appPrice : null, r.adHocProduct ? "Yes" : "No",
        ...summary.brands.flatMap(b => {
          const c = r.competitors.find(c => calculatorCompetitorKey(c) === b.key);
          return [c?.priceState ?? "—", c?.priceState === "Edited" ? c.appPrice : null];
        })]),
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
