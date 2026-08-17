import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { eq, asc, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  catalogProductsTable,
  mrpPriceHistoryTable,
  competitorPricesTable,
} from "@workspace/db";
import { recomputeCurrentFlags, recomputeCompetitorCurrentFlags, normCode } from "../lib/catalog";
import { effectivePrice } from "../lib/analysis";

// Price-gap guardrail for auto-matched competitor imports. A correct match
// between equivalent products has a realistic gap; a gap far outside this band
// (e.g. a big assembly matched to a tiny fitting, or per-box vs per-pc) almost
// always means the wrong products were linked, so we send it to manual review
// instead of trusting the match. Gap% = (competitorEffectivePrice - prayagMrp)
// / prayagMrp * 100 (positive = competitor more expensive than Prayag).
const GAP_MIN_PCT = -80;
const GAP_MAX_PCT = 100;

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const NET_KEYWORDS = ["net", "rate", "dealer", "scheme", "billing", "discount"];
const MRP_KEYWORDS = ["mrp", "list", "retail", "price", "cost"];

// Headers that identify packing-quantity columns — these must never be used as
// the price column when loading Prayag MRP (they hold pcs/box, not ₹/item).
const PACKING_EXCLUDE_KEYWORDS = ["box", " pcs", "s.box", "m.box", "packing", "carton", "pcs/", "/pcs"];

// Sheet names that hold packing data — skip entirely when loading Prayag MRP.
const PACKING_SHEET_RE = /\bpacking\b/i;
// Sheet names that hold master pricing data — prefer these over other sheets.
const MASTER_SHEET_RE = /\bmaster\b/i;

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

interface ParsedRow {
  itemCode: string;
  price: number;
  productName: string | null;
  category: string | null;
}

export interface SkippedRow {
  rawCode: string;
  rawPrice: string;
  reason: string;
}

interface ParseResult {
  rows: ParsedRow[];
  basis: string;
  codeCol: number;
  priceCol: number;
  nameCol: number;
  categoryCol: number;
  codeColHeader: string;
  priceColHeader: string;
  skippedRows: SkippedRow[];
}

