import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  productsTable,
  competitorsTable,
  comparisonsTable,
} from "@workspace/db";
import { loadEngineData, computeAllRows } from "../lib/engine";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const KNOWN_BRANDS = [
  "Finolex",
  "Supreme",
  "Astral",
  "Ashirwad",
  "Prince",
  "Vectus",
  "Water Tec",
  "ORI Plast",
  "Apollo",
  "Pearl",
  "Avonplast",
];

const NET_KEYWORDS = ["net", "rate", "discount", "dealer", "scheme", "sp", "billing"];
const MRP_KEYWORDS = ["mrp", "list", "retail"];

function norm(s: unknown): string {
  return String(s ?? "").trim();
}
function normCode(s: unknown): string {
  return norm(s).toUpperCase().replace(/\s+/g, "");
}

function detectBrand(headerText: string, filename: string): string {
  const hay = (headerText + " " + filename).toLowerCase();
  for (const b of KNOWN_BRANDS) {
    if (hay.includes(b.toLowerCase())) return b;
  }
  // fall back to filename base without extension
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base || "Unknown";
}

interface ParsedRow {
  itemCode: string;
  basis: "net" | "mrp";
  compPrice: number;
  compMrp: number | null;
}

interface FileResult {
  file: string;
  competitor: string;
  basis: string;
  matched: number;
  unmatched: number;
  total: number;
  message?: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

interface PrayagPrices {
  mrp: number | null;
  net: number | null;
}

function parseSheet(
  grid: unknown[][],
  knownCodes: Set<string>,
  prayagMap: Map<string, PrayagPrices>,
): { rows: ParsedRow[]; unmatched: number; basis: "net" | "mrp" } {
  // Find the column with the most overlap against known item codes.
  let codeCol = -1;
  let bestOverlap = 0;
  const maxCols = Math.max(0, ...grid.map((r) => r.length));
  for (let c = 0; c < maxCols; c++) {
    let overlap = 0;
    for (const row of grid) {
      if (knownCodes.has(normCode(row[c]))) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      codeCol = c;
    }
  }
  if (codeCol === -1 || bestOverlap === 0) {
    return { rows: [], unmatched: 0, basis: "net" };
  }

  // Identify header row: the first row that has a non-numeric cell in several columns.
  let headerRow = 0;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const strs = grid[r]!.filter(
      (v) => typeof v === "string" && norm(v).length > 0 && isNaN(Number(v)),
    );
    if (strs.length >= 2) {
      headerRow = r;
      break;
    }
  }
  const headers = (grid[headerRow] ?? []).map((h) => norm(h).toLowerCase());

