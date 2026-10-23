import ExcelJS from "exceljs";
import {
  calculatorAssertedBanner, calculatorCompetitorKey, summarizeCalculator,
  type ResolvedCalculator,
} from "@workspace/formatting";

export type ExportCell = string | number | null;
export const MONEY_FORMAT = "[$₹-en-IN]##,##,##0.00";
export const SIGNED_PERCENT = '+0.0%;-0.0%;0.0%';
export const DENOMINATOR_NOTE = "Each competitor is compared only on the products it was quoted against — never against the whole basket.";
export const coverageText = (b: ReturnType<typeof summarizeCalculator>["brands"][number]) =>
  `compared on ${b.compared} of ${b.products} products, ${b.adHocProducts} of which were hand-entered (Ad-hoc)`;
const navy = "203B5C", grey = "687582", green = "216542", red = "B42332";
const comparisonWidths = [11, 42, 13, 8, 13, 6, 15, 17, 9, 34];
const brandName = (b: { brand: string; adHoc: boolean }) => b.brand + (b.adHoc ? " (Ad-hoc)" : "");
export function comparisonNote(r: ResolvedCalculator[number], c?: ResolvedCalculator[number]["competitors"][number]) {
  return c ? [...c.warnings, ...c.notes].join(" ")
    : [r.adHocProduct ? "Ad-hoc product" : null, r.product?.division, r.product?.category,
      r.block.variant !== "Standard" ? r.block.variant : null].filter(Boolean).join(" · ");
}
export function createCalculatorWorkbook(rows: ResolvedCalculator, asOf: string, disclosures: string[], detail: ExportCell[][]) {
  const summary = summarizeCalculator(rows);
  const workbook = new ExcelJS.Workbook();
  const comparison = workbook.addWorksheet("Comparison");
  const facts = workbook.addWorksheet("Summary");
  const data = workbook.addWorksheet("Data");
  const available = rows.filter(r => r.product);
  const subtitle = `Prices as of ${asOf} · ${summary.products} products · ${summary.brands.length} competitors`;
  const header = (s: ExcelJS.Worksheet, values: ExportCell[]) => {
    const row = s.addRow(values);
    row.height = 28;
    row.eachCell({ includeEmpty: true }, c => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
      c.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFF" } };
      c.alignment = { vertical: "middle", wrapText: true };
    });
    return row;
  };
  const mergedLine = (s: ExcelJS.Worksheet, text: string, columns: number, amber = false) => {
    const r = s.addRow([text]); s.mergeCells(r.number, 1, r.number, columns);
    r.height = Math.max(22, Math.ceil(text.length / (columns * 13)) * 13);
    const c = r.getCell(1);
    c.font = { name: "Calibri", size: amber ? 10 : 9, bold: amber, color: { argb: amber ? "8A5215" : grey } };
    c.alignment = { wrapText: true, vertical: "middle" };
    if (amber) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3CD" } };
  };
  const title = (s: ExcelJS.Worksheet, name: string, columns: number) => {
    mergedLine(s, name, columns);
    s.getCell("A1").font = { name: "Calibri", bold: true, size: 18, color: { argb: navy } };
    s.getRow(1).height = 30;
    mergedLine(s, subtitle, columns);
    if (summary.assertedPrices) mergedLine(s, calculatorAssertedBanner(summary.assertedPrices), columns, true);
    s.addRow([]);
  };
  const footer = (s: ExcelJS.Worksheet, columns: number) => {
    s.addRow([]);
    for (const d of disclosures) mergedLine(s, d, columns);
  };
  const money = (r: ExcelJS.Row, columns: number[]) => columns.forEach(i => {
    if (typeof r.getCell(i).value === "number") r.getCell(i).numFmt = MONEY_FORMAT;
  });
  const percent = (c: ExcelJS.Cell, signed = false) => {
    c.numFmt = signed ? SIGNED_PERCENT : "0.0%";
    if (signed && typeof c.value === "number")
      c.font = { ...c.font, bold: true, color: { argb: c.value > 0 ? green : c.value < 0 ? red : grey } };
  };
  const configure = (s: ExcelJS.Worksheet, widths: number[], freeze: number) => {
    // ExcelJS otherwise omits the reference's 9-character Source column as its
    // internal default. A column style forces an explicit <col width="9"/>.
    s.columns = widths.map(width => ({ width, style: { alignment: { vertical: "middle" as const } } }));
    s.views = [{ state: "frozen", xSplit: s === comparison || s === data ? 2 : 0, ySplit: freeze, showGridLines: false }];
    s.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `${freeze}:${freeze}`, margins: { left: .25, right: .25, top: .4, bottom: .4, header: .15, footer: .15 } };
    s.eachRow(r => r.eachCell({ includeEmpty: true }, c => {
      c.font = { name: "Calibri", size: 10, ...c.font };
      c.alignment = { vertical: "middle", wrapText: true, ...c.alignment };
      if (typeof c.value === "number") {
        const label = c.numFmt?.includes("₹")
          ? "₹" + c.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : c.numFmt?.includes("%") ? (c.value * 100).toFixed(1) + "%" : String(c.value);
        // Keep the reference widths for ordinary quotes, but never turn a large
        // valid MRP/quantity/total into Excel's #### display.
        const col = s.getColumn(c.col);
        col.width = Math.max(col.width ?? 14, label.length + 2);
      }
    }));
  };

  title(comparison, "PRICE COMPARISON", 10);
  const ch = header(comparison, ["Item", "Description", "MRP", "Disc %", "Net / unit", "Qty", "Total", "vs us", "Source", "Note"]);
  for (const r of available) {
    const our = comparison.addRow([r.block.itemCode, "OUR PRICE · " + r.product!.productName, r.our.effectivePrice ?? "No price",
      Number(r.block.discount) / 100, r.our.netUnit ?? "No price", r.our.quantity, r.our.total ?? "No price",
      "OUR PRICE", r.our.priceState, comparisonNote(r)]);
    our.eachCell({ includeEmpty: true }, c => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EDF2F7" } };
      c.font = { bold: true, size: 10 };
    });
    our.height = Math.max(32, Math.ceil((r.product!.productName?.length ?? 0) / 35) * 14);
    money(our, [3, 5, 7]); percent(our.getCell(4));
    for (const c of r.competitors) {
      const note = comparisonNote(r, c);
      const line = comparison.addRow([null, c.competitor + (c.adHoc ? " (one-off)" : ""), c.effectivePrice ?? "No price",
        Number(c.discount) / 100, c.netUnit ?? "No price", c.quantity, c.total ?? "No price",
        c.position.diffPct == null ? null : c.position.diffPct / 100, c.priceState, note]);
      line.getCell(2).alignment = { indent: 1, wrapText: true };
      line.height = Math.max(24, Math.ceil(note.length / 32) * 13);
      money(line, [3, 5, 7]); percent(line.getCell(4)); percent(line.getCell(8), true);
    }
    comparison.addRow([]);
  }
  const total = comparison.addRow(["OUR TOTAL", null, null, null, null, summary.totalQuantity, summary.ourValue]);
  total.font = { bold: true }; money(total, [7]);
  footer(comparison, 10);
  configure(comparison, comparisonWidths, ch.number);

  title(facts, "SUMMARY", Math.max(8, summary.brands.length + 5));
  for (const row of [
    ["App prices", summary.priceCounts.App], ["Edited prices", summary.priceCounts.Edited], ["Entered prices", summary.priceCounts.Entered],
    ["Ad-hoc products", summary.adHocProducts], ["Ad-hoc competitors", summary.adHocCompetitors.length, summary.adHocCompetitors.join(", ")],
    ["Products compared", summary.products], ["Total quantity", summary.totalQuantity], ["Our total value", summary.ourValue],
  ]) {
    const line = facts.addRow(row); line.getCell(1).font = { bold: true };
    if (row[0] === "Our total value") money(line, [2]);
  }
  facts.addRow([]);
  const sh = header(facts, ["Competitor", "Coverage", "Our subtotal", "Their subtotal", "Difference", "Cheaper", "At par", "Higher"]);
  for (const b of summary.brands) {
    const line = facts.addRow([brandName(b), `${b.compared} / ${b.products}`, b.ourValue, b.competitorValue,
      b.position.diffPct == null ? null : b.position.diffPct / 100, b.cheaper, b.par, b.higher]);
    money(line, [3, 4]); percent(line.getCell(5), true);
    mergedLine(facts, coverageText(b), 8);
  }
  mergedLine(facts, DENOMINATOR_NOTE, Math.max(8, summary.brands.length + 5));
  facts.addRow([]);
  header(facts, ["Product code", "Name", "Variant", "Quantity", "Our total", ...summary.brands.map(brandName)]);
  for (const r of available) {
    const line = facts.addRow([r.block.itemCode, r.product!.productName, r.block.variant, r.our.quantity, r.our.total ?? "No price",
      ...summary.brands.map(b => r.competitors.find(c => calculatorCompetitorKey(c) === b.key)?.total ?? "—")]);
    money(line, [5, ...summary.brands.map((_, i) => i + 6)]);
  }
  footer(facts, Math.max(8, summary.brands.length + 5));
  configure(facts, Array.from({ length: Math.max(8, summary.brands.length + 5) }, (_, i) =>
    i === 0 ? 32 : i === 1 ? 42 : i === 2 ? 18 : 20), sh.number);

  const dh = header(data, detail[0]);
  for (const values of detail.slice(1)) {
    const line = data.addRow(values);
    money(line, [7, 10, 12, 14, 17, 18, 19, 21, 28, 30]);
    percent(line.getCell(20));
  }
  data.autoFilter = { from: { row: 1, column: 1 }, to: { row: data.rowCount, column: 32 } };
  configure(data, Array.from({ length: 32 }, (_, i) => Math.max(
    [6, 9, 11, 13, 16, 17, 18, 20, 27, 29].includes(i) ? 24 : 14,
    Math.min(60, Math.max(...detail.map(row => String(row[i] ?? "").length)) + 2))), dh.number);
  return workbook;
}
