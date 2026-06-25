// Pure parsing/auto-detection helpers for competitor sheet import.
// Kept free of express/multer/db imports so the matching heuristics can be
// unit-tested in isolation (the import route wires these into the upload flow).

export const KNOWN_BRANDS = [
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

export function norm(s: unknown): string {
  return String(s ?? "").trim();
}

export function normCode(s: unknown): string {
  return norm(s).toUpperCase().replace(/\s+/g, "");
}

export function detectBrand(headerText: string, filename: string): string {
  const hay = (headerText + " " + filename).toLowerCase();
  for (const b of KNOWN_BRANDS) {
    if (hay.includes(b.toLowerCase())) return b;
  }
  // fall back to filename base without extension
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base || "Unknown";
}

export interface ParsedRow {
  itemCode: string;
  basis: "net" | "mrp";
  compPrice: number;
  compMrp: number | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export interface PrayagPrices {
  mrp: number | null;
  net: number | null;
}

export function parseSheet(
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