  // Identify candidate price columns by header keyword.
  let netCol = -1;
  let mrpCol = -1;
  let genericCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol) continue;
    const h = headers[c] ?? "";
    if (NET_KEYWORDS.some((k) => h.includes(k)) && netCol === -1) netCol = c;
    else if (MRP_KEYWORDS.some((k) => h.includes(k)) && mrpCol === -1) mrpCol = c;
    else if (h.includes("price") && genericCol === -1) genericCol = c;
  }
  // Fallback: first numeric column other than code col.
  if (netCol === -1 && mrpCol === -1 && genericCol === -1) {
    for (let c = 0; c < maxCols; c++) {
      if (c === codeCol) continue;
      const numericCount = grid.filter(
        (row) => row[c] != null && !isNaN(Number(row[c])),
      ).length;
      if (numericCount > grid.length / 3) {
        genericCol = c;
        break;
      }
    }
  }

  const priceCol = netCol !== -1 ? netCol : genericCol !== -1 ? genericCol : mrpCol;
  // Basis is known only when the price column has an explicit net/mrp header.
  // A generic "price"/fallback column must be inferred from value magnitude.
  const explicitBasis: "net" | "mrp" | null =
    netCol !== -1 ? "net" : mrpCol !== -1 && priceCol === mrpCol ? "mrp" : null;
  if (priceCol === -1) return { rows: [], unmatched: 0, basis: "net" };

  const rows: ParsedRow[] = [];
  let unmatched = 0;
  for (let r = 0; r < grid.length; r++) {
    if (r === headerRow) continue;
    const row = grid[r]!;
    const code = normCode(row[codeCol]);
    if (!code) continue;
    const price = Number(row[priceCol]);
    if (isNaN(price) || price <= 0) continue;
    if (!knownCodes.has(code)) {
      unmatched++;
      continue;
    }
    const mrp = mrpCol !== -1 ? Number(row[mrpCol]) : NaN;
    rows.push({
      itemCode: code,
      basis: "net",
      compPrice: price,
      compMrp: isNaN(mrp) ? null : mrp,
    });
  }

  // Decide basis: explicit header wins; otherwise infer by comparing the
  // imported price magnitude against Prayag's net vs mrp for the same items.
  let basis: "net" | "mrp" = explicitBasis ?? "net";
  if (!explicitBasis && rows.length > 0) {
    const impMed = median(rows.map((r) => r.compPrice));
    const netMed = median(
      rows
        .map((r) => prayagMap.get(r.itemCode)?.net)
        .filter((v): v is number => v != null),
    );
    const mrpMed = median(
      rows
        .map((r) => prayagMap.get(r.itemCode)?.mrp)
        .filter((v): v is number => v != null),
    );
    if (impMed != null && netMed != null && mrpMed != null) {
      const dNet = Math.abs(Math.log(impMed / netMed));
      const dMrp = Math.abs(Math.log(impMed / mrpMed));
      basis = dMrp < dNet ? "mrp" : "net";
    }
  }
  for (const row of rows) row.basis = basis;

  return { rows, unmatched, basis };
}

async function ingest(
  competitor: string,
  basis: "net" | "mrp",
  parsed: ParsedRow[],
  sourceFile: string,
): Promise<number> {
  if (parsed.length === 0) return 0;
  const codes = parsed.map((p) => p.itemCode);
  // Atomic: competitor upsert + delete-prior + insert all succeed or roll back.
  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(competitorsTable)
      .where(eq(competitorsTable.name, competitor));
    if (existing.length === 0) {
      await tx
        .insert(competitorsTable)
        .values({ name: competitor, basis, hidden: false });
    }
    await tx
      .delete(comparisonsTable)
      .where(
        and(
          eq(comparisonsTable.competitor, competitor),
          inArray(comparisonsTable.itemCode, codes),
        ),
      );
    await tx.insert(comparisonsTable).values(
      parsed.map((p) => ({
        competitor,
        itemCode: p.itemCode,
        basis: p.basis,
        compMrp: p.compMrp,
        compPrice: p.compPrice,
        matchMethod: "code",
        sourceFile,
        edited: false,
      })),
    );
  });
  return parsed.length;
}

router.post("/import", upload.array("files"), async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "No files uploaded" });
    return;
  }

  const products = await db.select().from(productsTable);
  const knownCodes = new Set(products.map((p) => normCode(p.itemCode)));
  const prayagMap = new Map<string, PrayagPrices>(
    products.map((p) => [
      normCode(p.itemCode),
      { mrp: p.prayagMrp, net: p.prayagNet },
    ]),
  );

  const results: FileResult[] = [];

  for (const file of files) {
    const name = file.originalname;
    const ext = name.toLowerCase().split(".").pop() ?? "";
    try {
      if (["xlsx", "xls", "csv"].includes(ext)) {
        const wb = XLSX.read(file.buffer, { type: "buffer" });
        let allRows: ParsedRow[] = [];
        let unmatched = 0;
        let headerText = "";
        let basis: "net" | "mrp" = "net";
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          if (!sheet) continue;
          const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            defval: null,
          });
          headerText += " " + sheetName;
          const parsed = parseSheet(grid, knownCodes, prayagMap);
          allRows = allRows.concat(parsed.rows);
          unmatched += parsed.unmatched;
          basis = parsed.basis;
        }
        const brand = detectBrand(headerText, name);
        const matched = await ingest(brand, basis, allRows, name);
        results.push({
          file: name,
          competitor: brand,
          basis,
          matched,
          unmatched,
          total: matched + unmatched,
        });
      } else if (ext === "pdf") {
        const parsed = await parsePdf(file.buffer, knownCodes);
        const brand = detectBrand("", name);
        const matched = await ingest(brand, parsed.basis, parsed.rows, name);
        results.push({
          file: name,
          competitor: brand,
          basis: parsed.basis,
          matched,
          unmatched: parsed.unmatched,
          total: matched + parsed.unmatched,
          message:
            matched === 0
              ? "No item codes matched. PDF parsing works best with code+price tables."
              : undefined,
        });
      } else {
        results.push({
          file: name,
          competitor: "",
          basis: "",
          matched: 0,
          unmatched: 0,
          total: 0,
          message: "Unsupported file type. Upload .xlsx, .xls, .csv, or .pdf.",
        });
      }
    } catch (err) {
      req.log.error({ err, file: name }, "import failed");
      results.push({
        file: name,
        competitor: "",
        basis: "",
        matched: 0,
        unmatched: 0,
        total: 0,
        message: "Failed to parse file.",
      });
    }
  }

  res.json({ results });
});

