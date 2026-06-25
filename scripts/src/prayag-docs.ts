import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
} from "docx";

// ---------------------------------------------------------------------------
// One-off generator for two shareable deliverables:
//   1. Prayag_Web_App_Data_Structure.xlsx  — every DB table + column documented
//   2. How_Supplier_Prices_Are_Read.docx   — plain-language explanation of how
//      individual competitor/supplier prices are pulled and compared
// ---------------------------------------------------------------------------

const OUT_DIR = resolve(process.cwd(), "deliverables");
mkdirSync(OUT_DIR, { recursive: true });

type Col = {
  column: string;
  type: string;
  nullable: string;
  key: string;
  description: string;
};

type TableDef = {
  table: string;
  usedBy: string;
  purpose: string;
  columns: Col[];
};

const TABLES: TableDef[] = [
  {
    table: "catalog_products",
    usedBy: "Product Database, Competition Analysis",
    purpose:
      "Central master catalog — one row per unique Prayag product. The single source of truth for product identity, division/category, and cost.",
    columns: [
      { column: "id", type: "serial (integer)", nullable: "No", key: "Primary key", description: "Auto-generated unique row id." },
      { column: "item_code", type: "text", nullable: "No", key: "Unique", description: "Prayag's internal product code. Unique per product; the key everything else joins on." },
      { column: "product_name", type: "text", nullable: "Yes", key: "", description: "Human-readable product name/description." },
      { column: "division", type: "text", nullable: "Yes", key: "Indexed", description: "Top-level business division (e.g. Pipes, Fittings)." },
      { column: "category", type: "text", nullable: "Yes", key: "Indexed", description: "Product category within the division." },
      { column: "series_range", type: "text", nullable: "Yes", key: "", description: "Product series / range grouping." },
      { column: "size", type: "text", nullable: "Yes", key: "", description: "Size descriptor (e.g. 110 mm)." },
      { column: "uom", type: "text", nullable: "No (default NOS)", key: "", description: "Unit of measure (NOS, MTR, etc.)." },
      { column: "kg_cost", type: "double precision", nullable: "Yes", key: "", description: "Per-kg input cost, when known. Used for margin floors." },
      { column: "is_active", type: "boolean", nullable: "No (default true)", key: "", description: "Whether the product is still active in the catalog." },
      { column: "source_files", type: "text", nullable: "Yes", key: "", description: "Which uploaded file(s) this product came from." },
      { column: "data_flag", type: "text", nullable: "Yes", key: "", description: "Data-quality marker set during cleaning." },
      { column: "created_at", type: "timestamptz", nullable: "No", key: "", description: "When the row was first inserted." },
      { column: "updated_at", type: "timestamptz", nullable: "No", key: "", description: "When the row was last updated." },
    ],
  },
  {
    table: "mrp_price_history",
    usedBy: "Product Database, Competition Analysis",
    purpose:
      "Append-only history of Prayag's own MRP / net prices. Every price load INSERTs new rows; old rows are never edited or deleted. The single row flagged is_current per item_code is today's live price.",
    columns: [
      { column: "id", type: "serial (integer)", nullable: "No", key: "Primary key", description: "Auto-generated unique row id." },
      { column: "item_code", type: "text", nullable: "No", key: "Indexed", description: "Links to catalog_products.item_code." },
      { column: "mrp", type: "double precision", nullable: "Yes", key: "", description: "Prayag's MRP (list price) for this product at this date." },
      { column: "net_price", type: "double precision", nullable: "Yes", key: "", description: "Net price after discount." },
      { column: "discount_pct", type: "double precision", nullable: "Yes", key: "", description: "Discount percentage off MRP." },
      { column: "price_basis", type: "text", nullable: "No (default Verify)", key: "", description: "Basis label for the price figure." },
      { column: "effective_date", type: "date", nullable: "No", key: "Unique w/ code", description: "The date this price became effective. Latest effective_date per item_code = current price." },
      { column: "load_date", type: "date", nullable: "No", key: "", description: "Date the price was loaded into the system." },
      { column: "source_file", type: "text", nullable: "Yes", key: "", description: "Originating uploaded file." },
      { column: "is_current", type: "boolean", nullable: "No (default false)", key: "Indexed", description: "True only for the latest price per item_code. Recomputed after every load; this is the price the dashboards compare against." },
      { column: "notes", type: "text", nullable: "Yes", key: "", description: "Free-text notes." },
    ],
  },
  {
    table: "competitor_prices",
    usedBy: "Competition Analysis",
    purpose:
      "One row per competitor/supplier SKU. This is where every individual supplier's price lives. Generic 'competitor' column lets any brand (Astral, Finolex, Supreme, Hindware, ...) load in the same shape.",
    columns: [
      { column: "id", type: "serial (integer)", nullable: "No", key: "Primary key", description: "Auto-generated unique row id." },
      { column: "competitor", type: "text", nullable: "No", key: "Indexed", description: "The supplier / competitor brand name. This is the column that separates each individual supplier's prices." },
      { column: "category", type: "text", nullable: "Yes", key: "Indexed", description: "Competitor's own category label." },
      { column: "description", type: "text", nullable: "Yes", key: "", description: "Competitor's product description as printed in their list." },
      { column: "size", type: "text", nullable: "Yes", key: "", description: "Size descriptor from the competitor sheet." },
      { column: "price", type: "double precision", nullable: "No", key: "", description: "The competitor's raw printed price. Interpreted using the 'unit' column before comparison." },
      { column: "unit", type: "text", nullable: "Yes", key: "", description: "Price basis. 'Rate (ex-GST)' means GST must be added (x1.18). Null/empty/other = already MRP-comparable." },
      { column: "effective_date", type: "date", nullable: "Yes", key: "", description: "Date the competitor price applies from." },
      { column: "matched_prayag_code", type: "text", nullable: "Yes", key: "Indexed", description: "Links this competitor SKU to a catalog_products.item_code when a mapping exists." },
      { column: "match_status", type: "text", nullable: "No (default 'no match (review)')", key: "", description: "'matched' = confirmed link to a Prayag product. Only matched rows get a price gap computed." },
      { column: "match_confidence", type: "text", nullable: "Yes", key: "", description: "Mapping quality: High / Medium / Low / null. High & Medium auto-accepted; Low + no-match go to review." },
      { column: "created_at", type: "timestamptz", nullable: "No", key: "", description: "When the row was first inserted." },
      { column: "updated_at", type: "timestamptz", nullable: "No", key: "", description: "When the row was last updated." },
    ],
  },
  {
    table: "code_conflicts",
    usedBy: "Product Database (Data Health)",
    purpose:
      "Known item-code conflicts flagged during cleaning — the same code appearing with different names across source files.",
    columns: [
      { column: "item_code", type: "text", nullable: "No", key: "Primary key", description: "The conflicting item code." },
      { column: "conflicting_names", type: "text", nullable: "Yes", key: "", description: "The differing names seen for this code." },
      { column: "sources", type: "text", nullable: "Yes", key: "", description: "Which source files the conflict came from." },
    ],
  },
  {
    table: "products",
    usedBy: "Competition Console (legacy)",
    purpose:
      "The original Competition Console product table (shares this database). One row per product with Prayag MRP/net/cost.",
    columns: [
      { column: "item_code", type: "text", nullable: "No", key: "Primary key", description: "Console product code." },
      { column: "category", type: "text", nullable: "No", key: "Indexed", description: "Product category." },
      { column: "size", type: "text", nullable: "Yes", key: "", description: "Size descriptor." },
      { column: "prayag_mrp", type: "double precision", nullable: "Yes", key: "", description: "Prayag MRP." },
      { column: "prayag_net", type: "double precision", nullable: "Yes", key: "", description: "Prayag net price." },
      { column: "kg_cost", type: "double precision", nullable: "Yes", key: "", description: "Per-kg cost." },
      { column: "edited", type: "boolean", nullable: "No (default false)", key: "", description: "Whether a user manually edited this row." },
    ],
  },
  {
    table: "competitors",
    usedBy: "Competition Console (legacy)",
    purpose: "Console competitor registry — controls each competitor's comparison basis and visibility.",
    columns: [
      { column: "name", type: "text", nullable: "No", key: "Primary key", description: "Competitor name." },
      { column: "basis", type: "text", nullable: "No", key: "", description: "Comparison basis for this competitor (net / mrp / mixed)." },
      { column: "hidden", type: "boolean", nullable: "No (default false)", key: "", description: "Whether the competitor column is hidden in the matrix." },
    ],
  },
  {
    table: "comparisons",
    usedBy: "Competition Console (legacy)",
    purpose: "Console comparison rows — one competitor price point per (competitor, item_code).",
    columns: [
      { column: "id", type: "serial (integer)", nullable: "No", key: "Primary key", description: "Auto-generated unique row id." },
      { column: "competitor", type: "text", nullable: "No", key: "Indexed", description: "Competitor name." },
      { column: "item_code", type: "text", nullable: "No", key: "Indexed", description: "Prayag product code." },
      { column: "basis", type: "text", nullable: "No", key: "", description: "Basis for this comparison row." },
      { column: "comp_mrp", type: "double precision", nullable: "Yes", key: "", description: "Competitor MRP." },
      { column: "comp_price", type: "double precision", nullable: "Yes", key: "", description: "Competitor net/effective price." },
      { column: "match_method", type: "text", nullable: "No (default 'code')", key: "", description: "How the row was matched." },
      { column: "source_file", type: "text", nullable: "Yes", key: "", description: "Originating file." },
      { column: "edited", type: "boolean", nullable: "No (default false)", key: "", description: "Whether manually edited." },
    ],
  },
  {
    table: "settings",
    usedBy: "Competition Console (legacy)",
    purpose: "Single-row global settings for the Console.",
    columns: [
      { column: "id", type: "serial (integer)", nullable: "No", key: "Primary key", description: "Row id." },
      { column: "minimum_margin_pct", type: "double precision", nullable: "No (default 15)", key: "", description: "Minimum margin % used as a floor for price recommendations." },
    ],
  },
];

