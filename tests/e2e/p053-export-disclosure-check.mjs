import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { formatBucketExportDisclosure } from "../../lib/formatting/src/index.ts";
const XLSX = createRequire(path.resolve("artifacts/api-server/package.json"))("xlsx");
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
assert.ok(process.env.REPLIT_DEV_DOMAIN && new URL(base).hostname.endsWith(".replit.dev"));
const dir = "reports/p053-export-fix";
await fs.mkdir(dir, { recursive: true });
const stamp = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium" }).format(new Date());
let sid, original, ids = [];
const results = [];
const call = (url, method = "GET", data) => fetch(base + "/api" + url, {
  method, headers: { ...(sid ? { Authorization: `Bearer ${sid}` } : {}), ...(data ? { "Content-Type": "application/json" } : {}) },
  ...(data ? { body: JSON.stringify(data) } : {}),
});
try {
  const login = await call("/login", "POST", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200); sid = (await login.json()).sid; assert.ok(sid);
  assert.equal((await (await call("/auth/user")).json()).user?.role, "admin");
  original = await (await call("/bucket-lists/active")).json();
  const products = (await (await call("/bucket-lists/catalogue")).json()).products;
  const codes = [...new Set(products.map(p => p.itemCode))];
  assert.ok(codes.length > 184);
  for (const [label, name] of [["ho-name", "HO (Plumbing) — Excluded"], ["short-name", "Excluded"]]) {
    const created = await call("/bucket-lists", "POST", { name, type: "excluded", visibility: "only_me", rules: [], addedCodes: codes.slice(0, 184), removedCodes: [] });
    assert.equal(created.status, 201, "Private acceptance name must be unused; never change an existing list.");
    const id = (await created.json()).id; ids.push(id);
    assert.equal((await call("/bucket-lists/active", "PUT", { listId: id })).status, 200);
    const active = (await (await call("/bucket-lists/active")).json()).list;
    const expected = formatBucketExportDisclosure({ name: active.name, type: active.type, count: active.activeCount ?? active.count });
    const routes = [
      ["catalogue", "/catalog/export?type=catalog&scope=in-force&asOf=2026-10-04", ["csv", "xlsx"]],
      ["history", "/catalog/export?type=history&asOf=2026-10-04", ["csv", "xlsx"]],
      ["revisions", "/catalog/export?type=catalog&scope=revisions&asOf=2026-10-04", ["csv", "xlsx"]],
      ["comparison", "/catalog/comparison/export?", ["csv", "xlsx"]],
      ["mapping-review", "/catalog/mapping-review/export?", ["csv", "xlsx"]],
      ["price-finder-comparison", "/price-finder/comparison/export?code=" + encodeURIComponent(codes[184]), ["xlsx"]],
      ["analysis", "/analysis/export?", ["csv", "xlsx"]],
    ];
    for (const [kind, url, formats] of routes) for (const format of formats) {
      const response = await call(url + "&format=" + format);
      assert.equal(response.status, 200, `${kind}/${format}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const book = format === "csv"
        ? XLSX.read(bytes.toString("utf8").replace(/^\uFEFF/, ""), { type: "string", FS: "," })
        : XLSX.read(bytes, { type: "buffer" });
      for (const sheetName of book.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, defval: "" });
        assert.equal(rows[0][0], expected, `${kind}/${format}/${sheetName}`);
        assert.equal(rows[1][0], "Display-only product filter; no source product or price data changed.");
      }
      const filename = `${label}-${kind}.${format}`, timeIST = stamp();
      await fs.writeFile(`${dir}/${filename}`, bytes); // Exact HTTP bytes.
      results.push({ environment: "development", timeIST, name, type: "excluded", count: active.activeCount ?? active.count, kind, format, filename, bytes: bytes.length, sheets: book.SheetNames, disclosure: expected, passed: true });
      console.log(`${kind}/${format}/${label} passed ${timeIST} IST`);
    }
    // The existing browser exporter quotes each metadata cell; exercise that
    // exact quoting with the shared formatter, without creating a saved run.
    const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [[expected], ["Display-only product filter; no source product or price data changed."], [], ["item_code", "product"]].map(row => row.map(quote).join(",")).join("\n");
    const book = XLSX.read(csv, { type: "string", FS: "," });
    assert.equal(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 })[0][0], expected);
    results.push({ environment: "development formatter/writer check", timeIST: stamp(), name, kind: "browser-mrp-generator", format: "csv", disclosure: expected, passed: true });
  }
  // Import review is intentionally full-scope; use a real existing batch only.
  const listing = await call("/catalog/import-batches");
  if (listing.ok) {
    const value = await listing.json();
    const batches = Array.isArray(value) ? value : value.batches ?? value.items ?? [];
    if (batches[0]?.id) {
      const response = await call(`/catalog/import-batches/${batches[0].id}/export`);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      const book = XLSX.read(bytes, { type: "buffer" });
      for (const sheet of book.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1 });
        assert.equal(rows[0][0], "Bucket lists do not apply here.");
        assert.equal(rows[1][0], "Full-scope maintenance review; no active bucket filter applied.");
      }
      await fs.writeFile(`${dir}/import-review-full-scope.xlsx`, bytes);
      results.push({ environment: "development", timeIST: stamp(), kind: "import-review", format: "xlsx", scope: "unchanged full scope", passed: true });
    }
  }
} finally {
  if (sid) {
    if (original) assert.equal((await call("/bucket-lists/active", "PUT", { listId: original.list?.id ?? null })).status, 200);
    for (const id of ids) assert.equal((await call(`/bucket-lists/${id}`, "DELETE")).status, 200);
    await call("/logout");
    assert.equal((await (await call("/auth/user")).json()).user, null);
    console.log("Private fixtures deleted, original active preference restored, own session revoked", stamp(), "IST");
  }
  await fs.writeFile(`${dir}/export-test-results.json`, JSON.stringify(results, null, 2));
}