function parseSheet(grid: unknown[][], knownCodes: Set<string>): ParseResult {
  const maxCols = Math.max(0, ...grid.map((r) => r.length));

  // Detect header row: first row with several non-numeric string cells.
  let headerRow = 0;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const strs = (grid[r] ?? []).filter(
      (v) => typeof v === "string" && norm(v).length > 0 && isNaN(Number(v)),
    );
    if (strs.length >= 2) {
      headerRow = r;
      break;
    }
  }
  const rawHeaders = (grid[headerRow] ?? []).map((h) => norm(h));
  const headers = rawHeaders.map((h) => h.toLowerCase());

  // Columns whose headers signal serial numbers — never treat as item codes.
  const SERIAL_HEADER_TOKENS = ["s.no", "sno", "sr.no", "sl.no", "sr.", "sl.", "serial"];
  const isSerialHeader = (c: number) => {
    const h = (headers[c] ?? "").replace(/\s+/g, "").toLowerCase();
    if (h === "no" || h === "no." || h === "#") return true;
    return SERIAL_HEADER_TOKENS.some((t) => h === t || h.startsWith(t));
  };

  // Returns true when most non-empty data values in column c are consecutive
  // small integers — i.e. the column is a serial/row-number column.
  const isSequentialIntColumn = (c: number): boolean => {
    const nums: number[] = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRow) continue;
      const v = grid[r]?.[c];
      const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
      if (!isNaN(n) && n > 0 && Number.isInteger(n)) nums.push(n);
    }
    if (nums.length < 3) return false;
    const sorted = [...nums].sort((a, b) => a - b);
    let consecutive = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] <= 1) consecutive++;
    }
    return consecutive / (sorted.length - 1) > 0.75;
  };

  // Columns whose headers are measurement/dimension labels — not item codes.
  const DIMENSION_TOKENS = ["size", "length", "width", "height", "dia", "weight", "capacity"];
  const isDimensionHeader = (c: number) => {
    const h = (headers[c] ?? "").toLowerCase();
    return DIMENSION_TOKENS.some((t) => h.includes(t));
  };

  // Code column: prefer keyword-identified column first, then overlap.
  // Priority 1 — explicit code-column header ("code", "item code", "cat no.", etc.)
  const CODE_KEYWORDS = ["item code", "itemcode", "cat no", "catno", "cat. no"];
  let codeCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (isSerialHeader(c) || isDimensionHeader(c)) continue;
    const h = (headers[c] ?? "").toLowerCase().replace(/[\s.]/g, "");
    if (CODE_KEYWORDS.some((k) => k.replace(/[\s.]/g, "") === h || h.startsWith(k.replace(/[\s.]/g, "")))) {
      codeCol = c;
      break;
    }
  }
  // Priority 2 — looser keyword fallback ("code" or "item" in header)
  if (codeCol === -1) {
    for (let c = 0; c < maxCols; c++) {
      if (isSerialHeader(c) || isDimensionHeader(c)) continue;
      const h = headers[c] ?? "";
      if (h.includes("code") || h.includes("item")) {
        codeCol = c;
        break;
      }
    }
  }
  // Priority 3 — overlap scan (excluding serial, dimension, and sequential-int columns)
  if (codeCol === -1) {
    let bestOverlap = 0;
    for (let c = 0; c < maxCols; c++) {
      if (isSerialHeader(c) || isDimensionHeader(c) || isSequentialIntColumn(c)) continue;
      let overlap = 0;
      for (let r = 0; r < grid.length; r++) {
        if (r === headerRow) continue;
        if (knownCodes.has(normCode(grid[r]?.[c]))) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        codeCol = c;
      }
    }
  }
  if (codeCol === -1) {
    return { rows: [], basis: "Verify", codeCol: -1, priceCol: -1, nameCol: -1, categoryCol: -1, codeColHeader: "", priceColHeader: "", skippedRows: [] };
  }

  // Price column: header keyword, else first mostly-numeric column.
  // Columns whose headers indicate packing quantities are always excluded.
  const isPackingHeader = (h: string) =>
    PACKING_EXCLUDE_KEYWORDS.some((k) => h.includes(k));

  let netCol = -1;
  // Two-pass MRP scan: pass 1 looks for "new mrp" / "new" + mrp keyword (preferred);
  // pass 2 accepts any mrp keyword that doesn't have "old" in it; pass 3 accepts
  // any mrp keyword (including "old mrp") as a last resort.
  let mrpCol = -1;
  let newMrpCol = -1;  // explicit "new mrp" column
  let oldMrpCol = -1;  // "old mrp" fallback

  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol) continue;
    const h = headers[c] ?? "";
    if (isPackingHeader(h)) continue;  // never pick a packing column
    if (NET_KEYWORDS.some((k) => h.includes(k)) && netCol === -1) {
      netCol = c;
    } else if (MRP_KEYWORDS.some((k) => h.includes(k))) {
      const isNew = h.includes("new");
      const isOld = h.includes("old");
      if (isNew && newMrpCol === -1) newMrpCol = c;
      else if (!isOld && !isNew && mrpCol === -1) mrpCol = c;
      else if (isOld && oldMrpCol === -1) oldMrpCol = c;
    }
  }
  // Priority: explicit "new mrp" > generic mrp > "old mrp" > net
  const bestMrpCol = newMrpCol !== -1 ? newMrpCol : mrpCol !== -1 ? mrpCol : oldMrpCol;
  let priceCol = bestMrpCol !== -1 ? bestMrpCol : netCol;
  let basis = bestMrpCol !== -1 ? "MRP" : netCol !== -1 ? "Net" : "Verify";
  if (priceCol === -1) {
    for (let c = 0; c < maxCols; c++) {
      if (c === codeCol) continue;
      if (isPackingHeader(headers[c] ?? "")) continue;  // skip packing columns in fallback too
      let numericCount = 0;
      for (let r = 0; r < grid.length; r++) {
        if (r === headerRow) continue;
        const v = grid[r]?.[c];
        if (v != null && v !== "" && !isNaN(Number(v))) numericCount++;
      }
      if (numericCount > grid.length / 3) {
        priceCol = c;
        basis = "Verify";
        break;
      }
    }
  }
  if (priceCol === -1) {
    return { rows: [], basis: "Verify", codeCol, priceCol: -1, nameCol: -1, categoryCol: -1, codeColHeader: rawHeaders[codeCol] ?? String(codeCol), priceColHeader: "", skippedRows: [] };
  }

  // Name column: look for description/product-name keywords.
  const NAME_KEYWORDS = ["description", "product name", "product", "name", "item name", "particulars", "article", "details", "item description"];
  let nameCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol || c === priceCol) continue;
    const h = (headers[c] ?? "").toLowerCase().trim();
    if (NAME_KEYWORDS.some((k) => h === k || h.startsWith(k))) {
      nameCol = c;
      break;
    }
  }
  // Looser fallback: header contains "desc" or "product"
  if (nameCol === -1) {
    for (let c = 0; c < maxCols; c++) {
      if (c === codeCol || c === priceCol) continue;
      const h = headers[c] ?? "";
      if (h.includes("desc") || h.includes("product") || h.includes("particular")) {
        nameCol = c;
        break;
      }
    }
  }

  // Category column: look for "category", "type", "group", "series" keywords.
  const CATEGORY_KEYWORDS = ["category", "type", "group", "series", "segment", "sub-category", "subcategory"];
  let categoryCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol || c === priceCol || c === nameCol) continue;
    const h = (headers[c] ?? "").toLowerCase().trim();
    if (CATEGORY_KEYWORDS.some((k) => h === k || h.includes(k))) {
      categoryCol = c;
      break;
    }
  }

  const codeColHeader = rawHeaders[codeCol] ?? String(codeCol);
  const priceColHeader = rawHeaders[priceCol] ?? String(priceCol);

  const rows: ParsedRow[] = [];
  const skippedRows: SkippedRow[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (r === headerRow) continue;
    const row = grid[r] ?? [];
    const rawCodeVal = norm(row[codeCol]);
    const rawPriceVal = norm(row[priceCol]);
    // Skip completely empty rows silently
    if (!rawCodeVal && !rawPriceVal) continue;
    const code = normCode(row[codeCol]);
    if (!code) {
      // Record whenever either column has content — blank-code rows with a
      // valid price are a likely formatting issue the user needs to know about.
      if (rawCodeVal || rawPriceVal) {
        skippedRows.push({
          rawCode: rawCodeVal || "(blank)",
          rawPrice: rawPriceVal,
          reason: rawCodeVal ? "Item code could not be parsed" : "Item code is blank",
        });
      }
      continue;
    }
    const price = Number(row[priceCol]);
    if (isNaN(price) || price <= 0) {
      skippedRows.push({ rawCode: rawCodeVal, rawPrice: rawPriceVal, reason: price <= 0 ? "Price is zero or negative" : "Price is not a number" });
      continue;
    }
    const productName = nameCol !== -1 ? (norm(row[nameCol]) || null) : null;
    const category = categoryCol !== -1 ? (norm(row[categoryCol]) || null) : null;
    rows.push({ itemCode: code, price, productName, category });
  }

  return { rows, basis, codeCol, priceCol, nameCol, categoryCol, codeColHeader, priceColHeader, skippedRows };
}