// ---------------------------------------------------------------------------
// 1. Excel workbook
// ---------------------------------------------------------------------------
function buildExcel(): void {
  const wb = XLSX.utils.book_new();

  // Overview sheet
  const overviewAoa: (string | number)[][] = [
    ["Prayag Web App — Database Structure"],
    ["Generated for reference. One sheet per table below."],
    [],
    ["Table", "Used by", "Columns", "Purpose"],
    ...TABLES.map((t) => [t.table, t.usedBy, t.columns.length, t.purpose]),
  ];
  const overviewWs = XLSX.utils.aoa_to_sheet(overviewAoa);
  overviewWs["!cols"] = [{ wch: 22 }, { wch: 32 }, { wch: 10 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, overviewWs, "Overview");

  for (const t of TABLES) {
    const aoa: (string | number)[][] = [
      [`Table: ${t.table}`],
      [`Used by: ${t.usedBy}`],
      [t.purpose],
      [],
      ["Column", "Type", "Nullable", "Key / Index", "Description"],
      ...t.columns.map((c) => [c.column, c.type, c.nullable, c.key, c.description]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 22 }, { wch: 16 }, { wch: 80 }];
    // Sheet names max 31 chars.
    XLSX.utils.book_append_sheet(wb, ws, t.table.slice(0, 31));
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const path = resolve(OUT_DIR, "Prayag_Web_App_Data_Structure.xlsx");
  writeFileSync(path, buf);
  console.log("Wrote", path);
}

// ---------------------------------------------------------------------------
// 2. Word document
// ---------------------------------------------------------------------------
function h(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
}
function p(text: string) {
  return new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } });
}
function bullet(text: string) {
  return new Paragraph({ children: [new TextRun(text)], bullet: { level: 0 }, spacing: { after: 60 } });
}
function step(n: number, title: string, body: string) {
  return new Paragraph({
    children: [new TextRun({ text: `Step ${n}: ${title}. `, bold: true }), new TextRun(body)],
    spacing: { after: 120 },
  });
}

