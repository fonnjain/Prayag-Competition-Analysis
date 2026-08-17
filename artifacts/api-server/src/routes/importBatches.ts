/**
 * PDF Catalogue Import — staging, review, approve, discard
 *
 * POST   /catalog/import-batches          — upload a PDF, extract+match+stage
 * GET    /catalog/import-batches          — list all batches (newest first)
 * GET    /catalog/import-batches/:id      — batch header + staged rows
 * POST   /catalog/import-batches/:id/approve — commit staged rows to competitor_prices
 * DELETE /catalog/import-batches/:id      — discard batch (clears staging rows)
 * GET    /catalog/import-batches/:id/export  — download review Excel
 *
 * Excel/CSV imports continue to use the existing /catalog/load-competitor route;
 * this endpoint is dedicated to PDF catalogue extraction.
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import { eq, sql, desc } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  db,
  importBatchesTable,
  competitorPriceStagingTable,
  competitorPricesTable,
  competitorCodeAliasesTable,
  catalogProductsTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import { normCode } from "../lib/catalog.js";
import { extractFromPdf } from "../lib/pdfExtractor.js";
import {
  matchCatalogue,
  type MatchTarget,
  type CodeAlias,
} from "../lib/catalogueMatcher.js";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150 MB for PDFs
});

// Code families from the Sparsh Pearl catalogue profile
const SPARSH_CODE_FAMILIES = [
  "ED-", "RS-", "RPS-", "EVA-", "REG-", "TS-",
  "WC-", "UWC-", "BCC-", "BCB-", "AP-",
  "CPS-", "CPH-", "NCP-", "PSJ-", "PMJ-", "UJS-",
  "FV-", "FVE-", "WIH-", "WOH-", "WMP-", "BT-", "BTEP-", "TFT-",
  "TR-", "BA-",
];

// Known Sparsh Pearl code aliases (Vol 6.2 verified)
const SPARSH_ALIASES: Array<{ oldCode: string; newCode: string; note: string }> = [
  { oldCode: "WC-100",   newCode: "WC-180",   note: "Waste Coupling Half Thread 31/32mm (H/T)" },
  { oldCode: "PJS-255",  newCode: "PSJ-255",  note: "Jet Spray 1 Mtr — letters transposed" },
  { oldCode: "PJS-256",  newCode: "PSJ-256",  note: "Jet Spray 1.5 Mtr — letters transposed" },
  { oldCode: "WMH-2331", newCode: "WIH-2331", note: "Washing Machine Inlet Hose 1.5 Mtr" },
  { oldCode: "WMH-2332", newCode: "WIH-2332", note: "Washing Machine Inlet Hose 3 Mtr" },
  { oldCode: "RPS-2285", newCode: "RPS-2265", note: "Sink Mixer" },
  { oldCode: "WMP-186",  newCode: "WMP-188",  note: "Washing Machine Pipe 2 Mtr" },
  { oldCode: "WMP-188",  newCode: "WMP-189",  note: "Washing Machine Pipe 3 Mtr" },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function seedAliasesIfNeeded(competitor: string): Promise<void> {
  if (competitor !== "Sparsh Pearl") return;
  for (const a of SPARSH_ALIASES) {
    await db
      .insert(competitorCodeAliasesTable)
      .values({ competitor, oldCode: a.oldCode, newCode: a.newCode, note: a.note })
      .onConflictDoNothing();
  }
}

async function getAliases(competitor: string): Promise<CodeAlias[]> {
  return db
    .select({ oldCode: competitorCodeAliasesTable.oldCode, newCode: competitorCodeAliasesTable.newCode })
    .from(competitorCodeAliasesTable)
    .where(eq(competitorCodeAliasesTable.competitor, competitor));
}

async function getCurrentPrayagMrp(): Promise<Map<string, number>> {
  const rows = await db
    .select({ itemCode: mrpPriceHistoryTable.itemCode, mrp: mrpPriceHistoryTable.mrp })
    .from(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.isCurrent, true));
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.mrp != null) map.set(normCode(r.itemCode), r.mrp);
  }
  return map;
}

async function getTargets(
  competitor: string,
  prayagMrpMap: Map<string, number>,
): Promise<MatchTarget[]> {
  // Latest matched row per Prayag code for this competitor
  const rows = await db.execute<{
    competitor_code: string | null;
    matched_prayag_code: string | null;
    description: string | null;
    size: string | null;
    price: number | null;
  }>(sql`
    SELECT DISTINCT ON (matched_prayag_code)
      competitor_code, matched_prayag_code, description, size, price
    FROM competitor_prices
    WHERE competitor = ${competitor} AND matched_prayag_code IS NOT NULL
    ORDER BY matched_prayag_code, effective_date DESC NULLS LAST, id DESC
  `);

  const products = await db
    .select({ itemCode: catalogProductsTable.itemCode, productName: catalogProductsTable.productName })
    .from(catalogProductsTable);
  const nameMap = new Map(products.map((p) => [normCode(p.itemCode), p.productName]));

  return rows.rows.map((r) => ({
    competitorCode: r.competitor_code,
    matchedPrayagCode: r.matched_prayag_code!,
    description: nameMap.get(normCode(r.matched_prayag_code ?? "")) ?? r.description,
    size: r.size,
    existingPrice: r.price,
    prayagMrpCurrent: r.matched_prayag_code
      ? (prayagMrpMap.get(normCode(r.matched_prayag_code)) ?? null)
      : null,
  }));
}

async function recomputeCurrentFlags(competitor: string): Promise<void> {
  await db.execute(
    sql`UPDATE competitor_prices SET is_current = false WHERE competitor = ${competitor}`,
  );
  await db.execute(sql`
    UPDATE competitor_prices SET is_current = true
    WHERE id IN (
      SELECT DISTINCT ON (competitor, matched_prayag_code) id
      FROM competitor_prices
      WHERE competitor = ${competitor} AND matched_prayag_code IS NOT NULL
      ORDER BY competitor, matched_prayag_code, effective_date DESC NULLS LAST, id DESC
    )
  `);
  await db.execute(sql`
    UPDATE competitor_prices SET is_current = true
    WHERE competitor = ${competitor} AND matched_prayag_code IS NULL
      AND effective_date = (
        SELECT MAX(effective_date) FROM competitor_prices
        WHERE competitor = ${competitor} AND matched_prayag_code IS NULL
      )
  `);
}

// ---------------------------------------------------------------------------
// POST /catalog/import-batches
// ---------------------------------------------------------------------------
router.post(
  "/catalog/import-batches",
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

    const competitor =
      typeof req.body.competitor === "string" && req.body.competitor.trim()
        ? req.body.competitor.trim()
        : null;
    if (!competitor) { res.status(400).json({ error: "competitor is required" }); return; }

    const rawDate = typeof req.body.effectiveDate === "string" ? req.body.effectiveDate.trim() : "";
    const effectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : new Date().toISOString().slice(0, 10);

    const priceBasis = req.body.priceBasis === "Ex-GST" ? "Ex-GST" : "MRP";
    const gstPct =
      priceBasis === "Ex-GST"
        ? (isNaN(Number(req.body.gstPct)) ? 18 : Number(req.body.gstPct))
        : null;

    const ext = (file.originalname.toLowerCase().split(".").pop() ?? "");
    if (ext !== "pdf") {
      res.status(400).json({ error: "This endpoint only accepts PDF files. Upload Excel/CSV via /catalog/load-competitor." });
      return;
    }

    // Helper to send SSE events
    const sendSse = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // Flush if available (compression middleware may buffer)
      if (typeof (res as any).flush === "function") (res as any).flush();
    };

    // Set up SSE stream before any async work
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    try {
      await seedAliasesIfNeeded(competitor);

      sendSse("status", { stage: "preparing", message: "Preparing extraction…" });

      const [batchRows] = await Promise.all([
        db.insert(importBatchesTable)
          .values({ competitor, effectiveDate, sourceFileName: file.originalname, priceBasis, gstPct, status: "pending" })
          .returning(),
      ]);
      const batch = batchRows[0];
      if (!batch) {
        sendSse("error", { error: "Failed to create batch" });
        res.end();
        return;
      }
      const batchId = batch.id;

      // Extract + match (may take 30–90 s for a 100-page catalogue)
      const prayagMrpMap = await getCurrentPrayagMrp();
      const [targets, aliases] = await Promise.all([
        getTargets(competitor, prayagMrpMap),
        getAliases(competitor),
      ]);

      const targetCodes = targets.map((t) => t.competitorCode).filter((c): c is string => !!c);

      sendSse("status", { stage: "extracting", message: "Starting PDF extraction…" });

      const extracted = await extractFromPdf(
        file.buffer,
        targetCodes,
        SPARSH_CODE_FAMILIES,
        (p) => {
          req.log.info(p, "[importBatches] extraction progress");
          sendSse("progress", {
            chunk: p.chunk,
            totalChunks: p.totalChunks,
            startPage: p.startPage,
            endPage: p.endPage,
            totalItemsFound: p.totalItemsFound,
          });
        },
      );

      sendSse("status", { stage: "matching", message: "Matching products…" });

      const { staging, newProducts } = matchCatalogue(
        competitor, targets, extracted, aliases, priceBasis, gstPct,
      );

      type StagingInsert = typeof competitorPriceStagingTable.$inferInsert;

      const allRows: StagingInsert[] = [
        ...staging.map((s) => ({ ...s, batchId }) as StagingInsert),
        ...newProducts.map((item) => ({
          batchId,
          competitor,
          competitorCodeMaster: null,
          competitorCodeCatalogue: item.cat_no,
          matchedPrayagCode: null,
          description: null,
          catalogueDescription: item.product_name,
          variant: item.variant,
          oldMrp: null,
          newMrp: item.mrp,
          increasePct: null,
          prayagMrpCurrent: null,
          gapPct: null,
          page: item.page,
          matchMethod: null,
          status: "new_product" as const,
          reviewReason: null,
        }) as StagingInsert),
      ];

      for (let i = 0; i < allRows.length; i += 200) {
        await db.insert(competitorPriceStagingTable).values(allRows.slice(i, i + 200));
      }

      const counts = {
        ok: staging.filter((s) => s.status === "ok").length,
        needs_review: staging.filter((s) => s.status === "needs_review").length,
        not_found: staging.filter((s) => s.status === "not_found").length,
        new_products: newProducts.length,
      };
      await db.update(importBatchesTable)
        .set({ rowCounts: JSON.stringify(counts) })
        .where(eq(importBatchesTable.id, batchId));

      sendSse("done", { batchId, competitor, effectiveDate, priceBasis, gstPct, status: "pending", rowCounts: counts });
      res.end();
    } catch (err) {
      req.log.error({ err }, "import-batches POST failed");
      sendSse("error", { error: err instanceof Error ? err.message : "Failed to process file" });
      res.end();
    }
  },
);

// ---------------------------------------------------------------------------
// GET /catalog/import-batches
// ---------------------------------------------------------------------------
router.get("/catalog/import-batches", async (_req, res) => {
  const batches = await db
    .select()
    .from(importBatchesTable)
    .orderBy(desc(importBatchesTable.createdAt));
  res.json({
    batches: batches.map((b) => ({ ...b, rowCounts: b.rowCounts ? JSON.parse(b.rowCounts) : null })),
  });
});

// ---------------------------------------------------------------------------
// GET /catalog/import-batches/:id
// ---------------------------------------------------------------------------
router.get("/catalog/import-batches/:id", async (req, res) => {
  const batchId = parseInt(req.params.id ?? "", 10);
  if (isNaN(batchId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [batch] = await db.select().from(importBatchesTable).where(eq(importBatchesTable.id, batchId));
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  const rows = await db
    .select()
    .from(competitorPriceStagingTable)
    .where(eq(competitorPriceStagingTable.batchId, batchId))
    .orderBy(
      sql`CASE status WHEN 'needs_review' THEN 0 WHEN 'ok' THEN 1 WHEN 'not_found' THEN 2 ELSE 3 END`,
    );

  res.json({ ...batch, rowCounts: batch.rowCounts ? JSON.parse(batch.rowCounts) : null, rows });
});

// ---------------------------------------------------------------------------
// POST /catalog/import-batches/:id/approve
// ---------------------------------------------------------------------------
router.post("/catalog/import-batches/:id/approve", async (req, res) => {
  const batchId = parseInt(req.params.id ?? "", 10);
  if (isNaN(batchId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [batch] = await db.select().from(importBatchesTable).where(eq(importBatchesTable.id, batchId));
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }
  if (batch.status !== "pending") { res.status(409).json({ error: `Batch is already ${batch.status}` }); return; }

  const stagingRows = await db
    .select()
    .from(competitorPriceStagingTable)
    .where(eq(competitorPriceStagingTable.batchId, batchId));

  const toCommit = stagingRows.filter(
    (r) => (r.status === "ok" || r.status === "needs_review") && r.newMrp != null && r.matchedPrayagCode,
  );

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`DELETE FROM competitor_prices WHERE competitor = ${batch.competitor} AND effective_date = ${batch.effectiveDate}`,
    );

    if (toCommit.length > 0) {
      type Ins = typeof competitorPricesTable.$inferInsert;
      const values: Ins[] = toCommit.map((r) => ({
        competitor: batch.competitor,
        category: null,
        description: r.description,
        size: r.variant,
        price: r.newMrp!,
        unit: null,
        competitorCode: r.competitorCodeCatalogue ?? r.competitorCodeMaster,
        effectiveDate: batch.effectiveDate,
        matchedPrayagCode: r.matchedPrayagCode,
        matchStatus: "matched",
        matchConfidence: r.matchMethod === "code+desc" ? "High" : "Medium",
        prayagMrpAtCompare: r.prayagMrpCurrent,
        isCurrent: false,
        priceBasis: batch.priceBasis,
        gstPct: batch.gstPct,
      }));
      for (let i = 0; i < values.length; i += 200) {
        await tx.insert(competitorPricesTable).values(values.slice(i, i + 200));
      }
    }

    // Write newly discovered aliases (desc+size matches)
    const aliasRows = stagingRows.filter(
      (r) => r.matchMethod === "desc+size" && r.competitorCodeMaster && r.competitorCodeCatalogue,
    );
    for (const r of aliasRows) {
      await tx
        .insert(competitorCodeAliasesTable)
        .values({
          competitor: batch.competitor,
          oldCode: r.competitorCodeMaster!,
          newCode: r.competitorCodeCatalogue!,
          note: `Discovered in batch ${batchId}`,
        })
        .onConflictDoNothing();
    }

    await tx.update(importBatchesTable).set({ status: "approved" }).where(eq(importBatchesTable.id, batchId));
  });

  await recomputeCurrentFlags(batch.competitor);

  res.json({ ok: true, committed: toCommit.length });
});

// ---------------------------------------------------------------------------
// DELETE /catalog/import-batches/:id — discard
// ---------------------------------------------------------------------------
router.delete("/catalog/import-batches/:id", async (req, res) => {
  const batchId = parseInt(req.params.id ?? "", 10);
  if (isNaN(batchId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [batch] = await db.select().from(importBatchesTable).where(eq(importBatchesTable.id, batchId));
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }
  if (batch.status === "approved") { res.status(409).json({ error: "Cannot discard an approved batch" }); return; }

  await db.delete(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, batchId));
  await db.update(importBatchesTable).set({ status: "discarded" }).where(eq(importBatchesTable.id, batchId));

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /catalog/import-batches/:id/export — review Excel download
// ---------------------------------------------------------------------------
router.get("/catalog/import-batches/:id/export", async (req, res) => {
  const batchId = parseInt(req.params.id ?? "", 10);
  if (isNaN(batchId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [batch] = await db.select().from(importBatchesTable).where(eq(importBatchesTable.id, batchId));
  if (!batch) { res.status(404).json({ error: "Not found" }); return; }

  const stagingRows = await db
    .select()
    .from(competitorPriceStagingTable)
    .where(eq(competitorPriceStagingTable.batchId, batchId))
    .orderBy(
      sql`CASE status WHEN 'needs_review' THEN 0 WHEN 'ok' THEN 1 WHEN 'not_found' THEN 2 ELSE 3 END`,
      competitorPriceStagingTable.matchedPrayagCode,
    );

  const [products, currentMrpRows] = await Promise.all([
    db.select().from(catalogProductsTable).orderBy(catalogProductsTable.itemCode),
    db.select().from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.isCurrent, true)),
  ]);
  const mrpMap = new Map(currentMrpRows.map((r) => [r.itemCode, r]));
  const stagingByPrayag = new Map<string, typeof stagingRows[number]>();
  for (const r of stagingRows) {
    if (r.matchedPrayagCode && (r.status === "ok" || r.status === "needs_review")) {
      stagingByPrayag.set(r.matchedPrayagCode, r);
    }
  }

  const prayagDate =
    [...new Set(currentMrpRows.map((r) => r.effectiveDate))].sort().reverse()[0] ?? "Current";

  const header = [
    "Prayag Code", "Prayag Product", "Division", "Category",
    `Prayag MRP (${prayagDate})`,
    `${batch.competitor} Code (Master)`, `${batch.competitor} Code (Catalogue)`,
    `${batch.competitor} MRP (${batch.effectiveDate})`,
    "Old MRP", "Increase %", "Gap % vs Prayag",
    "Match Method", "Status", "Review Reason", "Page",
  ];

  const body: (string | number | null)[][] = [];
  for (const p of products) {
    const s = stagingByPrayag.get(p.itemCode);
    if (!s) continue;
    const mrpRow = mrpMap.get(p.itemCode);
    body.push([
      p.itemCode, p.productName ?? "", p.division ?? "", p.category ?? "",
      mrpRow?.mrp ?? null,
      s.competitorCodeMaster ?? "", s.competitorCodeCatalogue ?? "",
      s.newMrp ?? null, s.oldMrp ?? null,
      s.increasePct != null ? Math.round(s.increasePct * 10) / 10 : null,
      s.gapPct != null ? Math.round(s.gapPct * 10) / 10 : null,
      s.matchMethod ?? "", s.status, s.reviewReason ?? "", s.page ?? null,
    ]);
  }
  // Append not_found rows
  for (const r of stagingRows.filter((r) => r.status === "not_found")) {
    body.push([
      r.matchedPrayagCode ?? "", r.description ?? "", "", "", "",
      r.competitorCodeMaster ?? "", "", null, r.oldMrp ?? null, null, null,
      "", "not_found", r.reviewReason ?? "", null,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Review");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fname = `${batch.competitor.replace(/\s+/g, "-")}-review-${batch.effectiveDate}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(buf);
});

export default router;