interface LoadSummary {
  file: string;
  effectiveDate: string;
  basis: string;
  codeColHeader: string;
  priceColHeader: string;
  totalRows: number;
  matchedProducts: number;
  newProducts: number;
  newHistoryRows: number;
  skippedDuplicates: number;
  skippedUnparseable: number;
  unmatchedCodes: string[];
  /** Number of rows whose MRP is below ₹50 — near zero is expected for most categories;
   *  a high count almost certainly means a packing-quantity column was imported. */
  lowMrpCount: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Helper: parse all sheets in a workbook buffer into rows + metadata.
// Mutates knownCodes/canonical in place so successive files in a zip see
// products inserted by earlier files.
// ---------------------------------------------------------------------------
function parseWorkbookBuffer(
  buffer: Buffer,
  knownCodes: Set<string>,
): {
  rows: ParsedRow[];
  basis: string;
  codeColHeader: string;
  priceColHeader: string;
  hasNameCol: boolean;
  hasCategoryCol: boolean;
  skippedUnparseable: number;
  skippedRows: SkippedRow[];
} {
  const wb = XLSX.read(buffer, { type: "buffer" });
  let rows: ParsedRow[] = [];
  let basis = "Verify";
  let codeColHeader = "";
  let priceColHeader = "";
  let hasNameCol = false;
  let hasCategoryCol = false;
  let skippedUnparseable = 0;
  const skippedRows: SkippedRow[] = [];

  // Sheet selection strategy:
  // 1. If any sheet is named "MASTER" (case-insensitive), use it exclusively —
  //    PTMT / Prayag MRP workbooks typically have a MASTER sheet with the real
  //    MRP columns alongside a PACKING sheet whose values are pcs-per-box.
  // 2. Otherwise, skip any sheet whose name contains "packing" and process the rest.
  const masterSheet = wb.SheetNames.find((n) => MASTER_SHEET_RE.test(n));
  const sheetsToProcess = masterSheet
    ? [masterSheet]
    : wb.SheetNames.filter((n) => !PACKING_SHEET_RE.test(n));

  for (const sheetName of sheetsToProcess) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });
    const parsed = parseSheet(grid, knownCodes);
    skippedUnparseable += parsed.skippedRows.length;
    skippedRows.push(...parsed.skippedRows);
    if (parsed.nameCol !== -1) hasNameCol = true;
    if (parsed.categoryCol !== -1) hasCategoryCol = true;
    if (parsed.rows.length > 0) {
      rows = rows.concat(parsed.rows);
      basis = parsed.basis;
      if (!codeColHeader) codeColHeader = parsed.codeColHeader;
      if (!priceColHeader) priceColHeader = parsed.priceColHeader;
    } else {
      if (!codeColHeader && parsed.codeColHeader) codeColHeader = parsed.codeColHeader;
      if (!priceColHeader && parsed.priceColHeader) priceColHeader = parsed.priceColHeader;
      basis = parsed.basis;
    }
  }

  return { rows, basis, codeColHeader, priceColHeader, hasNameCol, hasCategoryCol, skippedUnparseable, skippedRows };
}