async function parsePdf(
  buffer: Buffer,
  knownCodes: Set<string>,
): Promise<{ rows: ParsedRow[]; unmatched: number; basis: "net" | "mrp" }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;

  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map<number, string[]>();
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5] ?? 0);
      const arr = byY.get(y) ?? [];
      arr.push(item.str);
      byY.set(y, arr);
    }
    for (const [, parts] of byY) lines.push(parts.join(" "));
  }

  const rows: ParsedRow[] = [];
  let unmatched = 0;
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    let code = "";
    for (const t of tokens) {
      if (knownCodes.has(normCode(t))) {
        code = normCode(t);
        break;
      }
    }
    if (!code) continue;
    const nums = tokens
      .map((t) => Number(t.replace(/[,₹]/g, "")))
      .filter((n) => !isNaN(n) && n > 0);
    if (nums.length === 0) {
      unmatched++;
      continue;
    }
    rows.push({
      itemCode: code,
      basis: "net",
      compPrice: nums[nums.length - 1]!,
      compMrp: nums.length > 1 ? nums[0]! : null,
    });
  }
  return { rows, unmatched, basis: "net" };
}

// ---------- Export ----------

router.get("/export", async (req, res) => {
  const type = String(req.query.type ?? "comparison");
  const format = String(req.query.format ?? "xlsx");

  const data = await loadEngineData();
  const { rows, visibleCompetitors } = computeAllRows(data);

  let aoa: (string | number | null)[][];
  let sheetName: string;
  let fileBase: string;

  if (type === "recommendations") {
    sheetName = "Recommendations";
    fileBase = "prayag-recommendations";
    const header = [
      "Item Code",
      "Category",
      "Size",
      "Basis",
      "Current Price",
      "Market Min",
      "Market Median",
      "Market Max",
      "Status",
      "Suggested Price",
      "Aggressive Target",
      "Gap",
      "Gap %",
      "Margin Constrained",
    ];
    const body = rows
      .filter((r) => r.status !== "no_data")
      .map((r) => [
        r.itemCode,
        r.category,
        r.size,
        r.basis,
        r.shownPrice,
        r.marketMin,
        r.marketMedian,
        r.marketMax,
        r.status,
        r.suggestedPrice,
        r.aggressiveTarget,
        r.gap,
        r.gapPct != null ? Number((r.gapPct * 100).toFixed(2)) : null,
        r.marginConstrained ? "Yes" : "No",
      ]);
    aoa = [header, ...body];
  } else {
    sheetName = "Comparison";
    fileBase = "prayag-comparison";
    const header = [
      "Item Code",
      "Category",
      "Size",
      "Basis",
      "Prayag Price",
      "Status",
      "Market Min",
      "Market Median",
      "Market Max",
      ...visibleCompetitors,
    ];
    const body = rows.map((r) => [
      r.itemCode,
      r.category,
      r.size,
      r.basis,
      r.shownPrice,
      r.status,
      r.marketMin,
      r.marketMedian,
      r.marketMax,
      ...r.competitors.map((c) => c.price),
    ]);
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
