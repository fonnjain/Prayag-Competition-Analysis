import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { formatBucketExportDisclosure } from "../../lib/formatting/src/index.ts";
import { hideExportDisclosures, isExportDisclosureRow, workbookHeaderRow } from "../../artifacts/api-server/src/lib/exportDisclosure.ts";

const XLSX = createRequire(path.resolve("artifacts/api-server/package.json"))("xlsx");
for (const name of ["HO (Plumbing) — Excluded", "Excluded"]) {
  for (const type of ["included", "excluded"] as const) {
    for (const format of ["csv", "xlsx"]) {
      test(`${JSON.stringify(name)} / ${type} / ${format}: separate name, type and complete effect`, () => {
        const original = { name, type, count: 184 };
        const disclosure = formatBucketExportDisclosure(original);
        assert.equal(disclosure, `Showing: List name: ${JSON.stringify(name)} · Type: ${type === "excluded" ? "Excluded" : "Included"} · Effect: ${type === "excluded" ? "184 items hidden from results" : "only 184 items shown"}`);
        const data = [[disclosure], ["Display-only product filter; no source product or price data changed."], [], ["Item Code", "MRP"], ["F-70", 100]];
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), "Export");
        const bytes = XLSX.write(book, { type: "buffer", bookType: format });
        const parsed = format === "csv"
          ? XLSX.read(bytes.toString("utf8").replace(/^\uFEFF/, ""), { type: "string", FS: "," })
          : XLSX.read(bytes, { type: "buffer" });
        const rows = XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]], { header: 1, defval: "", blankrows: true });
        assert.equal(rows[0][0], disclosure);
        assert.equal(isExportDisclosureRow(rows[0]), true);
        assert.equal(workbookHeaderRow(rows), 3);
        assert.deepEqual(hideExportDisclosures(rows)[3].slice(0, 2), ["Item Code", "MRP"]);
        assert.deepEqual(original, { name, type, count: 184 });
      });
    }
  }
}
test("escaped raw names remain names, and only single-cell metadata is recognised", () => {
  const name = 'Excluded, "Special" | Type: Included\nΩ';
  const disclosure = formatBucketExportDisclosure({ name, type: "excluded", count: 1 });
  assert.equal(isExportDisclosureRow([disclosure]), true);
  const captured = /^Showing: List name: (".*") · Type: /.exec(disclosure)!;
  assert.equal(JSON.parse(captured[1]), name);
  assert.equal(isExportDisclosureRow([disclosure, 100]), false);
  assert.equal(isExportDisclosureRow(["unexpected note"]), false);
  assert.equal(formatBucketExportDisclosure(null), "Bucket lists: none applied");
});
test("old exported metadata remains recognised for round-trip imports", () => {
  assert.equal(isExportDisclosureRow(["Showing: HO (Plumbing) — Excluded — Excluded · 184 items hidden"]), true);
  assert.equal(isExportDisclosureRow(["Bucket list applied: Excluded (Included) - showing only 1 items"]), true);
  assert.equal(isExportDisclosureRow(["Bucket lists do not apply here."]), true);
});