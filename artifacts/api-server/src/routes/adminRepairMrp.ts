/**
 * TEMPORARY one-time repair endpoint.
 * DELETE THIS FILE AND ITS ROUTE IMPORT after production repair is done.
 *
 * POST /api/admin/repair-mrp
 *   Header: X-Repair-Key: <SESSION_SECRET value>
 *   Body:   multipart/form-data  field "file" = Prayag_MRP_Master_AllPeriods.xlsx
 *
 * Performs: backup → delete all mrp_price_history → insert from xlsx →
 *            recompute is_current → upsert catalog_products
 */
import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, mrpPriceHistoryTable, catalogProductsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function norm(v: unknown): string { return String(v ?? "").trim(); }

function findCol(keys: string[], patterns: string[]): string | null {
  for (const p of patterns) {
    const needle = p.toLowerCase().replace(/[\s_]/g, "");
    const exact = keys.find(k => k.toLowerCase().replace(/[\s_]/g, "") === needle);
    if (exact) return exact;
  }
  for (const p of patterns) {
    const needle = p.toLowerCase().replace(/[\s_]/g, "");
    const partial = keys.find(k => k.toLowerCase().replace(/[\s_]/g, "").includes(needle));
    if (partial) return partial;
  }
  return null;
}

function parseDate(val: unknown): string | null {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = norm(val);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

router.post("/admin/repair-mrp", upload.single("file"), async (req, res) => {
  // Key auth
  const secret = process.env.SESSION_SECRET;
  if (!secret || req.headers["x-repair-key"] !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const file = req.file;
  if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

  try {
    const wb = XLSX.read(file.buffer, { type: "buffer", cellDates: true });

    // --- mrp_price_history sheet ---
    const mrpSheet = wb.Sheets["mrp_price_history"];
    if (!mrpSheet) { res.status(400).json({ error: "Sheet 'mrp_price_history' not found" }); return; }
    const mrpRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(mrpSheet, { defval: null, cellDates: true });

    const mrpKeys = Object.keys(mrpRaw[0] ?? {});
    const col_ic   = findCol(mrpKeys, ["item_code", "itemcode", "item code", "code"]);
    const col_mrp  = findCol(mrpKeys, ["mrp", "new mrp", "new_mrp"]);
    const col_date = findCol(mrpKeys, ["effective_date", "effectivedate", "effective date", "date"]);
    const col_cur  = findCol(mrpKeys, ["is_current", "iscurrent", "current"]);
    const col_pb   = findCol(mrpKeys, ["price_basis", "pricebasis", "basis"]);
    const col_pn   = findCol(mrpKeys, ["product_name", "productname", "product name", "description"]);

    if (!col_ic || !col_mrp || !col_date) {
      res.status(400).json({ error: `Missing columns. Found: ${mrpKeys.join(", ")}` });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    type MrpRow = typeof mrpPriceHistoryTable.$inferInsert;
    const validMrp: MrpRow[] = [];
    let mrpSkipped = 0;

    for (const row of mrpRaw) {
      const itemCode = norm(row[col_ic]);
      if (!itemCode) { mrpSkipped++; continue; }
      const mrpNum = typeof row[col_mrp] === "number" ? row[col_mrp] as number : parseFloat(String(row[col_mrp] ?? ""));
      if (isNaN(mrpNum) || mrpNum <= 0) { mrpSkipped++; continue; }
      const effectiveDate = parseDate(row[col_date]);
      if (!effectiveDate) { mrpSkipped++; continue; }
      const isCurrent = col_cur
        ? (row[col_cur] === true || String(row[col_cur]).toLowerCase() === "true" || row[col_cur] === 1)
        : false;
      const priceBasis = col_pb ? (norm(row[col_pb]) || "MRP") : "MRP";
      const productName = col_pn ? (norm(row[col_pn]) || null) : null;
      validMrp.push({ itemCode, mrp: mrpNum, priceBasis, effectiveDate, isCurrent, productName, loadDate: today, sourceFile: "Prayag_MRP_Master_AllPeriods.xlsx" });
    }

    // --- catalog_products sheet ---
    const cpSheet = wb.Sheets["catalog_products"];
    if (!cpSheet) { res.status(400).json({ error: "Sheet 'catalog_products' not found" }); return; }
    const cpRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(cpSheet, { defval: null });
    const cpKeys = Object.keys(cpRaw[0] ?? {});
    const cp_ic  = findCol(cpKeys, ["item_code", "itemcode", "item code", "code"]);
    const cp_pn  = findCol(cpKeys, ["product_name", "productname", "product name", "description"]);
    const cp_div = findCol(cpKeys, ["division"]);
    if (!cp_ic) { res.status(400).json({ error: `Cannot find item_code in catalog sheet. Keys: ${cpKeys.join(", ")}` }); return; }

    type CpRow = typeof catalogProductsTable.$inferInsert;
    const cpValues: CpRow[] = [];
    for (const row of cpRaw) {
      const itemCode = norm(row[cp_ic]);
      if (!itemCode) continue;
      cpValues.push({
        itemCode,
        productName: cp_pn ? (norm(row[cp_pn]) || null) : null,
        division: cp_div ? (norm(row[cp_div]) || null) : null,
        uom: "NOS",
        isActive: true,
        dataFlag: "mrp_repair_2026",
      });
    }

    // BEFORE counts
    const before = (await db.execute(sql`
      SELECT (SELECT COUNT(*) FROM mrp_price_history) AS mrp_rows,
             (SELECT COUNT(DISTINCT item_code) FROM mrp_price_history) AS mrp_items,
             (SELECT COUNT(*) FROM catalog_products) AS catalog_rows,
             (SELECT COUNT(*) FROM competitor_prices) AS comp_prices,
             (SELECT COUNT(DISTINCT item_code) FROM mrp_price_history WHERE mrp < 50) AS items_below_50
    `)).rows[0];

    const BATCH = 500;

    await db.transaction(async (tx) => {
      // 1. Backup
      await tx.execute(sql`DROP TABLE IF EXISTS mrp_price_history_backup_20260818`);
      await tx.execute(sql`CREATE TABLE mrp_price_history_backup_20260818 AS SELECT * FROM mrp_price_history`);

      // 2. Clear
      await tx.execute(sql`DELETE FROM mrp_price_history`);

      // 3. Insert MRP rows
      for (let i = 0; i < validMrp.length; i += BATCH) {
        await tx.insert(mrpPriceHistoryTable).values(validMrp.slice(i, i + BATCH));
      }

      // 4. Recompute is_current
      await tx.execute(sql`UPDATE mrp_price_history SET is_current = false`);
      await tx.execute(sql`
        UPDATE mrp_price_history mph SET is_current = true
        FROM (
          SELECT DISTINCT ON (item_code) id
          FROM mrp_price_history
          WHERE effective_date <= CURRENT_DATE
          ORDER BY item_code, effective_date DESC, id DESC
        ) latest WHERE mph.id = latest.id
      `);

      // 5. Upsert catalog_products
      for (let i = 0; i < cpValues.length; i += BATCH) {
        await tx.insert(catalogProductsTable)
          .values(cpValues.slice(i, i + BATCH))
          .onConflictDoUpdate({
            target: catalogProductsTable.itemCode,
            set: {
              productName: sql`COALESCE(NULLIF(EXCLUDED.product_name, ''), catalog_products.product_name)`,
              division:    sql`COALESCE(NULLIF(EXCLUDED.division, ''), catalog_products.division)`,
              updatedAt:   sql`NOW()`,
            },
          });
      }
    });

    // AFTER counts + spot checks
    const after = (await db.execute(sql`
      SELECT (SELECT COUNT(*) FROM mrp_price_history) AS mrp_rows,
             (SELECT COUNT(DISTINCT item_code) FROM mrp_price_history) AS mrp_items,
             (SELECT COUNT(*) FROM catalog_products) AS catalog_rows,
             (SELECT COUNT(*) FROM competitor_prices) AS comp_prices,
             (SELECT COUNT(DISTINCT item_code) FROM mrp_price_history WHERE mrp < 50) AS items_below_50
    `)).rows[0];

    const spotChecks = (await db.execute(sql`
      SELECT DISTINCT ON (item_code) item_code, mrp, effective_date
      FROM mrp_price_history
      WHERE item_code = ANY(ARRAY['121-B','121-C','CNS-15','U21','C854'])
        AND effective_date <= CURRENT_DATE
      ORDER BY item_code, effective_date DESC, id DESC
    `)).rows;

    const divBreakdown = (await db.execute(sql`
      SELECT COALESCE(cp.division, 'UNKNOWN') AS division,
             COUNT(DISTINCT latest.item_code) AS items_below_50
      FROM (
        SELECT DISTINCT ON (item_code) item_code, mrp
        FROM mrp_price_history
        WHERE effective_date <= CURRENT_DATE
        ORDER BY item_code, effective_date DESC, id DESC
      ) latest
      LEFT JOIN catalog_products cp ON cp.item_code = latest.item_code
      WHERE latest.mrp < 50
      GROUP BY cp.division ORDER BY items_below_50 DESC
    `)).rows;

    res.json({
      status: "ok",
      before,
      after,
      mrpRowsLoaded: validMrp.length,
      mrpSkipped,
      catalogUpserted: cpValues.length,
      spotChecks,
      divBreakdown,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error({ err }, "repair-mrp failed");
    res.status(500).json({ error: msg });
  }
});

export default router;
