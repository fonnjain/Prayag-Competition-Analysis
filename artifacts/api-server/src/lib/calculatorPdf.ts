import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { calculatorAssertedBanner, summarizeCalculator, type ResolvedCalculator } from "@workspace/formatting";
import { comparisonNote, coverageText, DENOMINATOR_NOTE } from "./calculatorDocuments";

const require = createRequire(import.meta.url);
const navy = rgb(.125, .23, .36), grey = rgb(.4, .46, .51), green = rgb(.13, .4, .26), red = rgb(.7, .14, .2);
const white = rgb(1, 1, 1), ink = rgb(.14, .18, .23);
const currency = (value: number | null) => value == null ? "No price" : "₹" + value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const fontBytes = Promise.all(
  ["latin", "latin-ext", "greek", "cyrillic"].flatMap(subset => [400, 700].map(async weight => ({
    weight, bytes: await readFile(require.resolve(`@fontsource/noto-sans/files/noto-sans-${subset}-${weight}-normal.woff`)),
  }))),
);

/** A generated text document: no page URL, browser print settings or UI controls. */
export async function createCalculatorPdf(rows: ResolvedCalculator, asOf: string, disclosures: string[]) {
  const summary = summarizeCalculator(rows);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle("Price Comparison"); pdf.setSubject(`Prices as of ${asOf}`);
  const fonts = await Promise.all((await fontBytes).map(async f => ({ weight: f.weight, font: await pdf.embedFont(f.bytes, { subset: true }) })));
  const characterSets = new Map(fonts.map(f => [f.font, new Set(f.font.getCharacterSet())]));
  const chosen = new Map<string, PDFFont>();
  const pickFont = (char: string, bold: boolean): PDFFont => {
    const key = `${bold}:${char}`, cached = chosen.get(key);
    if (cached) return cached;
    const font = fonts.find(f => f.weight === (bold ? 700 : 400) && characterSets.get(f.font)!.has(char.codePointAt(0)!));
    if (!font) throw new Error(`PDF font does not support character ${char}. Download Excel to preserve this text.`);
    chosen.set(key, font.font);
    return font.font;
  };
  const runs = (text: string, bold = false) => {
    const result: { text: string; font: PDFFont }[] = [];
    for (const char of text.replace(/[\t\r]/g, " ")) {
      const font = pickFont(char, bold), last = result.at(-1);
      if (last?.font === font) last.text += char; else result.push({ text: char, font });
    }
    return result;
  };
  const width = (text: string, size: number, bold = false) => runs(text, bold).reduce((n, r) => n + r.font.widthOfTextAtSize(r.text, size), 0);
  const wrap = (text: string, w: number, size: number, bold = false) => {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const char of paragraph) {
        if (line && width(line + char, size, bold) > w) {
          const space = line.lastIndexOf(" ");
          if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1); }
          else { lines.push(line); line = ""; }
        }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  };
  let page = pdf.addPage([595.28, 841.89]), y = 807.89;
  const W = 527.28, left = 34;
  const newPage = () => { page = pdf.addPage([595.28, 841.89]); y = 807.89; };
  const ensure = (height: number) => { if (y - height < 34) newPage(); };
  const text = (value: string, x: number, top: number, size = 7.5, bold = false, color = ink) => {
    let cursor = x;
    for (const r of runs(value, bold)) {
      page.drawText(r.text, { x: cursor, y: top - size, size, font: r.font, color });
      cursor += r.font.widthOfTextAtSize(r.text, size);
    }
  };
  const paragraph = (value: string, size = 7, color = grey) => {
    const lines = wrap(value, W - 8, size);
    for (const line of lines) { ensure(size + 3); text(line, left + 4, y, size, false, color); y -= size + 3; }
  };
  text("Price Comparison", left, y, 17, true); y -= 28;
  paragraph(`Prices as of ${asOf} · ${summary.products} products · ${summary.brands.length} competitors`, 8);
  y -= 7;
  if (summary.assertedPrices) {
    const banner = calculatorAssertedBanner(summary.assertedPrices);
    const lines = wrap(banner, W - 16, 7.5, true), h = lines.length * 10 + 10;
    page.drawRectangle({ x: left, y: y - h, width: W, height: h, color: rgb(1, .95, .8) });
    lines.forEach((line, i) => text(line, left + 8, y - 5 - i * 10, 7.5, true, rgb(.5, .28, .08)));
    y -= h + 10;
  }
  const widths = [195.28, 48, 30, 52, 25, 65, 48, 64];
  type Row = { values: string[]; note?: string; warningNote?: boolean; our?: boolean; head?: boolean; signed?: number | null; signedColumn?: number };
  const rowHeight = (r: Row, cols: number[]) =>
    Math.max(18, ...r.values.map((v, i) => wrap(v, cols[i] - 8, 7.2, !!r.head || !!r.our).length * 10 + 6))
      + (r.note ? wrap(r.note, W - 12, 6.5).length * 9 + 4 : 0);
  const drawRow = (r: Row, cols = widths) => {
    const h = rowHeight(r, cols);
    if (r.head || r.our) page.drawRectangle({ x: left, y: y - h, width: W, height: h, color: r.head ? navy : rgb(.93, .95, .97) });
    let x = left;
    r.values.forEach((value, i) => {
      const lines = wrap(value, cols[i] - 8, 7.2, !!r.head || !!r.our);
      const color = r.head ? white : r.signed != null && i === (r.signedColumn ?? 6) ? (r.signed > 0 ? green : r.signed < 0 ? red : grey) : ink;
      lines.forEach((line, n) => text(line, x + 4, y - 3 - n * 10, 7.2, !!r.head || !!r.our, color));
      x += cols[i];
    });
    if (r.note) {
      const lines = wrap(r.note, W - 12, 6.5);
      lines.forEach((line, n) => text(line, left + 6, y - h + (lines.length - n) * 9, 6.5, false, r.warningNote ? rgb(.55, .32, .1) : grey));
    }
    y -= h;
    page.drawLine({ start: { x: left, y }, end: { x: left + W, y }, color: rgb(.86, .88, .9), thickness: .4 });
  };
  for (const r of rows.filter(r => r.product)) {
    const head: Row = { values: ["Price", "MRP", "Disc", "Net / unit", "Qty", "Total", "vs us", "Source"], head: true };
    const lines: Row[] = [head, { our: true,
      values: ["OUR PRICE", currency(r.our.effectivePrice), `${r.block.discount}%`, currency(r.our.netUnit),
        String(r.our.quantity ?? "—"), currency(r.our.total), "—", r.our.priceState],
      note: [comparisonNote(r), r.our.priceState === "Edited" ? `Overridden app MRP: ${currency(r.our.appPrice)}` : ""].filter(Boolean).join(" · ") },
    ...r.competitors.map(c => ({
      values: [c.competitor! + (c.adHoc ? " (one-off)" : ""), currency(c.effectivePrice), `${c.discount}%`, currency(c.netUnit),
        String(c.quantity ?? "—"), currency(c.total), pct(c.position.diffPct), c.priceState],
      note: [comparisonNote(r, c), c.priceState === "Edited" ? `Overridden app MRP: ${currency(c.appPrice)}` : ""].filter(Boolean).join(" · "),
      warningNote: !!c.warnings.length || !!c.adHoc, signed: c.position.diffPct,
    }))];
    const titleLines = wrap(`${r.block.itemCode} · ${r.product!.productName ?? ""}`, W - 8, 8, true);
    const titleHeight = titleLines.length * 11 + 6;
    const h = titleHeight + lines.reduce((n, row) => n + rowHeight(row, widths), 0) + 10;
    if (h > 773) throw new Error("A product block is too long for one A4 page. Shorten its description or download Excel.");
    ensure(h);
    titleLines.forEach((line, i) => text(line, left + 4, y - i * 11, 8, true));
    y -= titleHeight;
    lines.forEach(row => drawRow(row)); y -= 10;
  }
  ensure(65); text("Summary", left, y, 10, true); y -= 20;
  paragraph(`Products ${summary.products} · Total quantity ${summary.totalQuantity} · Our total value ${currency(summary.ourValue)} · Hand-entered prices ${summary.assertedPrices}`, 8, ink);
  y -= 8;
  const sc = [190.28, 72, 72, 58, 45, 40, 50];
  const summaryHead: Row = { head: true, values: ["Competitor", "Our subtotal", "Their subtotal", "Difference", "Cheaper", "At par", "Higher"] };
  ensure(45); drawRow(summaryHead, sc);
  for (const b of summary.brands) {
    const row: Row = { values: [b.brand + (b.adHoc ? " (Ad-hoc)" : ""), currency(b.ourValue), currency(b.competitorValue), pct(b.position.diffPct),
      String(b.cheaper), String(b.par), String(b.higher)], note: coverageText(b), signed: b.position.diffPct, signedColumn: 3 };
    if (y - rowHeight(row, sc) < 34) { newPage(); drawRow(summaryHead, sc); }
    drawRow(row, sc);
  }
  y -= 9; paragraph(DENOMINATOR_NOTE, 6.5);
  y -= 9; paragraph("Disclosures", 6.5);
  for (const d of disclosures) paragraph(d, 6.5);
  return Buffer.from(await pdf.save());
}