// ---------------------------------------------------------------------------
// Infer a product division from the uploaded filename so that products get
// classified automatically without needing a separate SQL update step.
// ---------------------------------------------------------------------------
const FILENAME_DIVISION_MAP: Array<{ pattern: RegExp; division: string }> = [
  { pattern: /ptmt/i,                          division: "PTMT & Plastic Fittings" },
  { pattern: /pipe|fitting/i,                  division: "Pipes & Fittings" },
  { pattern: /\bcp\b|chrome/i,                 division: "CP Fittings / Faucets" },
  { pattern: /sanitar/i,                       division: "Ceramic Sanitaryware" },
  { pattern: /quaa|fern/i,                     division: "QUAA & FERN" },
];

function divisionFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, "").toLowerCase();
  for (const { pattern, division } of FILENAME_DIVISION_MAP) {
    if (pattern.test(base)) return division;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: persist a set of already-parsed rows to DB inside a transaction and
// return a filled-in LoadSummary.  Mutates knownCodes/canonical in place.
// ---------------------------------------------------------------------------
async function persistParsedRows(
  parsedRows: ParsedRow[],
  filename: string,
  effectiveDate: string,
  knownCodes: Set<string>,
  canonical: Map<string, string>,
  basis: string,
  codeColHeader: string,
  priceColHeader: string,
  skippedUnparseable: number,
): Promise<LoadSummary> {
  // De-duplicate within the uploaded file by item code (keep last occurrence).
  const byCode = new Map<string, { price: number; productName: string | null; category: string | null }>();
  for (const r of parsedRows) byCode.set(r.itemCode, { price: r.price, productName: r.productName, category: r.category });

  if (byCode.size === 0) {
    return {
      file: filename,
      effectiveDate,
      basis,
      codeColHeader,
      priceColHeader,
      totalRows: 0,
      matchedProducts: 0,
      newProducts: 0,
      newHistoryRows: 0,
      skippedDuplicates: 0,
      skippedUnparseable,
      unmatchedCodes: [],
      lowMrpCount: 0,
      message:
        "No valid code-and-price rows could be read from the file. Check the sheet has a recognisable item-code column and a price/MRP column.",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  // Sanity-check: count prices below ₹50.  For PTMT / CP products a count above
  // zero almost certainly means a packing-quantity column was imported by mistake.
  const lowMrpCount = [...byCode.values()].filter((v) => v.price < 50).length;
  const summary: LoadSummary = {
    file: filename,
    effectiveDate,
    basis,
    codeColHeader,
    priceColHeader,
    totalRows: byCode.size,
    matchedProducts: 0,
    newProducts: 0,
    newHistoryRows: 0,
    skippedDuplicates: 0,
    skippedUnparseable,
    unmatchedCodes: [],
    lowMrpCount,
  };

  // Infer division once per file — same for every product in this upload.
  const inferredDivision = divisionFromFilename(filename);

  await db.transaction(async (tx) => {
    const existingPairs = await tx
      .select({
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
      })
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.effectiveDate, effectiveDate));
    const dupSet = new Set(existingPairs.map((p) => normCode(p.itemCode)));

    // Fetch existing products that are missing name or division so we can backfill.
    const existingRows = await tx
      .select({
        itemCode: catalogProductsTable.itemCode,
        productName: catalogProductsTable.productName,
        division: catalogProductsTable.division,
        category: catalogProductsTable.category,
      })
      .from(catalogProductsTable);
    const existingMap = new Map(existingRows.map((r) => [r.itemCode, r]));

    const newProductValues: (typeof catalogProductsTable.$inferInsert)[] = [];
    const historyValues: (typeof mrpPriceHistoryTable.$inferInsert)[] = [];
    // Backfill updates: itemCode -> {productName?, division?, category?}
    const backfillMap = new Map<string, Partial<typeof catalogProductsTable.$inferInsert>>();

    for (const [code, { price, productName, category }] of byCode) {
      const isKnown = knownCodes.has(code);
      const storedCode = canonical.get(code) ?? code;

      if (!isKnown) {
        newProductValues.push({
          itemCode: storedCode,
          productName: productName ?? null,
          division: inferredDivision,
          category: category ?? null,
          uom: "NOS",
          isActive: true,
          sourceFiles: filename,
          dataFlag: "new_from_load",
        });
        summary.newProducts++;
        summary.unmatchedCodes.push(storedCode);
        knownCodes.add(code);
        canonical.set(code, storedCode);
      } else {
        summary.matchedProducts++;
        // Backfill any null metadata on existing products.
        const existing = existingMap.get(storedCode);
        if (existing) {
          const patch: Partial<typeof catalogProductsTable.$inferInsert> = {};
          if (!existing.productName && productName) patch.productName = productName;
          if (!existing.division && inferredDivision) patch.division = inferredDivision;
          if (!existing.category && category) patch.category = category;
          if (Object.keys(patch).length > 0) backfillMap.set(storedCode, patch);
        }
      }

      if (dupSet.has(code)) {
        summary.skippedDuplicates++;
        continue;
      }

      historyValues.push({
        itemCode: storedCode,
        mrp: price,
        netPrice: basis === "Net" ? price : null,
        priceBasis: basis,
        effectiveDate,
        loadDate: today,
        sourceFile: filename,
        isCurrent: false,
      });
      dupSet.add(code);
      summary.newHistoryRows++;
    }

    if (newProductValues.length > 0) {
      for (let i = 0; i < newProductValues.length; i += 500) {
        await tx.insert(catalogProductsTable).values(newProductValues.slice(i, i + 500));
      }
    }
    if (historyValues.length > 0) {
      for (let i = 0; i < historyValues.length; i += 500) {
        await tx.insert(mrpPriceHistoryTable).values(historyValues.slice(i, i + 500));
      }
    }

    // Apply backfill patches for existing products with null metadata.
    // Group by patch shape to minimize number of UPDATE statements.
    if (backfillMap.size > 0) {
      // Simple approach: update one at a time in batches of 500 using inArray
      // for the common case where all patches in a batch share the same fields.
      const byPatch = new Map<string, string[]>();
      for (const [code, patch] of backfillMap) {
        const key = JSON.stringify(patch);
        const list = byPatch.get(key) ?? [];
        list.push(code);
        byPatch.set(key, list);
      }
      for (const [patchJson, codes] of byPatch) {
        const patch = JSON.parse(patchJson) as Partial<typeof catalogProductsTable.$inferInsert>;
        for (let i = 0; i < codes.length; i += 500) {
          await tx
            .update(catalogProductsTable)
            .set(patch)
            .where(inArray(catalogProductsTable.itemCode, codes.slice(i, i + 500)));
        }
      }
    }
  });

  if (summary.newHistoryRows === 0 && summary.skippedDuplicates > 0) {
    summary.message = `All ${summary.skippedDuplicates} rows already exist for effective date ${effectiveDate} — nothing added (re-load is safe).`;
  }

  return summary;
}

router.post("/catalog/load-mrp", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const effectiveDate =
    typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim()
      ? req.body.effectiveDate.trim()
      : new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    res.status(400).json({ error: "effectiveDate must be YYYY-MM-DD" });
    return;
  }

  const name = file.originalname;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (!["xlsx", "xls", "csv", "zip"].includes(ext)) {
    res.status(400).json({ error: "Upload an .xlsx, .xls, .csv, or .zip file" });
    return;
  }

  try {
    const existingProducts = await db
      .select({ itemCode: catalogProductsTable.itemCode })
      .from(catalogProductsTable);
    const knownCodes = new Set(existingProducts.map((p) => normCode(p.itemCode)));
    const canonical = new Map<string, string>(
      existingProducts.map((p) => [normCode(p.itemCode), p.itemCode]),
    );

    // ------------------------------------------------------------------
    // ZIP: process every xlsx/xls/csv entry inside the archive, one at a
    // time, accumulating results.  knownCodes/canonical are mutated across
    // iterations so later files see products created by earlier ones.
    // ------------------------------------------------------------------
    if (ext === "zip") {
      const zip = new AdmZip(file.buffer);
      const entries = zip
        .getEntries()
        .filter((e) => {
          if (e.isDirectory) return false;
          const entryExt = e.name.toLowerCase().split(".").pop() ?? "";
          return ["xlsx", "xls", "csv"].includes(entryExt);
        })
        // Ignore macOS resource-fork entries (__MACOSX / ._xxx)
        .filter((e) => !e.entryName.startsWith("__MACOSX") && !e.name.startsWith("._"))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (entries.length === 0) {
        res.status(400).json({
          error: "The ZIP file contains no .xlsx / .xls / .csv files.",
        });
        return;
      }

      const fileSummaries: LoadSummary[] = [];
      for (const entry of entries) {
        const buf = entry.getData();
        const parsed = parseWorkbookBuffer(buf, knownCodes);
        const summary = await persistParsedRows(
          parsed.rows,
          entry.name,
          effectiveDate,
          knownCodes,
          canonical,
          parsed.basis,
          parsed.codeColHeader,
          parsed.priceColHeader,
          parsed.skippedUnparseable,
        );
        fileSummaries.push(summary);
      }

      await recomputeCurrentFlags();

      // Build aggregate totals across all files.
      const aggregate = {
        file: name,
        effectiveDate,
        basis: fileSummaries.map((s) => s.basis).join(", "),
        codeColHeader: "",
        priceColHeader: "",
        totalRows: fileSummaries.reduce((s, f) => s + f.totalRows, 0),
        matchedProducts: fileSummaries.reduce((s, f) => s + f.matchedProducts, 0),
        newProducts: fileSummaries.reduce((s, f) => s + f.newProducts, 0),
        newHistoryRows: fileSummaries.reduce((s, f) => s + f.newHistoryRows, 0),
        skippedDuplicates: fileSummaries.reduce((s, f) => s + f.skippedDuplicates, 0),
        skippedUnparseable: fileSummaries.reduce((s, f) => s + f.skippedUnparseable, 0),
        unmatchedCodes: fileSummaries.flatMap((f) => f.unmatchedCodes),
        files: fileSummaries,
      };

      res.json({ results: aggregate });
      return;
    }

    // ------------------------------------------------------------------
    // Single spreadsheet file (existing behaviour)
    // ------------------------------------------------------------------
    const parsed = parseWorkbookBuffer(file.buffer, knownCodes);
    const summary = await persistParsedRows(
      parsed.rows,
      name,
      effectiveDate,
      knownCodes,
      canonical,
      parsed.basis,
      parsed.codeColHeader,
      parsed.priceColHeader,
      parsed.skippedUnparseable,
    );

    await recomputeCurrentFlags();

    res.json({ results: summary });
  } catch (err) {
    req.log.error({ err, file: name }, "load-mrp failed");
    res.status(500).json({ error: "Failed to parse and load file" });
  }
});

