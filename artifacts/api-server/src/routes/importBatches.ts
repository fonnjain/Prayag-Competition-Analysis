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
import { and, eq, sql, desc, ilike } from "drizzle-orm";
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
import { requireAdmin } from "../middlewares/authMiddleware";
import {
  extractFromPdf,
  EXTRACTION_MODEL,
  buildPdfBatchProvenance,
} from "../lib/pdfExtractor.js";
import {
  matchCatalogue,
  type MatchTarget,
  type CodeAlias,
} from "../lib/catalogueMatcher.js";
import type { CatalogueProfile } from "../lib/catalogueProfile.js";
import sparshPearlProfileJson from "../lib/catalogue-profiles/sparsh-pearl.json" assert { type: "json" };
import { isIsoDate } from "../lib/mrpProvenance.js";
import {
  extractPrinceTextPdf,
  reconcilePrincePdf,
} from "../lib/princeTextPdfExtractor.js";

const sparshPearlProfile = sparshPearlProfileJson as CatalogueProfile;

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150 MB for PDFs
});

// Known Sparsh Pearl code aliases (Vol 6.2 verified).
// After import diagnostics confirmed which codes are actually in the PDF extraction:
//   - WMP pipe renumbering: WMP-186→WMP-188 (2 Mtr), WMP-188→WMP-189 (3 Mtr)
//   - WC-100→WC-180 (Waste Coupling Half Thread renumbered)
// seedAliasesIfNeeded() does a full delete+insert so any correction here takes effect on next import.
const SPARSH_ALIASES: Array<{ oldCode: string; newCode: string; note: string }> = [
  { oldCode: "WC-100",   newCode: "WC-180",   note: "Waste Coupling Half Thread renumbered" },
  { oldCode: "PJS-255",  newCode: "PSJ-255",  note: "Jet Spray 1 Mtr — letters transposed" },
  { oldCode: "PJS-256",  newCode: "PSJ-256",  note: "Jet Spray 1.5 Mtr — letters transposed" },
  { oldCode: "WMH-2331", newCode: "WIH-2331", note: "Washing Machine Inlet Hose 1.5 Mtr" },
  { oldCode: "WMH-2332", newCode: "WIH-2332", note: "Washing Machine Inlet Hose 3 Mtr" },
  { oldCode: "WMP-186",  newCode: "WMP-188",  note: "Washing Machine Pipe 2 Mtr" },
  { oldCode: "WMP-188",  newCode: "WMP-189",  note: "Washing Machine Pipe 3 Mtr" },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function seedAliasesIfNeeded(competitor: string): Promise<void> {
  if (competitor !== "Sparsh Pearl") return;
  // Full re-seed: delete existing rows then insert the current canonical list.
  // This ensures any correction to SPARSH_ALIASES (wrong target, removed entry)
  // propagates automatically on the next import without a separate DB migration.
  await db
    .delete(competitorCodeAliasesTable)
    .where(eq(competitorCodeAliasesTable.competitor, competitor));
  if (SPARSH_ALIASES.length > 0) {
    await db.insert(competitorCodeAliasesTable).values(
      SPARSH_ALIASES.map((a) => ({
        competitor,
        oldCode: a.oldCode,
        newCode: a.newCode,
        note: a.note,
      })),
    );
  }
}

async function getAliases(competitor: string): Promise<CodeAlias[]> {
  return db
    .select({ oldCode: competitorCodeAliasesTable.oldCode, newCode: competitorCodeAliasesTable.newCode })
    .from(competitorCodeAliasesTable)
    .where(eq(competitorCodeAliasesTable.competitor, competitor));
}

async function getCurrentPrayagMrp(): Promise<Map<string, number>> {
  const result = await db.execute<{ item_code: string; mrp: number | null }>(sql`
    SELECT DISTINCT ON (h.item_code) h.item_code, h.mrp
    FROM mrp_price_history h
    JOIN catalog_products p ON p.item_code = h.item_code
    WHERE h.effective_date <= CURRENT_DATE
      AND h.review_status = 'approved'
      AND h.variant = 'Standard'
      AND p.is_active IS TRUE
      AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
    ORDER BY h.item_code, h.effective_date DESC, h.id DESC
  `);
  const map = new Map<string, number>();
  for (const r of result.rows) {
    if (r.mrp != null) map.set(normCode(r.item_code), r.mrp);
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
    category: string | null;
    description: string | null;
    size: string | null;
    price: number | null;
  }>(sql`
    SELECT competitor_code, matched_prayag_code, category, description, size, price
    FROM (
      SELECT competitor_code, matched_prayag_code, category, description, size, price, id,
        row_number() OVER (
          PARTITION BY matched_prayag_code
          ORDER BY effective_date DESC NULLS LAST, id DESC
        ) AS rn
      FROM competitor_prices
      WHERE competitor = ${competitor} AND matched_prayag_code IS NOT NULL
    ) latest
    WHERE rn = 1
    ORDER BY id
  `);

  const products = await db
    .select({ itemCode: catalogProductsTable.itemCode, productName: catalogProductsTable.productName })
    .from(catalogProductsTable);
  const nameMap = new Map(products.map((p) => [normCode(p.itemCode), p.productName]));

  return rows.rows.map((r) => ({
    competitorCode: r.competitor_code,
    matchedPrayagCode: r.matched_prayag_code!,
    category: r.category,
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

function resolveNewProductSeries(
  competitor: string,
  competitorCode: string | null,
): { sparshSeries: string; prayagSeries: string } {
  if (competitor !== "Sparsh Pearl") {
    return { sparshSeries: "—", prayagSeries: "—" };
  }

  const normalizedCode = competitorCode?.trim().toUpperCase() ?? "";
  const series = sparshPearlProfile.seriesMap.find((entry) =>
    normalizedCode.startsWith(entry.codePrefix),
  );

  return {
    sparshSeries: series?.sparshSeries ?? "Roman / allied",
    prayagSeries: series?.prayagSeries ?? "Roman / allied",
  };
}

// ---------------------------------------------------------------------------
// POST /catalog/import-batches
// ---------------------------------------------------------------------------
router.post(
  "/catalog/import-batches",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

    const competitor =
      typeof req.body.competitor === "string" && req.body.competitor.trim()
        ? req.body.competitor.trim()
        : null;
    if (!competitor) { res.status(400).json({ error: "competitor is required" }); return; }

    const effectiveDate =
      typeof req.body.effectiveDate === "string" ? req.body.effectiveDate.trim() : "";
  if (!isIsoDate(effectiveDate)) {
      res.status(400).json({
        error: "effectiveDate is required and must be a valid YYYY-MM-DD calendar date.",
      });
      return;
    }

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

    // Prince catalogues are text-native. Keep this path independent of the
    // existing vision extractor: pdftotext layout/bbox is deterministic,
    // preserves side-by-side x positions, and costs no model calls.
    if (competitor === "Prince") {
      try {
        const prayagMrpMap = await getCurrentPrayagMrp();
        const targets = await getTargets(competitor, prayagMrpMap);
        const { items, fileSha256 } = extractPrinceTextPdf(file.buffer);
        const expectedRows = targets
          .filter((target) => target.competitorCode && target.existingPrice != null)
          .map((target) => ({
            princeCode: target.competitorCode!,
            price: target.existingPrice!,
            category: target.category ?? target.description ?? undefined,
            sheet: target.category ?? target.description ?? undefined,
            lengthMeters: target.size ? Number(target.size.replace(/[^\d.]/g, "")) || null : null,
          }));
        const reconciliation = reconcilePrincePdf(items, expectedRows);
        const [existingBatch] = await db.select()
          .from(importBatchesTable)
          .where(and(
            eq(importBatchesTable.competitor, competitor),
            eq(importBatchesTable.effectiveDate, effectiveDate),
            eq(importBatchesTable.fileSha256, fileSha256),
            ilike(importBatchesTable.sourceFileName, "%.pdf"),
          ))
          .orderBy(desc(importBatchesTable.id))
          .limit(1);
        if (existingBatch) {
          const stored = existingBatch.rowCounts ? JSON.parse(existingBatch.rowCounts) as Record<string, unknown> : {};
          res.status(200).json({
            batchId: existingBatch.id,
            competitor,
            effectiveDate,
            fileSha256,
            status: existingBatch.status,
            rowCounts: stored,
            reconciliation: stored,
            idempotent: true,
          });
          return;
        }
        const itemsByCode = new Map<string, Array<typeof items[number]>>();
        for (const item of items) {
          const code = normCode(item.cat_no);
          itemsByCode.set(code, [...(itemsByCode.get(code) ?? []), item]);
        }
        const expectedByCode = new Map<string, typeof expectedRows>();
        for (const expectedRow of expectedRows) {
          const code = normCode(expectedRow.princeCode);
          expectedByCode.set(code, [...(expectedByCode.get(code) ?? []), expectedRow]);
        }
        const batchRows = await db.insert(importBatchesTable).values({
          competitor,
          effectiveDate,
          sourceFileName: file.originalname,
          priceBasis,
          gstPct,
          status: "pending",
          extractionModel: null,
          fileSha256,
          fileSizeBytes: file.size,
          extractorVersion: "prince-text-pdf-v1",
          catalogueProfileRevision: "prince-positional-bbox-v1",
          promptRevision: null,
          model: null,
          pagesRequested: null,
          passesRun: 1,
          itemsAdjudicated: 0,
          rowCounts: JSON.stringify({
            found: reconciliation.found,
            matched: reconciliation.matched,
            new: reconciliation.newCodes.length,
            missing: reconciliation.missingCodes.length,
            differences: reconciliation.differences,
          }),
        }).returning();
        const batch = batchRows[0];
        if (!batch) throw new Error("Failed to create Prince text extraction batch.");
        const occurrenceCursor = new Map<string, number>();
        const expectedOrdinal = new Map<string, number>();
        const rows = targets.map((target) => {
          const code = target.competitorCode ? normCode(target.competitorCode) : "";
          const ordinal = expectedOrdinal.get(code) ?? 0;
          const expectedRow = expectedByCode.get(code)?.[ordinal];
          if (code) expectedOrdinal.set(code, ordinal + 1);
          const expected = expectedRow?.price ?? null;
          const candidates = code ? itemsByCode.get(code) ?? [] : [];
          const expectedIndex = expectedRow ? expectedRows.indexOf(expectedRow) : -1;
          const comparison = expectedIndex >= 0 ? reconciliation.comparisons[expectedIndex] : undefined;
          const cursor = occurrenceCursor.get(code) ?? 0;
          const positionalCandidates = [...candidates].sort((a, b) =>
            a.page - b.page || a.xMin - b.xMin || (a.variant ?? "").localeCompare(b.variant ?? ""),
          );
          const metadataIndex = comparison && comparison.page != null
            ? positionalCandidates.findIndex((candidate) =>
                candidate.page === comparison.page &&
                candidate.xMin === comparison.xMin &&
                candidate.variant === comparison.variant,
              )
            : -1;
          const occurrenceIndex = metadataIndex >= cursor ? metadataIndex : cursor;
          const item = positionalCandidates[occurrenceIndex];
          if (code) occurrenceCursor.set(code, occurrenceIndex + 1);
          const difference = item && expected != null && Math.abs(item.piecePrice - expected) > 0.01;
          return {
            batchId: batch.id,
            competitor,
            competitorCodeMaster: target.competitorCode,
            competitorCodeCatalogue: item?.cat_no ?? null,
            matchedPrayagCode: target.matchedPrayagCode,
            description: target.description,
            catalogueDescription: item?.product_name ?? null,
            variant: item?.variant ?? target.size,
            oldMrp: expected,
            newMrp: item?.piecePrice ?? null,
            increasePct: item && expected ? ((item.piecePrice - expected) / expected) * 100 : null,
            prayagMrpCurrent: target.prayagMrpCurrent,
            gapPct: item && target.prayagMrpCurrent ? ((item.piecePrice - target.prayagMrpCurrent) / target.prayagMrpCurrent) * 100 : null,
            page: item?.page ?? null,
             discoveryEvidence: item ? JSON.stringify({
               extractor: "pdftotext",
               page: item.page,
               xMin: item.xMin,
               family: item.product_name,
               variant: item.variant,
               ratePerMetre: item.ratePerMetre,
               piecePrice: item.piecePrice,
               sourceTokens: item.sourceTokens,
             }) : null,
            adjudicated: false,
            matchMethod: item ? "code+position" : null,
            status: item ? (difference ? "needs_review" as const : "ok" as const) : "not_found" as const,
            reviewReason: difference ? `Price difference: workbook ${expected}, PDF ${item.piecePrice}` : null,
          };
        });
        const newItemsByCode = new Map<string, typeof items>();
        for (const item of items) {
          const code = normCode(item.cat_no);
          if (!expectedRows.some((row) => normCode(row.princeCode) === code)) {
            newItemsByCode.set(code, [...(newItemsByCode.get(code) ?? []), item]);
          }
        }
        const newRows = [...newItemsByCode.values()].map((occurrences) => {
          const item = occurrences[0]!;
          return ({
            batchId: batch.id,
            competitor,
            competitorCodeMaster: null,
            competitorCodeCatalogue: item.cat_no,
            matchedPrayagCode: null,
            description: null,
            catalogueDescription: item.product_name || null,
            variant: item.variant,
            oldMrp: null,
            newMrp: item.piecePrice,
            increasePct: null,
            prayagMrpCurrent: null,
            gapPct: null,
            page: item.page,
            discoveryEvidence: JSON.stringify({
              extractor: "pdftotext",
              occurrences: occurrences.map((occurrence) => ({
                page: occurrence.page,
                xMin: occurrence.xMin,
                variant: occurrence.variant,
                ratePerMetre: occurrence.ratePerMetre,
                piecePrice: occurrence.piecePrice,
                lengthMetres: occurrence.lengthMetres,
                sourceTokens: occurrence.sourceTokens,
              })),
            }),
            adjudicated: false,
            matchMethod: null,
            status: "new_product" as const,
            reviewReason: "PDF code has no existing Prince mapping; no mapping was inferred.",
          });
        });
        const uniqueStagingRows = new Map<string, (typeof rows)[number] | (typeof newRows)[number]>();
        for (const [index, row] of [...rows, ...newRows].entries()) {
          const key = row.matchedPrayagCode
            ? [
                normCode(row.competitorCodeCatalogue ?? `__missing_${index}`),
                normCode(row.matchedPrayagCode),
                (row.variant ?? row.description ?? "").trim().toUpperCase(),
              ].join("|")
            : normCode(row.competitorCodeCatalogue ?? `__missing_${index}`);
          const prior = uniqueStagingRows.get(key);
          if (!prior) {
            uniqueStagingRows.set(key, row);
            continue;
          }
          // PDF-only rows remain code-keyed. Mapped rows are keyed by the
          // complete Prince/Prayag/variant identity, so one-to-many mappings
          // cannot be collapsed during staging.
          const priorEvidence = prior.discoveryEvidence ? JSON.parse(prior.discoveryEvidence) as Record<string, unknown> : {};
          const duplicateEvidence = row.discoveryEvidence ? JSON.parse(row.discoveryEvidence) as Record<string, unknown> : {};
          prior.discoveryEvidence = JSON.stringify({
            ...priorEvidence,
            mappedPrayagCodes: [
              ...new Set([
                ...((priorEvidence.mappedPrayagCodes as string[] | undefined) ?? [prior.matchedPrayagCode].filter(Boolean) as string[]),
                ...((duplicateEvidence.mappedPrayagCodes as string[] | undefined) ?? [row.matchedPrayagCode].filter(Boolean) as string[]),
              ]),
            ],
          });
        }
        const allStagingRows = [...uniqueStagingRows.values()];
        const rowCounts = {
          found: reconciliation.found,
          matched: reconciliation.matched,
          new: reconciliation.newCodes.length,
          missing: reconciliation.missingCodes.length,
          differences: reconciliation.differences,
          comparisons: reconciliation.comparisons,
          stagedUniqueCodes: allStagingRows.length,
          pdfOccurrences: items.length,
          pdfUniqueCodes: new Set(items.map((item) => normCode(item.cat_no))).size,
          mappedStagingIdentities: allStagingRows.filter((row) => row.matchedPrayagCode != null).length,
        };
        await db.update(importBatchesTable)
          .set({ rowCounts: JSON.stringify(rowCounts) })
          .where(eq(importBatchesTable.id, batch.id));
        for (let index = 0; index < allStagingRows.length; index += 200) {
          await db.insert(competitorPriceStagingTable).values(allStagingRows.slice(index, index + 200));
        }
        res.status(201).json({
          batchId: batch.id,
          competitor,
          effectiveDate,
          fileSha256,
          status: "pending",
          rowCounts,
          reconciliation,
        });
        return;
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Could not extract Prince text PDF." });
        return;
      }
    }

    // Helper to send SSE events
    const sendSse = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
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
    // A vision request can take more than a minute. Send an SSE comment every
    // 15 seconds so reverse proxies and browser fetch keep the stream open
    // while Claude is processing a PDF chunk.
    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      res.write(": keep-alive\n\n");
      if (typeof (res as any).flush === "function") (res as any).flush();
    }, 15_000);
    const closeSse = () => {
      clearInterval(heartbeat);
      if (!res.writableEnded && !res.destroyed) res.end();
    };

    try {
      await seedAliasesIfNeeded(competitor);

      sendSse("status", { stage: "preparing", message: "Preparing extraction…" });
      // Resolve profile before persisting so the original requested pages are
      // part of the immutable batch provenance.
      const catalogueProfile =
        competitor === "Sparsh Pearl" ? sparshPearlProfile : undefined;
      const provenance = buildPdfBatchProvenance(file.buffer, catalogueProfile);

      const [batchRows] = await Promise.all([
        db.insert(importBatchesTable)
          .values({
            competitor,
            effectiveDate,
            sourceFileName: file.originalname,
            priceBasis,
            gstPct,
            status: "pending",
            extractionModel: EXTRACTION_MODEL,
            ...provenance,
          })
          .returning(),
      ]);
      const batch = batchRows[0];
      if (!batch) {
        sendSse("error", { error: "Failed to create batch" });
        res.end();
        return;
      }
      const batchId = batch.id;
      // Let the browser recover the import even if an intermediate SSE
      // connection drops while extraction continues safely on the server.
      sendSse("batch", { batchId });

      // Extract + match (may take 30–90 s for a 100-page catalogue)
      const prayagMrpMap = await getCurrentPrayagMrp();
      const [targets, aliases] = await Promise.all([
        getTargets(competitor, prayagMrpMap),
        getAliases(competitor),
      ]);

      const targetCodes = targets.map((t) => t.competitorCode).filter((c): c is string => !!c);

      // Resolve profile for this competitor (Sparsh Pearl → sparshPearlProfile).
      // Add more profiles here as new competitors are onboarded.
      const profileCodeFamilies =
        catalogueProfile?.codeFamilies ?? sparshPearlProfile.codeFamilies;

      sendSse("status", {
        stage: "extracting",
        message: catalogueProfile
          ? `Extracting ${catalogueProfile.codeFamilies.length > 0 ? "profile" : ""} pages from PDF…`
          : "Starting PDF extraction…",
      });

      const {
        items: extracted,
        failedChunks,
        pagesSent,
        pagesRequested,
        pagesSupplemental,
        pagesWidened,
        coverage,
        passesRun,
        pagesAdjudicated,
        codesFoundBothPasses,
        codesFoundOnePassOnly,
        itemsAdjudicated,
        modelCalls,
        elapsedMs,
      } = await extractFromPdf(
        file.buffer,
        targetCodes,
        profileCodeFamilies,
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
        catalogueProfile,
      );

      if (failedChunks.length > 0) {
        req.log.warn({ failedChunks }, "[importBatches] some PDF chunks failed extraction");
      }

      if (coverage < 0.95) {
        req.log.warn(
          { coverage, pagesWidened },
          "[importBatches] low coverage after extraction — catalogue structure may have changed",
        );
      }

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
           discoveryEvidence: JSON.stringify({
             foundInPasses: item.discoveryPasses,
             finalPass: item.adjudicated ? 3 : 2,
           }),
           adjudicated: item.adjudicated,
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
        // Extraction quality metadata
        pagesSent,
         pagesRequested,
         supplemental_pages: pagesSupplemental,
        pagesWidened,
        coverage: Math.round(coverage * 1000) / 1000, // 3 decimal places
         codes_found_both_passes: codesFoundBothPasses,
         codes_found_one_pass_only: codesFoundOnePassOnly,
         pages_adjudicated: pagesAdjudicated,
         items_adjudicated: itemsAdjudicated,
         passes_run: passesRun,
         model_calls: modelCalls,
         extraction_elapsed_ms: elapsedMs,
      };
      await db.update(importBatchesTable)
        .set({
          rowCounts: JSON.stringify(counts),
          pagesRequested: JSON.stringify(pagesRequested),
          passesRun,
          itemsAdjudicated,
        })
        .where(eq(importBatchesTable.id, batchId));

      const failedChunksSummary = failedChunks.map((fc) => ({
        chunkIndex: fc.chunkIndex,
        startPage: fc.startPage,
        endPage: fc.endPage,
      }));

      const coverageWarning =
        coverage < 0.95
          ? `Only ${Math.round(coverage * 100)}% of mapped products were found. ` +
            `${pagesWidened ? "Page range was widened automatically but coverage is still low. " : ""}` +
            `The catalogue structure may have changed — verify the page mapping before approving.`
          : null;

      sendSse("done", {
        batchId,
        competitor,
        effectiveDate,
        priceBasis,
        gstPct,
        status: "pending",
        rowCounts: counts,
        failedChunks: failedChunksSummary,
        coverageWarning,
      });
      closeSse();
    } catch (err) {
      req.log.error({ err }, "import-batches POST failed");
      sendSse("error", { error: err instanceof Error ? err.message : "Failed to process file" });
      closeSse();
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
  const batchId = parseInt(String(req.params.id ?? ""), 10);
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
router.post("/catalog/import-batches/:id/approve", requireAdmin, async (req, res) => {
  const batchId = parseInt(String(req.params.id ?? ""), 10);
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
router.delete("/catalog/import-batches/:id", requireAdmin, async (req, res) => {
  const batchId = parseInt(String(req.params.id ?? ""), 10);
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

  const [products, currentMrpResult] = await Promise.all([
    db
      .select()
      .from(catalogProductsTable)
      .where(and(
        eq(catalogProductsTable.isActive, true),
        sql`(${catalogProductsTable.discontinuedFrom} is null or ${catalogProductsTable.discontinuedFrom} > CURRENT_DATE)`,
      ))
      .orderBy(catalogProductsTable.itemCode),
    db.execute<{
      item_code: string;
      mrp: number | null;
      effective_date: string;
    }>(sql`
      SELECT DISTINCT ON (h.item_code)
        h.item_code, h.mrp, h.effective_date
      FROM mrp_price_history h
      JOIN catalog_products p ON p.item_code = h.item_code
      WHERE h.effective_date <= CURRENT_DATE
        AND h.review_status = 'approved'
        AND h.variant = 'Standard'
        AND p.is_active IS TRUE
        AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
      ORDER BY h.item_code, h.effective_date DESC, h.id DESC
    `),
  ]);
  const currentMrpRows = currentMrpResult.rows;
  const mrpMap = new Map(currentMrpRows.map((r) => [r.item_code, r]));
  const stagingByPrayag = new Map<string, typeof stagingRows[number]>();
  for (const r of stagingRows) {
    if (r.matchedPrayagCode && (r.status === "ok" || r.status === "needs_review")) {
      stagingByPrayag.set(r.matchedPrayagCode, r);
    }
  }

  const prayagDate =
    [...new Set(currentMrpRows.map((r) => r.effective_date))].sort().reverse()[0] ?? "Current";

  const header = [
    "Prayag Code", "Prayag Product", "Division", "Category",
    "Prayag MRP", "Prayag Effective Date",
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
      mrpRow?.mrp ?? null, mrpRow?.effective_date ?? null,
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
      r.matchedPrayagCode ?? "", r.description ?? "", "", "", "", "",
      r.competitorCodeMaster ?? "", "", null, r.oldMrp ?? null, null, null,
      "", "not_found", r.reviewReason ?? "", null,
    ]);
  }

  const newProductHeader = [
    `${batch.competitor} Code`,
    "Product Name (Extracted)",
    "MRP",
    "Catalogue Page",
    `${batch.competitor} Series`,
    "Equivalent Prayag Series",
    "Does an equivalent exist",
    "Prayag Cat No.",
    "Notes",
  ];
  const newProductBody = stagingRows
    .filter((r) => r.status === "new_product")
    .map((r) => {
      const series = resolveNewProductSeries(batch.competitor, r.competitorCodeCatalogue);
      return [
        r.competitorCodeCatalogue ?? r.competitorCodeMaster ?? "",
        r.catalogueDescription ?? r.description ?? "",
        r.newMrp ?? null,
        r.page ?? null,
        series.sparshSeries,
        series.prayagSeries,
        "",
        "",
        "",
      ];
    });

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const newProductsWs = XLSX.utils.aoa_to_sheet([newProductHeader, ...newProductBody]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Review");
  XLSX.utils.book_append_sheet(wb, newProductsWs, "New Products");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fname = `${batch.competitor.replace(/\s+/g, "-")}-review-${batch.effectiveDate}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(buf);
});

export default router;
