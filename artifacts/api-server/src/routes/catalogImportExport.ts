import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { eq, asc, desc } from "drizzle-orm";
import {
  db,
  catalogProductsTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import { recomputeCurrentFlags, normCode } from "../lib/catalog";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const NET_KEYWORDS = ["net", "rate", "dealer", "scheme", "billing", "discount"];
const MRP_KEYWORDS = ["mrp", "list", "retail", "price", "cost"];

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

interface ParsedRow {
  itemCode: string;
  price: number;
}

interface ParseResult {
  rows: ParsedRow[];
  basis: string;
  codeCol: number;
  priceCol: number;
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
  const headers = (grid[headerRow] ?? []).map((h) => norm(h).toLowerCase());

  // Code column: prefer the column with the most overlap against known codes;
  // fall back to a header containing "code" or "item".
  let codeCol = -1;
  let bestOverlap = 0;
  for (let c = 0; c < maxCols; c++) {
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
  if (codeCol === -1) {
    for (let c = 0; c < maxCols; c++) {
      const h = headers[c] ?? "";
      if (h.includes("code") || h.includes("item")) {
        codeCol = c;
        break;
      }
    }
  }
  if (codeCol === -1) {
    return { rows: [], basis: "Verify", codeCol: -1, priceCol: -1 };
  }

  // Price column: header keyword, else first mostly-numeric column.
  let netCol = -1;
  let mrpCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol) continue;
    const h = headers[c] ?? "";
    if (NET_KEYWORDS.some((k) => h.includes(k)) && netCol === -1) netCol = c;
    else if (MRP_KEYWORDS.some((k) => h.includes(k)) && mrpCol === -1) mrpCol = c;
  }
  let priceCol = mrpCol !== -1 ? mrpCol : netCol;
  let basis = mrpCol !== -1 ? "MRP" : netCol !== -1 ? "Net" : "Verify";
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
        basis = "Verify";
        break;
      }
    }
  }
  if (priceCol === -1) {
    return { rows: [], basis: "Verify", codeCol, priceCol: -1 };
  }

  const rows: ParsedRow[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (r === headerRow) continue;
    const row = grid[r] ?? [];
    const code = normCode(row[codeCol]);
    if (!code) continue;
    const price = Number(row[priceCol]);
    if (isNaN(price) || price <= 0) continue;
    rows.push({ itemCode: code, price });
  }

  return { rows, basis, codeCol, priceCol };
}

interface LoadSummary {
  file: string;
  effectiveDate: string;
  basis: string;
  totalRows: number;
  matchedProducts: number;
  newProducts: number;
  newHistoryRows: number;
  skippedDuplicates: number;
  message?: string;
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
  if (!["xlsx", "xls", "csv"].includes(ext)) {
    res.status(400).json({ error: "Upload an .xlsx, .xls, or .csv file" });
    return;
  }

  try {
    const existingProducts = await db
      .select({ itemCode: catalogProductsTable.itemCode })
      .from(catalogProductsTable);
    const knownCodes = new Set(existingProducts.map((p) => normCode(p.itemCode)));
    // Map normalized -> canonical itemCode as stored.
    const canonical = new Map<string, string>(
      existingProducts.map((p) => [normCode(p.itemCode), p.itemCode]),
    );

    const wb = XLSX.read(file.buffer, { type: "buffer" });
    let parsedRows: ParsedRow[] = [];
    let basis = "Verify";
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: null,
      });
      const parsed = parseSheet(grid, knownCodes);
      if (parsed.rows.length > 0) {
        parsedRows = parsedRows.concat(parsed.rows);
        basis = parsed.basis;
      }
    }

    // De-duplicate within the uploaded file by item code (keep last).
    const byCode = new Map<string, number>();
    for (const r of parsedRows) byCode.set(r.itemCode, r.price);

    if (byCode.size === 0) {
      res.json({
        results: {
          file: name,
          effectiveDate,
          basis,
          totalRows: 0,
          matchedProducts: 0,
          newProducts: 0,
          newHistoryRows: 0,
          skippedDuplicates: 0,
          message:
            "No item-code + price rows detected. Check the sheet has a code column and a price/MRP column.",
        } satisfies LoadSummary,
      });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const summary: LoadSummary = {
      file: name,
      effectiveDate,
      basis,
      totalRows: byCode.size,
      matchedProducts: 0,
      newProducts: 0,
      newHistoryRows: 0,
      skippedDuplicates: 0,
    };

    await db.transaction(async (tx) => {
      // Existing (code, effective_date) pairs for duplicate detection.
      const existingPairs = await tx
        .select({
          itemCode: mrpPriceHistoryTable.itemCode,
          effectiveDate: mrpPriceHistoryTable.effectiveDate,
        })
        .from(mrpPriceHistoryTable)
        .where(eq(mrpPriceHistoryTable.effectiveDate, effectiveDate));
      const dupSet = new Set(
        existingPairs.map((p) => normCode(p.itemCode)),
      );

      const newProductValues: (typeof catalogProductsTable.$inferInsert)[] = [];
      const historyValues: (typeof mrpPriceHistoryTable.$inferInsert)[] = [];

      for (const [code, price] of byCode) {
        const isKnown = knownCodes.has(code);
        const storedCode = canonical.get(code) ?? code;

        if (!isKnown) {
          newProductValues.push({
            itemCode: storedCode,
            productName: null,
            division: null,
            category: null,
            uom: "NOS",
            isActive: true,
            sourceFiles: name,
            dataFlag: "new_from_load",
          });
          summary.newProducts++;
          knownCodes.add(code);
        } else {
          summary.matchedProducts++;
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
          sourceFile: name,
          isCurrent: false,
        });
        dupSet.add(code);
        summary.newHistoryRows++;
      }

      if (newProductValues.length > 0) {
        for (let i = 0; i < newProductValues.length; i += 500) {
          await tx
            .insert(catalogProductsTable)
            .values(newProductValues.slice(i, i + 500));
        }
      }
      if (historyValues.length > 0) {
        for (let i = 0; i < historyValues.length; i += 500) {
          await tx
            .insert(mrpPriceHistoryTable)
            .values(historyValues.slice(i, i + 500));
        }
      }
    });

    await recomputeCurrentFlags();

    if (summary.newHistoryRows === 0 && summary.skippedDuplicates > 0) {
      summary.message = `All ${summary.skippedDuplicates} rows already exist for effective date ${effectiveDate} — nothing added (re-load is safe).`;
    }

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

export default router;