// GET /catalog/export — current catalog with current MRP, or full history.
router.get("/catalog/export", async (req, res) => {
  const type = String(req.query.type ?? "catalog");
  const format = String(req.query.format ?? "xlsx");

  let aoa: (string | number | null)[][];
  let sheetName: string;
  let fileBase: string;

  if (type === "history") {
    sheetName = "MRP History";
    fileBase = "prayag-mrp-history";
    const rows = await db
      .select()
      .from(mrpPriceHistoryTable)
      .orderBy(
        asc(mrpPriceHistoryTable.itemCode),
        desc(mrpPriceHistoryTable.effectiveDate),
      );
    const header = [
      "Item Code",
      "MRP",
      "Net Price",
      "Discount %",
      "Basis",
      "Effective Date",
      "Load Date",
      "Source File",
      "Is Current",
      "Notes",
    ];
    const body = rows.map((r) => [
      r.itemCode,
      r.mrp,
      r.netPrice,
      r.discountPct,
      r.priceBasis,
      r.effectiveDate,
      r.loadDate,
      r.sourceFile,
      r.isCurrent ? "Yes" : "No",
      r.notes,
    ]);
    aoa = [header, ...body];
  } else {
    sheetName = "Catalog";
    fileBase = "prayag-catalog";
    const products = await db
      .select()
      .from(catalogProductsTable)
      .orderBy(asc(catalogProductsTable.itemCode));
    const current = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.isCurrent, true));
    const curMap = new Map(current.map((c) => [c.itemCode, c]));
    const header = [
      "Item Code",
      "Product Name",
      "Division",
      "Category",
      "Series/Range",
      "Size",
      "UOM",
      "Current MRP",
      "Basis",
      "Effective Date",
      "Active",
      "Data Flag",
    ];
    const body = products.map((p) => {
      const cur = curMap.get(p.itemCode);
      return [
        p.itemCode,
        p.productName,
        p.division,
        p.category,
        p.seriesRange,
        p.size,
        p.uom,
        cur?.mrp ?? null,
        cur?.priceBasis ?? null,
        cur?.effectiveDate ?? null,
        p.isActive ? "Yes" : "No",
        p.dataFlag,
      ];
    });
    aoa = [header, ...body];
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileBase}.csv"`,
    );
    res.send(csv);
    return;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileBase}.xlsx"`,
  );
  res.send(buf);
});

