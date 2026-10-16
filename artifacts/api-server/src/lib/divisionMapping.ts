import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { PRODUCT_DIVISIONS } from "./mrpProvenance";

export const REVIEWED_DIVISION_SHA256 = "1bf4f5f7069bce442077735c5b5dc86aea3c7bdc0cbbf1b18153db3c89a5da87";
export const DIVISION_SOURCE_KEY = "__catalogue_division_mapping__";
export type DivisionRow = { itemCode: string; proposedDivision: string; confidence: string; basis: string; itemType: string };
export type DivisionProduct = { itemCode: string; division: string | null; productName: string | null; category: string | null; seriesRange: string | null };
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function parseDivisionMapping(buffer: Buffer): DivisionRow[] {
  if (createHash("sha256").update(buffer).digest("hex") !== REVIEWED_DIVISION_SHA256) throw new Error("Not the reviewed v3 workbook. v1, v2 and modified files are refused.");
  const sheet = XLSX.read(buffer, { type: "buffer" }).Sheets.mapping;
  if (!sheet) throw new Error("Required mapping sheet is missing.");
  return validateDivisionRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null }).map(r => ({
    itemCode: String(r.item_code ?? ""), proposedDivision: String(r.proposed_division ?? ""),
    confidence: String(r.confidence ?? ""), basis: String(r.basis ?? ""), itemType: String(r.erp_item_type ?? ""),
  })));
}

export function validateDivisionRows(rows: DivisionRow[]): DivisionRow[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.itemCode || seen.has(r.itemCode)) throw new Error(`Missing or duplicate exact item code: ${r.itemCode}`);
    seen.add(r.itemCode);
    if (!r.basis) throw new Error(`Missing basis for ${r.itemCode}`);
    if (r.confidence === "EXCLUDE") {
      if (r.proposedDivision !== "EXCLUDE - not a catalogue product") throw new Error("Invalid EXCLUDE label.");
    } else if (!(PRODUCT_DIVISIONS as readonly string[]).includes(r.proposedDivision)) throw new Error(`Invalid division for ${r.itemCode}: ${r.proposedDivision}`);
  }
  return rows;
}

export function divisionPreview(rows: DivisionRow[], products: DivisionProduct[]) {
  const byCode = new Map(rows.map(r => [r.itemCode, r]));
  const changes: Array<{ itemCode: string; from: string | null; to: string; basis: string }> = [];
  const missing: DivisionProduct[] = [];
  const before: Record<string, number> = {}, after: Record<string, number> = {};
  let matched = 0, unchanged = 0;
  for (const p of [...products].sort((a, b) => a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0)) {
    const row = byCode.get(p.itemCode);
    before[p.division ?? "(blank)"] = (before[p.division ?? "(blank)"] ?? 0) + 1;
    const to = row && row.confidence !== "EXCLUDE" ? row.proposedDivision : p.division;
    after[to ?? "(blank)"] = (after[to ?? "(blank)"] ?? 0) + 1;
    if (!row) missing.push(p);
    else if (row.confidence !== "EXCLUDE") {
      matched++;
      if (to === p.division) unchanged++;
      else changes.push({ itemCode: p.itemCode, from: p.division, to: to!, basis: row.basis });
    }
  }
  const excluded = rows.filter(r => r.confidence === "EXCLUDE").map(r => ({ ...r, present: products.some(p => p.itemCode === r.itemCode), action: "None" }));
  const groups: Array<{ from: string | null; to: string; count: number }> = [];
  for (const c of changes) {
    const group = groups.find(g => g.from === c.from && g.to === c.to);
    if (group) group.count++; else groups.push({ from: c.from, to: c.to, count: 1 });
  }
  return { matched, unchanged, changes, groups, missing, excluded, before, after,
    catalogueFingerprint: digest([...products].sort((a, b) => a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0)),
    payloadFingerprint: digest(rows), pricesRead: 0, pricesWritten: 0, productsCreated: 0 };
}