function exampleTable(): Table {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const headerCells = ["Field", "Value", "Meaning"];
  const rows: [string, string, string][] = [
    ["competitor", "Astral", "Which supplier this price belongs to"],
    ["price", "100", "The raw price printed on Astral's list"],
    ["unit", "Rate (ex-GST)", "Price is before GST -> add 18%"],
    ["Effective price", "118", "100 x 1.18 = 118 (now comparable to Prayag MRP)"],
    ["matched_prayag_code", "PG-110-SWR", "Linked to a Prayag product"],
    ["Prayag current MRP", "100", "From mrp_price_history where is_current = true"],
    ["Price gap", "+18", "118 - 100 = Prayag is cheaper by 18 (good / green)"],
    ["Price gap %", "+18%", "Positive = Prayag cheaper = margin headroom"],
  ];
  function cell(text: string, bold = false) {
    return new TableCell({
      borders,
      width: { size: 33, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    });
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headerCells.map((c) => cell(c, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
    ],
  });
}

async function buildDocx(): Promise<void> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: "How Individual Supplier Prices Are Read", bold: true, size: 36 })],
            alignment: AlignmentType.LEFT,
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: "Prayag Competition Analysis — data flow explained in plain language", italics: true, color: "555555" })],
            spacing: { after: 240 },
          }),

          h("1. Where supplier prices live", HeadingLevel.HEADING_1),
          p("Every individual supplier's price is stored in one table called competitor_prices. Each row is a single product from a single supplier. The column named \"competitor\" holds the supplier's brand name (for example Astral, Finolex, Supreme, Hindware), which is how one supplier's prices are kept separate from another's."),
          p("All suppliers share the exact same table shape, so adding a new supplier never needs a new table — their rows simply carry a different value in the \"competitor\" column."),

          h("2. Where Prayag's own price comes from", HeadingLevel.HEADING_1),
          p("Prayag's prices live in a separate table called mrp_price_history. This table keeps a full history — every price load adds new rows and nothing is ever overwritten. The one current price for each product is the row marked is_current = true (the latest effective date). The dashboard always compares suppliers against this current Prayag MRP."),

          h("3. How a supplier price is matched to a Prayag product", HeadingLevel.HEADING_1),
          p("A supplier price is only useful once we know which Prayag product it corresponds to. Each competitor_prices row carries a matched_prayag_code that links it to a product in the master catalog (catalog_products). The quality of that link is recorded as match_confidence (High, Medium, or Low) and match_status."),
          bullet("match_status = \"matched\": the link is confirmed and the price will be compared."),
          bullet("Any other status (e.g. \"no match (review)\"): the price is counted in coverage, but NOT used in any price-gap calculation."),
          p("Important: a price gap is only ever computed when the row is matched AND Prayag has a current MRP for that product AND the supplier price exists. This keeps the comparison honest."),

          h("4. Making prices comparable (GST normalization)", HeadingLevel.HEADING_1),
          p("Suppliers quote prices on different bases. The \"unit\" column tells us how to read each supplier's price before comparing:"),
          bullet("unit = \"Rate (ex-GST)\": the price is before tax, so we add 18% GST (multiply by 1.18) to get the effective price."),
          bullet("unit is empty or anything else: the price is already comparable to Prayag's MRP and is used as-is."),
          p("This adjusted figure is called the \"effective price\", and it is what actually gets compared to Prayag's MRP."),

          h("5. How the price gap is calculated", HeadingLevel.HEADING_1),
          p("Once the supplier's effective price and Prayag's current MRP are both known:"),
          bullet("Price gap = supplier effective price minus Prayag MRP."),
          bullet("Price gap % = price gap divided by Prayag MRP, times 100."),
          p("The sign tells the story: a positive number means the supplier is more expensive than Prayag, i.e. Prayag is cheaper — shown in GREEN as a margin/opportunity. A negative number means Prayag is more expensive — shown in RED as a competitive threat."),

          h("6. Worked example", HeadingLevel.HEADING_1),
          p("Suppose Astral lists a product at 100, marked \"Rate (ex-GST)\", and it is matched to a Prayag product whose current MRP is 100:"),
          exampleTable(),

          h("7. How filters work", HeadingLevel.HEADING_1),
          p("Every screen and export on the Analysis dashboard reads from the same prepared list of rows, then applies the same set of filters: supplier (one or many), division, category, match confidence, and match status. Because all views share one pipeline, the numbers stay consistent no matter which chart or table you look at."),

          h("8. Live, always up to date", HeadingLevel.HEADING_1),
          p("Nothing is pre-saved or cached. Every time a screen loads, the system reads the latest catalog, the current Prayag prices, and all supplier prices, then recomputes the comparison on the spot. Any new price upload is reflected immediately."),

          h("9. A note on data quality", HeadingLevel.HEADING_1),
          p("A few supplier rows contain prices entered at the wrong scale (for example a per-piece figure recorded in lakhs). These outliers inflate the simple average price gap. For that reason the dashboard leads with the MEDIAN gap, which is robust to such noise, while still showing the average honestly rather than hiding it."),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  const path = resolve(OUT_DIR, "How_Supplier_Prices_Are_Read.docx");
  writeFileSync(path, buf);
  console.log("Wrote", path);
}

buildExcel();
await buildDocx();
console.log("Done.");