interface ParsedCompetitorRow {
  category: string | null;
  description: string | null;
  size: string | null;
  price: number;
  unit: string | null;
  effectiveDate: string | null;
  matchedPrayagCode: string | null;
}

// Locate a column whose header contains any of the keywords (excluding some).
function findCol(
  headers: string[],
  include: string[],
  exclude: string[] = [],
): number {
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c] ?? "";
    if (!h) continue;
    if (exclude.some((k) => h.includes(k))) continue;
    if (include.some((k) => h.includes(k))) return c;
  }
  return -1;
}

function toDateStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.y}-${p(d.m)}-${p(d.d)}`;
  }
  const s = String(v).trim();
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s.slice(0, 10) || null;
}

function parseCompetitorSheet(
  grid: unknown[][],
  knownCodes: Set<string>,
): ParsedCompetitorRow[] {
  const maxCols = Math.max(0, ...grid.map((r) => r.length));
  let headerRow = 0;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const strs = (grid[r] ?? []).filter(
      (v) => typeof v === "string" && norm(v).length > 0 && isNaN(Number(v)),
    );
    if (strs.length >= 2) {
      headerRow = r;
      break;
    }
  }
  const headers = (grid[headerRow] ?? []).map((h) => norm(h).toLowerCase());

  // Matched Prayag code column: prefer an explicit "matched"/"prayag code"
  // header, else the column with the most overlap against known codes.
  let codeCol = findCol(headers, ["matched", "prayag_code", "prayag code"]);
  if (codeCol === -1) {
    // Fallback: pick the column with the most overlap against known Prayag
    // codes, but only if the overlap is strong enough. This guards against
    // numeric columns (size/diameter) coincidentally matching numeric codes.
    const dataRows = Math.max(0, grid.length - 1);
    const minOverlap = Math.max(5, Math.floor(dataRows * 0.25));
    let best = 0;
    let bestCol = -1;
    for (let c = 0; c < maxCols; c++) {
      let overlap = 0;
      for (let r = 0; r < grid.length; r++) {
        if (r === headerRow) continue;
        if (knownCodes.has(normCode(grid[r]?.[c]))) overlap++;
      }
      if (overlap > best) {
        best = overlap;
        bestCol = c;
      }
    }
    if (best >= minOverlap) codeCol = bestCol;
  }

  // Price column: a "price"/"rate"/"cost" header that is not the Prayag MRP
  // snapshot or a diff column; else the first mostly-numeric column.
  let priceCol = findCol(
    headers,
    ["price", "rate", "cost", "mrp"],
    ["prayag", "diff"],
  );
  if (priceCol === -1) {
    for (let c = 0; c < maxCols; c++) {
      if (c === codeCol) continue;
      let numericCount = 0;
      for (let r = 0; r < grid.length; r++) {
        if (r === headerRow) continue;
        const v = grid[r]?.[c];
        if (v != null && v !== "" && !isNaN(Number(v))) numericCount++;
      }
      if (numericCount > grid.length / 3) {
        priceCol = c;
        break;
      }
    }
  }
  if (priceCol === -1) return [];

  const catCol = findCol(headers, ["category"]);
  const descCol = findCol(headers, ["desc", "name", "product"]);
  const sizeCol = findCol(headers, ["size"]);
  const unitCol = findCol(headers, ["unit"]);
  const dateCol = findCol(headers, ["eff", "date"]);

  const rows: ParsedCompetitorRow[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (r === headerRow) continue;
    const row = grid[r] ?? [];
    const price = Number(row[priceCol]);
    if (isNaN(price) || price <= 0) continue;
    const rawCode = codeCol !== -1 ? normCode(row[codeCol]) : "";
    rows.push({
      category: catCol !== -1 ? norm(row[catCol]) || null : null,
      description: descCol !== -1 ? norm(row[descCol]) || null : null,
      size: sizeCol !== -1 ? norm(row[sizeCol]) || null : null,
      price,
      unit: unitCol !== -1 ? norm(row[unitCol]) || null : null,
      effectiveDate: dateCol !== -1 ? toDateStr(row[dateCol]) : null,
      matchedPrayagCode: rawCode || null,
    });
  }
  return rows;
}

// GET /catalog/competitor-brands — distinct brand names + their price periods.
router.get("/catalog/competitor-brands", async (_req, res) => {
  const rows = await db
    .selectDistinct({
      competitor: competitorPricesTable.competitor,
      effectiveDate: competitorPricesTable.effectiveDate,
    })
    .from(competitorPricesTable)
    .orderBy(
      asc(competitorPricesTable.competitor),
      asc(competitorPricesTable.effectiveDate),
    );

  // Group into brand → sorted effectiveDates
  const periodMap = new Map<string, string[]>();
  for (const row of rows) {
    if (!periodMap.has(row.competitor)) periodMap.set(row.competitor, []);
    if (row.effectiveDate) periodMap.get(row.competitor)!.push(row.effectiveDate);
  }

  const brands = [...periodMap.keys()].sort();
  const brandPeriods = brands.map((brand) => ({
    brand,
    effectiveDates: periodMap.get(brand) ?? [],
  }));

  res.json({ brands, brandPeriods });
});

// POST /catalog/load-competitor — upload a competitor workbook (any brand).
router.post(
  "/catalog/load-competitor",
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const competitor =
      typeof req.body.competitor === "string" && req.body.competitor.trim()
        ? req.body.competitor.trim()
        : null;
    if (!competitor) {
      res.status(400).json({ error: "competitor name is required" });
      return;
    }

    const effectiveDateBody =
      typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim()
        ? req.body.effectiveDate.trim()
        : null;
    if (!effectiveDateBody || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDateBody)) {
      res.status(400).json({ error: "effectiveDate (YYYY-MM-DD) is required" });
      return;
    }
    const effectiveDate = effectiveDateBody;

    const name = file.originalname;
    const ext = name.toLowerCase().split(".").pop() ?? "";
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      res.status(400).json({ error: "Upload an .xlsx, .xls, or .csv file" });
      return;
    }

    try {
      const existingProducts = await db
        .select({ itemCode: catalogProductsTable.itemCode })
        .from(catalogProductsTable);
      const knownCodes = new Set(
        existingProducts.map((p) => normCode(p.itemCode)),
      );
      const canonical = new Map<string, string>(
        existingProducts.map((p) => [normCode(p.itemCode), p.itemCode]),
      );

      // Current MRP per normalized code, used by the price-gap guardrail.
      const currentMrpRows = await db
        .select({
          itemCode: mrpPriceHistoryTable.itemCode,
          mrp: mrpPriceHistoryTable.mrp,
        })
        .from(mrpPriceHistoryTable)
        .where(eq(mrpPriceHistoryTable.isCurrent, true));
      const currentMrp = new Map<string, number>();
      for (const r of currentMrpRows) {
        if (r.mrp != null) currentMrp.set(normCode(r.itemCode), r.mrp);
      }

      const wb = XLSX.read(file.buffer, { type: "buffer" });
      let parsed: ParsedCompetitorRow[] = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: null,
        });
        const sheetRows = parseCompetitorSheet(grid, knownCodes);
        if (sheetRows.length > parsed.length) parsed = sheetRows;
      }

      if (parsed.length === 0) {
        res.json({
          results: {
            competitor,
            file: name,
            totalRows: 0,
            inserted: 0,
            matched: 0,
            unmatched: 0,
            message:
              "No price rows detected. Check the sheet has a price column.",
          },
        });
        return;
      }

      let matched = 0;
      let rejectedByGap = 0;
      const values = parsed.map((r) => {
        const norm = r.matchedPrayagCode;
        let isMatched = !!norm && knownCodes.has(norm);
        // Snapshot of the catalog's current MRP at import time. Raw competitor
        // sheets carry no Prayag MRP, so we persist this onto the row so the
        // analysis gap can use it directly (never a later catalog lookup).
        let prayagMrpSnapshot: number | null = null;
        // Price-gap guardrail: even a code that exists is sent to review when
        // the gap vs Prayag's current MRP is unrealistically large — that
        // almost always means the wrong products were linked.
        if (isMatched) {
          const prayagMrp = currentMrp.get(norm!);
          if (prayagMrp != null && prayagMrp > 0) {
            prayagMrpSnapshot = prayagMrp;
            const eff = effectivePrice(r.unit, r.price);
            const gapPct = ((eff - prayagMrp) / prayagMrp) * 100;
            if (gapPct < GAP_MIN_PCT || gapPct > GAP_MAX_PCT) {
              isMatched = false;
              rejectedByGap++;
            }
          }
        }
        if (!isMatched) prayagMrpSnapshot = null;
        if (isMatched) matched++;
        return {
          competitor,
          category: r.category,
          description: r.description,
          size: r.size,
          price: r.price,
          unit: r.unit,
          // Use the form's effectiveDate — more reliable than parsing from the sheet
          effectiveDate,
          matchedPrayagCode: isMatched ? (canonical.get(norm!) ?? norm) : null,
          matchStatus: isMatched ? "matched" : "no match (review)",
          matchConfidence: isMatched ? "High" : null,
          prayagMrpAtCompare: prayagMrpSnapshot,
          // All new rows start as not current; recompute below sets the flag.
          isCurrent: false,
        };
      });

      // Period-aware: delete only the rows for this (competitor, effectiveDate)
      // so older periods are preserved. A different effectiveDate adds a new period.
      await db
        .delete(competitorPricesTable)
        .where(
          sql`competitor = ${competitor} AND effective_date = ${effectiveDate}`,
        );

      for (let i = 0; i < values.length; i += 500) {
        await db.insert(competitorPricesTable).values(values.slice(i, i + 500));
      }

      // Recompute is_current across all periods for this competitor.
      await recomputeCompetitorCurrentFlags(competitor);

      res.json({
        results: {
          competitor,
          file: name,
          totalRows: parsed.length,
          inserted: values.length,
          matched,
          unmatched: values.length - matched,
          rejectedByGap,
        },
      });
    } catch (err) {
      req.log.error({ err, file: name }, "load-competitor failed");
      res.status(500).json({ error: "Failed to parse and load file" });
    }
  },
);

export default router;
