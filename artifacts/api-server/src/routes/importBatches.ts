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
import { createHash } from "node:crypto";
import multer from "multer";
import { and, eq, sql, desc } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  db,
  importBatchesTable,
  competitorPriceStagingTable,
  competitorPricesTable,
  competitorMappingDecisionsTable,
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
  type ExtractionProgress,
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
import {
  isExtractionPath,
  PdfTextExtractionUnavailableError,
  preflightPdf,
  type ExtractionPath,
  type PdfPreflight,
} from "../lib/pdfPreflight.js";
import { mergeHybridItems, princeItemsToExtracted } from "../lib/pdfHybrid.js";
import {
  apolloPipeIdentity,
  assertApolloCodeAvailable,
} from "../lib/apolloPipeIdentity.js";
import type { ExtractedItem } from "../lib/pdfExtractor.js";

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
    code_source: string | null;
  }>(sql`
    SELECT competitor_code, code_source, matched_prayag_code, category, description, size, price
    FROM (
       SELECT competitor_code, code_source, matched_prayag_code, category, description, size, price, id,
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
    codeSource: r.code_source,
    matchedPrayagCode: r.matched_prayag_code!,
    category: r.category,
    description: competitor.toLowerCase() === "apollo"
      ? (r.description ?? nameMap.get(normCode(r.matched_prayag_code ?? "")) ?? null)
      : (nameMap.get(normCode(r.matched_prayag_code ?? "")) ?? r.description),
    size: r.size,
    existingPrice: r.price,
    prayagMrpCurrent: r.matched_prayag_code
      ? (prayagMrpMap.get(normCode(r.matched_prayag_code)) ?? null)
      : null,
  }));
}

/**
 * Apollo is the one PDF whose pipe references are internal handles rather than
 * supplier identifiers. Keep this adapter here (rather than weakening the
 * shared catalogue matcher) so Prince/Ashirvad/Sparsh retain their behaviour.
 */
function matchApolloPdf(
  targets: Array<MatchTarget & { codeSource?: string | null }>,
  extracted: ExtractedItem[],
  priceBasis: string,
  gstPct: number | null,
): { staging: Array<Record<string, unknown>>; coverageGaps: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = [];
  const gaps: Array<Record<string, unknown>> = [];
  const claimed = new Set<ExtractedItem>();
  const targetIdentityCounts = new Map<string, number>();
  for (const target of targets) {
    if (target.codeSource !== "locally_assigned") continue;
    const key = apolloPipeIdentity(target.description, target.size);
    if (key) targetIdentityCounts.set(key, (targetIdentityCounts.get(key) ?? 0) + 1);
  }
  const effectivePrice = (mrp: number) =>
    priceBasis === "Ex-GST" ? mrp * (1 + (gstPct ?? 18) / 100) : mrp;

  for (const target of targets) {
    const local = target.codeSource === "locally_assigned";
    const unverifiable = target.codeSource !== "supplier" && !local;
    if (unverifiable) {
      rows.push({
        ...target, competitorCodeMaster: null, competitorCodeCatalogue: null, newMrp: null,
        status: "needs_review", matchMethod: null,
        reviewReason: "Apollo code origin is unknown; refusing to guess supplier or locally-assigned identity.",
        catalogueDescription: null, variant: null, page: null, discoveryEvidence: null,
        adjudicated: false, increasePct: null, gapPct: null,
      });
      gaps.push({ category: target.category, description: target.description, size: target.size, reason: "unknown-code-source" });
      continue;
    }
    const targetIdentity = local ? apolloPipeIdentity(target.description, target.size) : null;
    const duplicateTarget = targetIdentity != null && (targetIdentityCounts.get(targetIdentity) ?? 0) > 1;
    const candidates = extracted.filter((item) => {
      if (claimed.has(item)) return false;
      if (local) {
        return targetIdentity != null && apolloPipeIdentity(item.product_name, item.variant) === targetIdentity;
      }
      return Boolean(item.cat_no && target.competitorCode) &&
        normCode(item.cat_no) === normCode(target.competitorCode);
    });
    const item = candidates[0];
    const ambiguous = duplicateTarget || (local && candidates.length > 1);
    if (ambiguous || (local && !item) || (!local && candidates.length === 0)) {
      rows.push({
        ...target, competitorCodeMaster: target.competitorCode, competitorCodeCatalogue: null,
        newMrp: null, status: "needs_review", matchMethod: "identity",
        reviewReason: ambiguous ? "Apollo pipe identity is ambiguous; no row was selected."
          : "Apollo catalogue row was not found; review as a new coverage row.",
        catalogueDescription: null, variant: null, page: null, discoveryEvidence: null,
        adjudicated: false, increasePct: null, gapPct: null,
      });
      if (!item) gaps.push({ category: target.category, description: target.description, size: target.size, reason: "not_found" });
      continue;
    }
    claimed.add(item!);
    if (item!.mrp == null || !Number.isFinite(item!.mrp) || item!.mrp <= 0) {
      rows.push({
        ...target, competitorCodeMaster: null, competitorCodeCatalogue: null, newMrp: null,
        status: "not_found", matchMethod: "identity", reviewReason: "Apollo coverage gap: catalogue row has no price.",
        catalogueDescription: item!.product_name, variant: item!.variant, page: item!.page,
        discoveryEvidence: null, adjudicated: item!.adjudicated, increasePct: null, gapPct: null,
      });
      gaps.push({ category: target.category, description: item!.product_name, size: item!.variant, reason: "no-price" });
      continue;
    }
    const newMrp = item!.mrp;
    // A matching supplier code alone cannot justify replacing a reviewed
    // workbook price: PDF OCR can pair a real code with another item's price.
    // Keep divergent quotes visible for review, but out of Apollo approval.
    const differsFromReviewedPrice = target.existingPrice != null &&
      Math.abs(newMrp - target.existingPrice) > 0.005;
    rows.push({
      ...target,
      competitorCodeMaster: target.competitorCode,
      competitorCodeCatalogue: item!.cat_no,
      codeSource: local ? "locally_assigned" : "supplier",
      catalogueDescription: item!.product_name, variant: item!.variant, newMrp,
      oldMrp: target.existingPrice,
      increasePct: target.existingPrice != null && target.existingPrice > 0
        ? ((newMrp - target.existingPrice) / target.existingPrice) * 100 : null,
      gapPct: target.prayagMrpCurrent ? ((effectivePrice(newMrp) - target.prayagMrpCurrent) / target.prayagMrpCurrent) * 100 : null,
      page: item!.page, discoveryEvidence: JSON.stringify({ source: "Apollo PDF", passes: item!.discoveryPasses }),
      adjudicated: item!.adjudicated, matchMethod: local ? "desc+size" : "code+desc",
      status: differsFromReviewedPrice ? "needs_review" : "ok",
      reviewReason: differsFromReviewedPrice
        ? "Apollo PDF price differs from the reviewed workbook price; verify product identity and supplier quote before importing."
        : null,
    });
  }
  // Apollo PDF rows that have no authoritative target are review-only
  // discoveries. Never promote their PDF cat_no into a supplier code.
  for (const item of extracted.filter((candidate) => !claimed.has(candidate))) {
    rows.push({
      competitor: "Apollo", competitorCodeMaster: null, competitorCodeCatalogue: null,
      matchedPrayagCode: null, description: null, catalogueDescription: item.product_name,
      variant: item.variant, newMrp: item.mrp > 0 ? item.mrp : null, oldMrp: null,
      increasePct: null, prayagMrpCurrent: null, gapPct: null, page: item.page,
      discoveryEvidence: JSON.stringify({ source: "Apollo PDF", catNoIgnored: item.cat_no }),
      adjudicated: item.adjudicated, matchMethod: null,
      status: "needs_review", reviewReason: item.mrp > 0
        ? "Apollo row has no master target; review-only discovery, no code inferred."
        : "Apollo coverage gap: catalogue row has no price.",
    });
    if (item.mrp <= 0) gaps.push({ description: item.product_name, size: item.variant, reason: "no-price-unmatched" });
  }
  return { staging: rows, coverageGaps: gaps };
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

type StoredPdfDecision = {
  extractionPath?: ExtractionPath;
  preflight?: PdfPreflight;
  override?: boolean;
  overrideReason?: string | null;
  gstSanityWarning?: {
    previousMedianGap: number;
    currentMedianGap: number;
    shiftPoints: number;
    previousBasis: string | null;
    currentBasis: string;
  } | null;
};

function parseRowCounts(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function medianNumber(values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2
    ? finite[middle]!
    : (finite[middle - 1]! + finite[middle]!) / 2;
}

export function buildGstSanityWarning(
  previousMedianGap: number | null,
  currentMedianGap: number | null,
  previousBasis: string | null,
  currentBasis: string,
) {
  const shiftPoints = previousMedianGap != null && currentMedianGap != null
    ? currentMedianGap - previousMedianGap
    : null;
  return shiftPoints != null && Math.abs(shiftPoints) > 10
    ? {
        previousMedianGap: previousMedianGap!,
        currentMedianGap: currentMedianGap!,
        shiftPoints,
        previousBasis,
        currentBasis,
        message: "GST likely wrong: median business gap moved by more than 10 percentage points. Review the basis before approval.",
      }
    : null;
}

async function previousComparableBatch(
  competitor: string,
  effectiveDate: string,
) {
  const rows = await db
    .select()
    .from(importBatchesTable)
    .where(and(
      eq(importBatchesTable.competitor, competitor),
      eq(importBatchesTable.status, "approved"),
      sql`${importBatchesTable.effectiveDate} < ${effectiveDate}`,
    ))
    .orderBy(desc(importBatchesTable.effectiveDate), desc(importBatchesTable.id))
    .limit(1);
  return rows[0];
}

async function gstContext(competitor: string) {
  const rows = await db
    .select({
      priceBasis: importBatchesTable.priceBasis,
      gstPct: importBatchesTable.gstPct,
      effectiveDate: importBatchesTable.effectiveDate,
      id: importBatchesTable.id,
    })
    .from(importBatchesTable)
    .where(and(
      eq(importBatchesTable.competitor, competitor),
      eq(importBatchesTable.status, "approved"),
    ))
    .orderBy(desc(importBatchesTable.effectiveDate), desc(importBatchesTable.id))
    .limit(1);
  return rows[0] ?? null;
}

export function duplicateDecision(
  existingRows: Array<typeof importBatchesTable.$inferSelect>,
  competitor: string,
  fileSha256: string,
  effectiveDate: string,
  extractionPath: ExtractionPath | null,
) {
  // Failed/discarded attempts are audit records, not reusable extraction results.
  const reusableRows = existingRows.filter((row) => row.status !== "failed" && row.status !== "discarded");
  const sameDate = reusableRows.filter((row) => row.effectiveDate === effectiveDate);
  const selectedPathRow = sameDate.find((row) => {
    const stored = parseRowCounts(row.rowCounts);
    return isExtractionPath(stored.extractionPath) && stored.extractionPath === extractionPath;
  });
  const existing = selectedPathRow ?? sameDate[0] ?? reusableRows[0];
  if (!existing) {
    return {
      action: "new",
      message: "No identical catalogue is recorded. A new review batch will be staged after you confirm the extraction path.",
      existingBatchId: null,
      existingMatches: [],
    };
  }
  const stored = parseRowCounts(existing.rowCounts);
  const storedPath = isExtractionPath(stored.extractionPath) ? stored.extractionPath : null;
  const samePath = Boolean(extractionPath && storedPath && extractionPath === storedPath);
  const exactDateAndPath = existing.effectiveDate === effectiveDate && samePath;
  const action = exactDateAndPath ? "reuse" : existing.effectiveDate === effectiveDate ? "supersede" : "new_period";
  return {
    action,
    message: action === "reuse"
      ? `Identical ${competitor} catalogue (SHA ${fileSha256.slice(0, 12)}…) already exists as batch ${existing.id}; it will be reused and will not duplicate prices.`
      : action === "new_period"
        ? `Identical ${competitor} catalogue exists as batch ${existing.id} for ${existing.effectiveDate}; this upload will create a new period for ${effectiveDate} referencing the same source, not a new file.`
        : `Identical PDF exists as batch ${existing.id} with extraction path ${storedPath}; choosing ${extractionPath} will create a superseding review batch, not duplicate approved prices.`,
    existingBatchId: existing.id,
    existingStatus: existing.status,
    sameCompetitor: existing.competitor === competitor,
    sameEffectiveDate: existing.effectiveDate === effectiveDate,
    sameExtractionPath: samePath,
    existingMatches: existingRows.map((row) => {
      const rowCounts = parseRowCounts(row.rowCounts);
      return {
        batchId: row.id,
        effectiveDate: row.effectiveDate,
        status: row.status,
        extractionPath: isExtractionPath(rowCounts.extractionPath) ? rowCounts.extractionPath : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// POST /catalog/import-batches/preflight
// ---------------------------------------------------------------------------
// This endpoint is intentionally read-only. It hashes and samples the PDF,
// reports the detector evidence, and checks duplicate/GST context without
// creating an import batch or staging a price.
router.post(
  "/catalog/import-batches/preflight",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }
    if ((file.originalname.toLowerCase().split(".").pop() ?? "") !== "pdf") {
      res.status(400).json({ error: "This endpoint only accepts PDF files." });
      return;
    }
    const competitor = typeof req.body.competitor === "string" ? req.body.competitor.trim() : "";
    if (!competitor) { res.status(400).json({ error: "competitor is required" }); return; }
    const effectiveDate =
      typeof req.body.effectiveDate === "string" ? req.body.effectiveDate.trim() : "";
    if (effectiveDate && !isIsoDate(effectiveDate)) {
      res.status(400).json({
        error: "effectiveDate must be an unambiguous ISO date in yyyy-mm-dd format (for example 2026-03-01).",
      });
      return;
    }
    try {
      const preflight = await preflightPdf(file.buffer);
      const existingRows = await db
        .select()
        .from(importBatchesTable)
        .where(and(
          eq(importBatchesTable.competitor, competitor),
          eq(importBatchesTable.fileSha256, preflight.fileSha256),
        ))
        .orderBy(desc(importBatchesTable.id));
      const selectedPath = isExtractionPath(req.body.extractionPath)
        ? req.body.extractionPath
        : preflight.recommendedPath;
      const latestGst = await gstContext(competitor);
      const previous = effectiveDate
        ? await previousComparableBatch(competitor, effectiveDate)
        : undefined;
      const comparableRows = effectiveDate
        ? await db.select({
            id: importBatchesTable.id,
            status: importBatchesTable.status,
            effectiveDate: importBatchesTable.effectiveDate,
            priceBasis: importBatchesTable.priceBasis,
            gstPct: importBatchesTable.gstPct,
            fileSha256: importBatchesTable.fileSha256,
          }).from(importBatchesTable).where(and(
            eq(importBatchesTable.competitor, competitor),
            eq(importBatchesTable.effectiveDate, effectiveDate),
            eq(importBatchesTable.status, "approved"),
          )).orderBy(desc(importBatchesTable.id)).limit(1)
        : [];
      res.json({
        ...preflight,
        detected: preflight.detectedClass,
        recommendedPath: preflight.recommendedPath,
        duplicate: duplicateDecision(existingRows, competitor, preflight.fileSha256, effectiveDate, selectedPath),
        duplicateMatches: existingRows.map((row) => {
          const rowCounts = parseRowCounts(row.rowCounts);
          return {
            batchId: row.id,
            status: row.status,
            effectiveDate: row.effectiveDate,
            extractionPath: isExtractionPath(rowCounts.extractionPath) ? rowCounts.extractionPath : null,
          };
        }),
        existingBatch: existingRows[0] ? {
          id: existingRows[0].id,
          status: existingRows[0].status,
          effectiveDate: existingRows[0].effectiveDate,
          priceBasis: existingRows[0].priceBasis,
          gstPct: existingRows[0].gstPct,
        } : null,
        existingComparableBatch: comparableRows[0] ?? null,
        latestGst: latestGst ? {
          batchId: latestGst.id,
          effectiveDate: latestGst.effectiveDate,
          priceBasis: latestGst.priceBasis,
          gstPct: latestGst.gstPct,
        } : null,
        previousComparableBatch: previous ? {
          id: previous.id,
          effectiveDate: previous.effectiveDate,
          priceBasis: previous.priceBasis,
          gstPct: previous.gstPct,
        } : null,
      });
    } catch (error) {
      if (error instanceof PdfTextExtractionUnavailableError) {
        res.status(503).json({ error: error.message, code: error.code });
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not inspect PDF." });
    }
  },
);

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

    const suppliedPriceBasis = req.body.priceBasis === "Ex-GST" || req.body.priceBasis === "MRP"
      ? req.body.priceBasis
      : null;
    const existingGst = suppliedPriceBasis ? null : await gstContext(competitor);
    const priceBasis = suppliedPriceBasis ?? existingGst?.priceBasis ?? "MRP";
    const gstPct =
      priceBasis === "Ex-GST"
        ? (isNaN(Number(req.body.gstPct))
          ? (existingGst?.gstPct ?? 18)
          : Number(req.body.gstPct))
        : null;

    const ext = (file.originalname.toLowerCase().split(".").pop() ?? "");
    if (ext !== "pdf") {
      res.status(400).json({ error: "This endpoint only accepts PDF files. Upload Excel/CSV via /catalog/load-competitor." });
      return;
    }
    if (competitor.toLowerCase() === "apollo") {
      const existingMappings = await db.execute<{ ready: number }>(sql`
        SELECT count(*)::int AS ready
        FROM competitor_prices
        WHERE lower(competitor) = 'apollo'
          AND matched_prayag_code IS NOT NULL
          AND code_source IN ('supplier', 'locally_assigned')
      `);
      if (Number(existingMappings.rows[0]?.ready ?? 0) === 0) {
        res.status(422).json({
          code: "APOLLO_MASTER_MAPPING_REQUIRED",
          error: "Apollo PDF import needs reviewed, provenance-marked Apollo-to-Prayag mappings before extraction. No batch or prices were written.",
        });
        return;
      }
    }

    // Compute the same read-only evidence exposed by /preflight as a final
    // server-side guard. API clients cannot begin extraction without a
    // classification and an explicit (or automatically recommended) path.
    let preflight: PdfPreflight;
    try {
      preflight = await preflightPdf(file.buffer);
    } catch (error) {
      if (error instanceof PdfTextExtractionUnavailableError) {
        res.status(503).json({ error: error.message, code: error.code });
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not inspect PDF." });
      return;
    }
    if (!isExtractionPath(req.body.extractionPath)) {
      res.status(400).json({
        error: "extractionPath is required. Run PDF preflight and choose text, vision, or text_then_ai.",
        code: "PREFLIGHT_REQUIRED",
      });
      return;
    }
    if (typeof req.body.preflightSha256 !== "string" || !/^[0-9a-f]{64}$/.test(req.body.preflightSha256)) {
      res.status(400).json({
        error: "preflightSha256 is required. Run PDF preflight immediately before extraction.",
        code: "PREFLIGHT_REQUIRED",
      });
      return;
    }
    if (req.body.preflightSha256 !== preflight.fileSha256) {
      res.status(409).json({
        error: "The PDF changed after detection. Run Detect again before extraction.",
        code: "PREFLIGHT_STALE",
        preflightSha256: req.body.preflightSha256,
        fileSha256: preflight.fileSha256,
      });
      return;
    }
    const requestedPath = req.body.extractionPath;
    const extractionPathCandidate = requestedPath;
    if (!isExtractionPath(extractionPathCandidate)) {
      res.status(400).json({
        error: "This PDF is uncertain. Choose extractionPath text, vision, or text_then_ai after preflight.",
        preflight,
      });
      return;
    }
    const extractionPath: ExtractionPath = extractionPathCandidate;
    if ((extractionPath === "text" || extractionPath === "text_then_ai") && competitor !== "Prince") {
      res.status(422).json({
        error: `Text extraction is not supported for ${competitor}. Choose vision; no compatible positional profile is configured for this competitor.`,
        code: "UNSUPPORTED_EXTRACTION_PATH",
        supportedPaths: ["vision"],
      });
      return;
    }
    const override = extractionPath !== preflight.recommendedPath;
    const overrideReason =
      typeof req.body.overrideReason === "string" ? req.body.overrideReason.trim() : "";
    if (override && !overrideReason && preflight.detectedClass !== "uncertain") {
      res.status(400).json({
        error: "An overrideReason is required when overriding the detected extraction path.",
        preflight,
      });
      return;
    }

    const duplicateRows = await db
      .select()
      .from(importBatchesTable)
      .where(and(
        eq(importBatchesTable.competitor, competitor),
        eq(importBatchesTable.fileSha256, preflight.fileSha256),
      ))
      .orderBy(desc(importBatchesTable.id));
    const duplicate = duplicateDecision(
      duplicateRows,
      competitor,
      preflight.fileSha256,
      effectiveDate,
      extractionPath,
    );
    if (duplicate.action === "reuse" && duplicate.existingBatchId) {
      const existing = duplicateRows.find((row) => row.id === duplicate.existingBatchId);
      if (!existing) {
        res.status(409).json({ error: "Duplicate batch disappeared during idempotency check." });
        return;
      }
      const stored = parseRowCounts(existing.rowCounts);
      res.status(200).json({
        batchId: existing.id,
        competitor,
        effectiveDate,
        fileSha256: preflight.fileSha256,
        status: existing.status,
        rowCounts: stored,
        reconciliation: stored.reconciliation,
        duplicate,
        preflight,
        idempotent: true,
      });
      return;
    }

    // Prince catalogues are text-native. Keep this path independent of the
    // existing vision extractor: bundled PDF.js coordinates are deterministic,
    // preserves side-by-side x positions, and costs no model calls.
    if (competitor === "Prince" && extractionPath === "text") {
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const sendPrinceSse = (event: string, data: unknown) => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      };
      sendPrinceSse("status", { stage: "preparing", message: "Preparing positional text extraction…" });
      try {
        const prayagMrpMap = await getCurrentPrayagMrp();
        const targets = await getTargets(competitor, prayagMrpMap);
        const { items, fileSha256, pagesExecuted } = await extractPrinceTextPdf(file.buffer, {
          pages: Array.from({ length: preflight.totalPages }, (_, index) => index + 1),
        });
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
          catalogueProfileRevision: "prince-positional-pdfjs-v2",
          promptRevision: null,
          model: null,
          pagesRequested: null,
          passesRun: 1,
          itemsAdjudicated: 0,
           rowCounts: JSON.stringify({
             extractionPath,
             detectedClass: preflight.detectedClass,
             extractionOverride: override,
             extractionOverrideReason: overrideReason || null,
             preflight,
             pagesExecuted,
             duplicate,
            found: reconciliation.found,
            matched: reconciliation.matched,
            new: reconciliation.newCodes.length,
            missing: reconciliation.missingCodes.length,
            differences: reconciliation.differences,
           }),
        }).returning();
        const batch = batchRows[0];
        if (!batch) throw new Error("Failed to create Prince text extraction batch.");
         sendPrinceSse("batch", { batchId: batch.id });
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
               extractor: "pdfjs-dist",
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
              extractor: "pdfjs-dist",
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
         const currentMedianGap = medianNumber(allStagingRows.map((row) => row.gapPct ?? NaN));
          const previous = await previousComparableBatch(competitor, effectiveDate);
         let previousMedianGap: number | null = null;
         if (previous) {
           const previousRows = await db
             .select({ gapPct: competitorPriceStagingTable.gapPct })
             .from(competitorPriceStagingTable)
             .where(eq(competitorPriceStagingTable.batchId, previous.id));
           previousMedianGap = medianNumber(previousRows.map((row) => row.gapPct ?? NaN));
         }
          const gstSanityWarning = buildGstSanityWarning(
            previousMedianGap,
            currentMedianGap,
            previous?.priceBasis ?? null,
            priceBasis,
          );
        const rowCounts = {
           extractionPath,
           detectedClass: preflight.detectedClass,
           extractionOverride: override,
           extractionOverrideReason: overrideReason || null,
           preflight,
            pagesExecuted,
           duplicate,
            gstSanityWarning,
             gstBaseline: {
               previousBasis: previous?.priceBasis ?? null,
               previousMedianGap,
               currentBasis: priceBasis,
               currentMedianGap,
             },
            currentMedianGap,
            previousMedianGap,
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
        sendPrinceSse("done", {
          batchId: batch.id,
          competitor,
          effectiveDate,
          fileSha256,
          status: "pending",
          rowCounts,
         extractionPath,
         gstSanityWarning,
          reconciliation,
           preflight,
           duplicate,
        });
        res.end();
        return;
      } catch (error) {
        sendPrinceSse("error", { error: error instanceof Error ? error.message : "Could not extract Prince text PDF." });
        res.end();
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

    let createdBatchId: number | null = null;
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
            extractionModel: extractionPath === "text" ? null : EXTRACTION_MODEL,
            ...provenance,
            extractorVersion: extractionPath === "text"
              ? "pdf-vision-preflight-text_then_ai-v1"
              : `${provenance.extractorVersion}:${extractionPath}`,
            rowCounts: JSON.stringify({
              extractionPath,
              detectedClass: preflight.detectedClass,
              extractionOverride: override,
              extractionOverrideReason: overrideReason || null,
              preflight,
              duplicate,
              pageAssignment: {
                textBearing: preflight.textBearingPages,
                vision: extractionPath === "text" ? [] : preflight.nonTextBearingPages,
                note: extractionPath === "text_then_ai"
                  ? "Hybrid selection is explicit. The AI extractor receives the non-text-bearing page assignment; text-bearing assignment is retained for positional reconciliation."
                  : null,
              },
            }),
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
      createdBatchId = batchId;
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

       let hybridConflicts: Array<{ code: string; occurrence: number; values: number[]; pages: number[] }> = [];
       const onExtractionProgress = (p: ExtractionProgress) => {
         req.log.info(p, "[importBatches] extraction progress");
         sendSse("progress", {
           chunk: p.chunk,
           totalChunks: p.totalChunks,
           startPage: p.startPage,
           endPage: p.endPage,
           totalItemsFound: p.totalItemsFound,
         });
       };
       const extraction = extractionPath === "text_then_ai"
         ? await (async () => {
             const positional = await extractPrinceTextPdf(file.buffer, { pages: preflight.textBearingPages });
             return { positional };
           })()
         : null;
       const aiExtraction = extractionPath === "text_then_ai"
         ? await extractFromPdf(
             file.buffer,
             targetCodes,
             profileCodeFamilies,
             onExtractionProgress,
             undefined,
             { pages: preflight.nonTextBearingPages },
           )
         : await extractFromPdf(
             file.buffer,
             targetCodes,
             profileCodeFamilies,
             onExtractionProgress,
             catalogueProfile,
             { pages: Array.from({ length: preflight.totalPages }, (_, index) => index + 1) },
           );
       const extracted = extraction
         ? (() => {
             const merged = mergeHybridItems(
               princeItemsToExtracted(extraction.positional.items),
               aiExtraction.items,
             );
             hybridConflicts = merged.conflicts;
             return merged.items;
           })()
         : aiExtraction.items;
       const {
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
       } = aiExtraction;

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

        const apollo = competitor.toLowerCase() === "apollo";
        const apolloMatch = apollo
          ? matchApolloPdf(targets as Array<MatchTarget & { codeSource?: string | null }>, extracted, priceBasis, gstPct)
          : null;
        const matched = apolloMatch ?? matchCatalogue(
          competitor, targets, extracted, aliases, priceBasis, gstPct,
        );
       const conflictCodes = new Set(hybridConflicts.map((conflict) => conflict.code));
       const staging = matched.staging.map((row) => {
         const rowCode = normCode(row.competitorCodeCatalogue ?? row.competitorCodeMaster ?? "");
         if (!conflictCodes.has(rowCode)) return row;
         return {
           ...row,
           status: "needs_review" as const,
           reviewReason: `Hybrid extraction conflict for ${rowCode}; values ${hybridConflicts
             .filter((conflict) => conflict.code === rowCode)
             .flatMap((conflict) => conflict.values)
             .join(" vs ")} on pages ${hybridConflicts
             .filter((conflict) => conflict.code === rowCode)
             .flatMap((conflict) => conflict.pages)
             .join(", ")}. No value was silently selected.`,
         };
       });
        const newProducts: ExtractedItem[] = apollo
          ? []
          : ((matched as { newProducts?: ExtractedItem[] }).newProducts ?? []);

      type StagingInsert = typeof competitorPriceStagingTable.$inferInsert;

      const allRows: StagingInsert[] = [
           ...staging.map((s) => ({
             ...s, batchId, competitor, effectiveDate,
            // Non-Apollo extraction has no authoritative code-origin signal.
            // Keep that explicit rather than allowing a null/implicit origin.
            codeSource: apollo ? ((s as any).codeSource ?? "unverified") : "unverified",
          }) as unknown as StagingInsert),
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
            ...(apollo ? { codeSource: "unverified" } : {}),
        }) as StagingInsert),
      ];

      await db.transaction(async (tx) => {
        for (let i = 0; i < allRows.length; i += 200) {
          await tx.insert(competitorPriceStagingTable).values(allRows.slice(i, i + 200));
        }
      });

       const currentMedianGap = medianNumber(
         allRows.map((row) => row.gapPct ?? NaN),
       );
       const previous = await previousComparableBatch(competitor, effectiveDate);
       let previousMedianGap: number | null = null;
       if (previous) {
         const previousRows = await db
           .select({ gapPct: competitorPriceStagingTable.gapPct })
           .from(competitorPriceStagingTable)
           .where(eq(competitorPriceStagingTable.batchId, previous.id));
         previousMedianGap = medianNumber(previousRows.map((row) => row.gapPct ?? NaN));
       }
       const gstSanityWarning = buildGstSanityWarning(
         previousMedianGap,
         currentMedianGap,
         previous?.priceBasis ?? null,
         priceBasis,
       );
       const counts = {
         extractionPath,
         detectedClass: preflight.detectedClass,
         extractionOverride: override,
         extractionOverrideReason: overrideReason || null,
         preflight,
         duplicate,
         pageAssignment: {
           textBearing: preflight.textBearingPages,
           vision: extractionPath === "vision"
             ? Array.from({ length: preflight.totalPages }, (_, index) => index + 1)
             : extractionPath === "text" ? [] : preflight.nonTextBearingPages,
           executed: extractionPath === "text_then_ai"
             ? {
                 text: extraction!.positional.pagesExecuted,
                 vision: aiExtraction.pagesRequested,
               }
             : {
                 text: extractionPath === "text" ? pagesRequested : [],
                 vision: extractionPath === "vision" ? pagesRequested : [],
               },
           note: extractionPath === "text_then_ai"
             ? "Hybrid selection is explicit. The AI extractor receives the non-text-bearing page assignment; text-bearing assignment is retained for positional reconciliation."
             : null,
         },
         gstSanityWarning,
         gstBaseline: {
           previousBasis: previous?.priceBasis ?? null,
           previousMedianGap,
           currentBasis: priceBasis,
           currentMedianGap,
         },
         hybridConflicts,
         currentMedianGap,
         previousMedianGap,
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
         ...(apollo ? {
           source: "apollo_p045",
           coverageGaps: apolloMatch?.coverageGaps ?? [],
         } : {}),
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
         extractionPath,
         preflight,
         duplicate,
         gstSanityWarning,
      });
      closeSse();
    } catch (err) {
      req.log.error({ err }, "import-batches POST failed");
      if (createdBatchId !== null) {
        try {
          await db.update(importBatchesTable).set({ status: "failed" })
            .where(eq(importBatchesTable.id, createdBatchId));
        } catch (statusError) {
          req.log.error({ err: statusError, batchId: createdBatchId }, "Could not mark failed PDF batch");
        }
      }
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
  const batchTrusted = batch.competitor === "Prince" && (() => {
    try { return JSON.parse(batch.rowCounts ?? "{}").source === "trusted_prince_competitor_master"; } catch { return false; }
  })();
  if (batch.status !== "pending") {
    if (batch.status === "approved" && batchTrusted) {
      res.json({ ok: true, idempotent: true, inserted: 0, updated: 0, unchanged: 0, committed: 0 });
      return;
    }
    res.status(409).json({ error: `Batch is already ${batch.status}` }); return;
  }

  const stagingRows = await db
    .select()
    .from(competitorPriceStagingTable)
    .where(eq(competitorPriceStagingTable.batchId, batchId));
  const apolloBatch = batch.competitor.toLowerCase() === "apollo";
  if (apolloBatch) {
    const sourceRows = await db.execute<{ id: number; code_source: string | null }>(
      sql`SELECT id, code_source FROM competitor_price_staging WHERE batch_id = ${batchId}`,
    );
    const sourceById = new Map(sourceRows.rows.map((row) => [row.id, row.code_source]));
    for (const row of stagingRows) (row as any).codeSource = sourceById.get(row.id) ?? "unverified";
  }

  const toCommit = stagingRows.filter(
    (r) => (apolloBatch ? r.status === "ok" : (r.status === "ok" || r.status === "needs_review"))
      && r.newMrp != null && r.matchedPrayagCode,
  );
  const trustedPrince = batchTrusted;
  const trustedToCommit = trustedPrince
    ? stagingRows.filter((r) => r.status === "ok" && r.newMrp != null && r.matchedPrayagCode)
    : toCommit;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let excludedByDecision: Array<{ competitorCode: string | null; prayagCode: string | null; reason: string }> = [];
  let confirmedByDecision: Array<{ competitorCode: string | null; prayagCode: string | null }> = [];
  let beforeSnapshot: unknown;
  let afterSnapshot: unknown;
  let comparableBefore = 0;
  let comparableAfter = 0;
  const snapshot = async (tx: any) => {
    const [catalog, history] = await Promise.all([
      tx.execute(sql`SELECT * FROM catalog_products ORDER BY id`),
      tx.execute(sql`SELECT * FROM mrp_price_history ORDER BY id`),
    ]);
    const digest = (rows: unknown[]) => createHash("md5").update(JSON.stringify(rows)).digest("hex");
    return {
      catalogProducts: { count: catalog.rows.length, md5: digest(catalog.rows) },
      mrpPriceHistory: { count: history.rows.length, md5: digest(history.rows) },
    };
  };
  const comparable = async (tx: any) => {
    const result = await tx.execute(sql`
      SELECT count(*)::int AS count FROM competitor_prices cp
      WHERE cp.competitor = 'Prince' AND cp.matched_prayag_code IS NOT NULL
        AND cp.effective_date IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM (
            SELECT DISTINCT ON (h.item_code) h.item_code, h.mrp
            FROM mrp_price_history h
            WHERE h.variant = 'Standard' AND h.review_status = 'approved'
              AND h.effective_date <= cp.effective_date
            ORDER BY h.item_code, h.effective_date DESC, h.id DESC
          ) latest
          WHERE latest.item_code = cp.matched_prayag_code AND latest.mrp IS NOT NULL
        )
    `);
    return Number(result.rows[0]?.count ?? 0);
  };

  await db.transaction(async (tx) => {
    // Serialize trusted Prince writes with P034r2 decision application.  This
    // closes the gap between staging an old workbook and approving it.
    if (trustedPrince) await tx.execute(sql`SELECT pg_advisory_xact_lock(340342)`);
    beforeSnapshot = await snapshot(tx);
    comparableBefore = await comparable(tx);
    if (trustedPrince && process.env.NODE_ENV === "test" &&
      (req.body?.injectMrpMutation === "true" || req.body?.injectMrpMutation === true)) {
      await tx.execute(sql`UPDATE mrp_price_history SET mrp = mrp + 0.01 WHERE id = (SELECT id FROM mrp_price_history ORDER BY id LIMIT 1)`);
    }
    if (!trustedPrince && !apolloBatch) {
      await tx.execute(
        sql`DELETE FROM competitor_prices WHERE competitor = ${batch.competitor} AND effective_date = ${batch.effectiveDate}`,
      );
    }

    if (trustedPrince) {
      const activeDecisions = await tx.select().from(competitorMappingDecisionsTable).where(and(
        eq(competitorMappingDecisionsTable.competitor, "Prince"),
        sql`${competitorMappingDecisionsTable.undoneAt} IS NULL`,
      ));
      const exclusionMap = new Map(activeDecisions.filter((d) => d.decision === "exclusion")
        .map((d) => [`${normCode(d.competitorCode)}|${normCode(d.prayagCode)}`, d]));
      const confirmationCodes = new Set(activeDecisions.filter((d) => d.decision === "confirmation")
        .map((d) => normCode(d.competitorCode)));
      const guardedTrustedRows = trustedToCommit.filter((r) => {
        const code = r.competitorCodeCatalogue ?? r.competitorCodeMaster;
        const decision = exclusionMap.get(`${normCode(code)}|${normCode(r.matchedPrayagCode)}`);
        if (decision) {
          excludedByDecision.push({ competitorCode: code, prayagCode: r.matchedPrayagCode, reason: decision.reason });
          return false;
        }
        if (confirmationCodes.has(normCode(code))) {
          confirmedByDecision.push({ competitorCode: code, prayagCode: r.matchedPrayagCode });
        }
        return true;
      });
      const existing = await tx.select().from(competitorPricesTable).where(and(
        eq(competitorPricesTable.competitor, batch.competitor),
      ));
      const byCode = new Map(existing.map((row) => [`${row.effectiveDate}|${row.matchedPrayagCode}`, row]));
      for (const r of guardedTrustedRows) {
        const rowDate = r.effectiveDate ?? batch.effectiveDate;
        const prior = byCode.get(`${rowDate}|${r.matchedPrayagCode}`);
        if (!prior) {
          await tx.insert(competitorPricesTable).values({
            competitor: batch.competitor, category: null, description: r.description, size: r.variant,
            price: r.newMrp!, unit: null, competitorCode: r.competitorCodeCatalogue ?? r.competitorCodeMaster,
            effectiveDate: rowDate, matchedPrayagCode: r.matchedPrayagCode,
            matchStatus: "matched", matchConfidence: r.matchMethod === "code+desc" ? "High" : "Medium",
            prayagMrpAtCompare: r.prayagMrpCurrent, isCurrent: false, priceBasis: batch.priceBasis,
            gstPct: batch.gstPct, loadBatchId: batch.loadBatchId,
          });
          inserted++;
        } else if (prior.price !== r.newMrp) {
          await tx.update(competitorPricesTable).set({
            price: r.newMrp!, competitorCode: r.competitorCodeCatalogue ?? r.competitorCodeMaster,
            loadBatchId: batch.loadBatchId, updatedAt: new Date(),
          }).where(eq(competitorPricesTable.id, prior.id));
          updated++;
        } else {
          unchanged++;
        }
      }
    } else if (toCommit.length > 0) {
      type Ins = typeof competitorPricesTable.$inferInsert;
      const values: Ins[] = toCommit.map((r) => ({
        competitor: batch.competitor,
        category: null,
        description: r.description,
        size: r.variant,
        price: r.newMrp!,
        unit: null,
        competitorCode: apolloBatch && (r as any).codeSource === "locally_assigned"
          ? r.competitorCodeMaster
          : r.competitorCodeCatalogue ?? r.competitorCodeMaster,
        effectiveDate: batch.effectiveDate,
        matchedPrayagCode: r.matchedPrayagCode,
        matchStatus: "matched",
        matchConfidence: r.matchMethod === "code+desc" ? "High" : "Medium",
        prayagMrpAtCompare: r.prayagMrpCurrent,
        isCurrent: false,
        priceBasis: batch.priceBasis,
        gstPct: batch.gstPct,
        loadBatchId: batch.loadBatchId,
      }));
      if (apolloBatch) {
        const allCodes = await tx.execute<{
          competitor_code: string | null;
          matched_prayag_code: string | null;
          competitor: string;
          code_source: string | null;
        }>(
          sql`SELECT competitor_code, matched_prayag_code, competitor, code_source
              FROM competitor_prices WHERE competitor_code IS NOT NULL`,
        );
        for (const row of toCommit) {
          if ((row as any).codeSource === "locally_assigned" && row.competitorCodeMaster) {
            // Only reuse an existing internal handle for the same Apollo mapping.
            // A supplier code or a handle for another product must never be shadowed.
            const conflicting = allCodes.rows.filter((existing) =>
              normCode(existing.competitor_code) === normCode(row.competitorCodeMaster) &&
              !(existing.competitor === batch.competitor &&
                existing.code_source === "locally_assigned" &&
                existing.matched_prayag_code === row.matchedPrayagCode));
            if (conflicting.length) {
              assertApolloCodeAvailable(
                row.competitorCodeMaster,
                conflicting.map((item) => item.competitor_code),
              );
            }
          }
        }
      }
      if (apolloBatch) {
        const priorRows = await tx.select().from(competitorPricesTable).where(and(
          eq(competitorPricesTable.competitor, batch.competitor),
          eq(competitorPricesTable.effectiveDate, batch.effectiveDate),
        ));
        const priorByPrayag = new Map(priorRows.map((row) => [row.matchedPrayagCode, row]));
        for (const value of values) {
          const prior = priorByPrayag.get(value.matchedPrayagCode ?? null);
          if (!prior) {
            await tx.insert(competitorPricesTable).values(value);
            inserted++;
          } else if (prior.price !== value.price) {
            await tx.update(competitorPricesTable).set({
              price: value.price, competitorCode: value.competitorCode,
              loadBatchId: batch.loadBatchId, updatedAt: new Date(),
            }).where(eq(competitorPricesTable.id, prior.id));
            updated++;
          } else {
            unchanged++;
          }
        }
      } else {
        for (let i = 0; i < values.length; i += 200) {
          await tx.insert(competitorPricesTable).values(values.slice(i, i + 200));
        }
      }
      if (apolloBatch) {
        await tx.execute(sql`
          UPDATE competitor_prices c
          SET code_source = s.code_source
          FROM competitor_price_staging s
          WHERE s.batch_id = ${batchId}
            AND s.matched_prayag_code = c.matched_prayag_code
            AND c.competitor = ${batch.competitor}
            AND c.effective_date = ${batch.effectiveDate}
            AND s.code_source IS NOT NULL
        `);
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

    await tx.update(importBatchesTable).set({
      status: "approved",
      rowCounts: trustedPrince
        ? JSON.stringify({
          ...(() => { try { return JSON.parse(batch.rowCounts ?? "{}"); } catch { return {}; } })(),
          excluded_by_decision: excludedByDecision,
          confirmed_by_decision: confirmedByDecision,
        })
        : batch.rowCounts,
    }).where(eq(importBatchesTable.id, batchId));
    comparableAfter = await comparable(tx);
    afterSnapshot = await snapshot(tx);
    if (JSON.stringify(beforeSnapshot) !== JSON.stringify(afterSnapshot)) {
      throw new Error("P027r2 safety guard: catalog_products or mrp_price_history changed during competitor apply.");
    }
  });

  await recomputeCurrentFlags(batch.competitor);

  res.json({ ok: true, committed: trustedPrince ? trustedToCommit.length - excludedByDecision.length : toCommit.length,
    inserted: trustedPrince || apolloBatch ? inserted : undefined,
    updated: trustedPrince || apolloBatch ? updated : undefined,
    unchanged: trustedPrince || apolloBatch ? unchanged : undefined,
    beforeSnapshot, afterSnapshot, excludedByDecision, confirmedByDecision,
    comparableBefore, comparableAfter });
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
    batch.competitor === "Apollo" ? "Internal/reference code (Master)" : `${batch.competitor} Code (Master)`,
    `${batch.competitor} Code (Catalogue)`, "Code origin / provenance",
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
      s.competitorCodeMaster ?? "",
      s.codeSource === "locally_assigned" ? "" : (s.competitorCodeCatalogue ?? ""),
      s.codeSource === "locally_assigned" ? "Internal code — NOT supplier SKU"
        : s.codeSource === "supplier" ? "Supplier SKU" : "Origin unverified",
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
      r.competitorCodeMaster ?? "", "",
      r.codeSource === "locally_assigned" ? "Internal code — NOT supplier SKU"
        : r.codeSource === "supplier" ? "Supplier SKU" : "Origin unverified",
      null, r.oldMrp ?? null, null, null,
      "", "not_found", r.reviewReason ?? "", null,
    ]);
  }

  const newProductHeader = [
    `${batch.competitor} Code`,
    "Code origin / provenance",
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
        r.codeSource === "locally_assigned" ? "" : (r.competitorCodeCatalogue ?? r.competitorCodeMaster ?? ""),
        r.codeSource === "locally_assigned" ? "Internal code — NOT supplier SKU"
          : r.codeSource === "supplier" ? "Supplier SKU" : "Origin unverified",
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
  if (batch.competitor !== "Apollo") {
    XLSX.utils.book_append_sheet(wb, newProductsWs, "New Products");
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fname = `${batch.competitor.replace(/\s+/g, "-")}-review-${batch.effectiveDate}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(buf);
});

export default router;
