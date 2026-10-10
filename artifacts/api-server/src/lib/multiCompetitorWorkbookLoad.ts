import { and, eq, sql } from "drizzle-orm";
import { db, mrpLoadBatchesTable, mrpSourcesTable } from "@workspace/db";
import {
  assertWorkbookScope, codeKey, hash, parseMultiCompetitorWorkbook,
  PROTECTED_WORKBOOK_BRANDS, WORKBOOK_LOADER_KIND, type WorkbookRow, type WorkbookParse,
} from "./multiCompetitorWorkbook";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const arrayParam = (values: string[]) => sql`ARRAY[${sql.join(values.map(v => sql`${v}`), sql`, `)}]::text[]`;
type PriceSnapshot = Record<string, unknown> & {id: number; competitor: string; is_current: boolean};
type Metadata = WorkbookParse & {
  kind: string; status: "preview" | "applied" | "undone"; createdAt: string; expiresAt: string;
  appliedAt?: string; undoneAt?: string; undoReason?: string; appliedBy?: string; undoneBy?: string;
  before_snapshot?: PriceSnapshot[]; after_snapshot?: PriceSnapshot[];
  catalogueDigest: string; scopeDigest: string;
  summary: {eligible: number; inserted: number; unchanged: number; conflicts: number;
    periods: {competitor: string; effectiveDate: string; rows: number}[]};
};
export class WorkbookLoadError extends Error {
  constructor(message: string, public status = 409) {super(message);}
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  return JSON.stringify(v);
}
async function storedNames(tx: Tx) {
  const r = await tx.execute<{competitor: string}>(sql`SELECT DISTINCT competitor FROM competitor_prices`);
  return r.rows.map(x => x.competitor);
}
async function snapshot(tx: Tx, brands: string[]): Promise<PriceSnapshot[]> {
  assertWorkbookScope(brands);
  const r = await tx.execute<{row: PriceSnapshot}>(sql`SELECT to_jsonb(c) AS row FROM competitor_prices c
    WHERE competitor = ANY(${arrayParam(brands)}) AND competitor <> ALL(${arrayParam(PROTECTED_WORKBOOK_BRANDS)}) ORDER BY id`);
  return r.rows.map(x => x.row);
}
async function locks(tx: Tx, brands: string[]) {
  assertWorkbookScope(brands);
  await tx.execute(sql`SELECT set_config('TimeZone','UTC',true)`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('price-editor:vocabulary'))`);
  for (const b of [...brands].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"competitor-current-flags:" + b}))`);
  await tx.execute(sql`LOCK TABLE competitor_prices IN SHARE ROW EXCLUSIVE MODE`);
}
async function classify(tx: Tx, parsed: WorkbookParse) {
  const brands = [...new Set(parsed.rows.map(r => r.competitor))];
  // Include selected brand groups that have only refusals.
  for (const u of parsed.unitSummary) if (!brands.includes(u.competitor)) brands.push(u.competitor);
  assertWorkbookScope(brands);
  const products = await tx.execute<{item_code: string; product_name: string; category: string | null; size: string | null}>(
    sql`SELECT item_code,product_name,category,size FROM catalog_products ORDER BY item_code`);
  const exact = new Map(products.rows.map(p => [p.item_code, p]));
  const canonical = new Map<string, typeof products.rows>();
  for (const p of products.rows) {
    const k = codeKey(p.item_code);
    canonical.set(k, [...(canonical.get(k) ?? []), p]);
  }
  const refused = [...parsed.refused];
  const rows: WorkbookRow[] = [];
  for (const row of parsed.rows) {
    const candidates = canonical.get(codeKey(row.prayagCode)) ?? [];
    // Spaced and unspaced catalogue codes can be distinct valid products.
    // Exact identity wins; unrelated normalization collisions never block a
    // selected-brand import, and ambiguous fallbacks must not choose a product.
    const p = exact.get(row.prayagCode) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!p) refused.push({...row, reason: candidates.length > 1 ? "Ambiguous normalized code; exact catalogue code required" : "Not in destination catalogue"});
    else rows.push({...row, prayagCode: p.item_code});
  }
  const before = await snapshot(tx, brands);
  const byIdentity = new Map(before.map(r => [`${r.competitor}|${r.matched_prayag_code}|${r.effective_date}`, r]));
  let unchanged = 0, conflicts = 0;
  const insertRows: WorkbookRow[] = [];
  for (const r of rows) {
    const existing = byIdentity.get(`${r.competitor}|${r.prayagCode}|${r.effectiveDate}`);
    if (!existing) insertRows.push(r);
    else if (existing.price === r.price && existing.unit === r.unit && existing.competitor_code === r.competitorCode &&
      existing.match_status === "matched" && existing.price_basis === "MRP") unchanged++;
    else {conflicts++; refused.push({...r, reason: "Existing product-period differs; this append-only loader will not overwrite it"});}
  }
  const counts = new Map<string, {competitor: string; effectiveDate: string; rows: number}>();
  for (const r of rows) {
    const key = `${r.competitor}|${r.effectiveDate}`;
    const p = counts.get(key) ?? {competitor: r.competitor, effectiveDate: r.effectiveDate, rows: 0};
    p.rows++; counts.set(key, p);
  }
  const identities = rows.map(r => exact.get(r.prayagCode)!).sort((a, b) => a.item_code.localeCompare(b.item_code));
  return {brands, rows, insertRows, refused, before, catalogueDigest: hash(stable(identities)),
    scopeDigest: hash(stable(before)), summary: {eligible: rows.length, inserted: insertRows.length, unchanged, conflicts,
      periods: [...counts.values()].sort((a, b) => `${a.competitor}|${a.effectiveDate}`.localeCompare(`${b.competitor}|${b.effectiveDate}`))}};
}
function readMetadata(notes: string | null): Metadata {
  const m = JSON.parse(notes ?? "{}");
  if (m.kind === WORKBOOK_LOADER_KIND) return m;
  // Existing audited, insert-only workbook batches remain visible and undoable
  // in the app. This adapts their ledger, not a special workbook parser.
  if (m.kind === "P055-approved-competitor-load" && Array.isArray(m.source_rows) && Array.isArray(m.after_snapshot)) {
    const rows: WorkbookRow[] = m.source_rows.map((r: any) => ({
      competitor: r.competitor, prayagCode: r.prayag_code, competitorCode: r.competitor_code,
      price: r.price, effectiveDate: r.effective_date, unit: r.unit, sheet: r.sheet, row: r.excel_row, priceCell: r.price_cell,
    }));
    return {...m, kind: WORKBOOK_LOADER_KIND, rows, brands: [...new Set(rows.map(r => r.competitor))],
      contentFingerprint: m.content_sha256, fileSha256: m.source_sha256, createdAt: m.applied_at, appliedAt: m.applied_at,
      summary: {eligible: rows.length, inserted: rows.length, unchanged: 0, conflicts: 0, periods: m.approved_period_counts.map((p: any) => ({competitor: p.competitor, effectiveDate: p.date, rows: p.rows}))},
      refused: [], unitSummary: [], nameResolutions: [], blockers: [], before_snapshot: [],
    };
  }
  throw new WorkbookLoadError("This is not a multi-competitor workbook batch.", 404);
}
export function workbookBatchDetail(batch: typeof mrpLoadBatchesTable.$inferSelect) {
  const m = readMetadata(batch.notes);
  return {id: batch.id, fileName: batch.fileName ?? "", status: m.status, brands: m.brands,
    contentFingerprint: m.contentFingerprint, fileSha256: batch.fileSha256, createdAt: m.createdAt,
    appliedAt: m.appliedAt ?? null, undoneAt: m.undoneAt ?? null, expiresAt: m.expiresAt ?? null,
    summary: m.summary, refused: m.refused, unitSummary: m.unitSummary, nameResolutions: m.nameResolutions, blockers: m.blockers};
}
export async function listWorkbookBatches() {
  const records = await db.select().from(mrpLoadBatchesTable)
    .where(sql`${mrpLoadBatchesTable.notes} LIKE ${`%"kind":"${WORKBOOK_LOADER_KIND}"%`}
      OR ${mrpLoadBatchesTable.notes} LIKE ${'%"kind": "P055-approved-competitor-load"%'}
      OR ${mrpLoadBatchesTable.notes} LIKE ${'%"kind":"P055-approved-competitor-load"%'}`)
    .orderBy(sql`${mrpLoadBatchesTable.id} DESC`).limit(100);
  return records.flatMap(b => {try {return [workbookBatchDetail(b)];} catch {return [];}});
}
export async function getWorkbookBatch(id: number) {
  const [b] = await db.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, id));
  if (!b) throw new WorkbookLoadError("Batch not found.", 404);
  return workbookBatchDetail(b);
}
export async function previewWorkbook(buffer: Buffer, fileName: string, selected: string[], actor: string) {
  assertWorkbookScope(selected);
  return db.transaction(async tx => {
    await locks(tx, selected);
    const parsed = parseMultiCompetitorWorkbook(buffer, selected, await storedNames(tx));
    const classified = await classify(tx, parsed);
    const now = new Date();
    const metadata: Metadata = {...parsed, brands: classified.brands, rows: classified.rows, refused: classified.refused,
      kind: WORKBOOK_LOADER_KIND, status: "preview", createdAt: now.toISOString(),
      expiresAt: new Date(now.valueOf() + 24 * 3600000).toISOString(), catalogueDigest: classified.catalogueDigest,
      scopeDigest: classified.scopeDigest, summary: classified.summary};
    const [source] = await tx.insert(mrpSourcesTable).values({
      division: "Multi-competitor workbook imports", sheetId: "multi-competitor-workbooks",
      sheetUrl: "internal://multi-competitor-workbooks", sourceKind: "competitor",
      notes: "Grouped, selected-brand, multi-period workbooks; immutable previews and reversible append-only applies.",
    }).onConflictDoUpdate({target: mrpSourcesTable.sheetId, set: {sourceKind: "competitor"}}).returning();
    const [batch] = await tx.insert(mrpLoadBatchesTable).values({sourceId: source!.id, fileName,
      fileSha256: parsed.fileSha256, fileSizeBytes: buffer.length, downloadedAt: null,
      loadedBy: actor, rowCount: 0, notes: JSON.stringify(metadata)}).returning();
    return workbookBatchDetail(batch!);
  });
}
export async function applyWorkbook(id: number, buffer: Buffer, fingerprint: string, actor: string) {
  return db.transaction(async tx => {
    const [batch] = await tx.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, id)).for("update");
    if (!batch) throw new WorkbookLoadError("Batch not found.", 404);
    const m = readMetadata(batch.notes);
    assertWorkbookScope(m.brands);
    await locks(tx, m.brands);
    if (m.status !== "preview") throw new WorkbookLoadError("Batch already applied or undone; replay refused.");
    if (Date.parse(m.expiresAt) <= Date.now()) throw new WorkbookLoadError("Preview expired; preview the workbook again.");
    const parsed = parseMultiCompetitorWorkbook(buffer, m.brands, await storedNames(tx));
    if (fingerprint !== m.contentFingerprint || parsed.contentFingerprint !== m.contentFingerprint || parsed.fileSha256 !== m.fileSha256) {
      throw new WorkbookLoadError("File differs from the immutable preview; no prices written.");
    }
    const c = await classify(tx, parsed);
    if (c.catalogueDigest !== m.catalogueDigest || c.scopeDigest !== m.scopeDigest ||
      stable(c.rows) !== stable(m.rows) || stable(c.summary) !== stable(m.summary) || stable(c.brands) !== stable(m.brands)) {
      throw new WorkbookLoadError("Catalogue, brand spelling or selected prices changed after preview; preview again.");
    }
    if (m.blockers.length || c.summary.conflicts) throw new WorkbookLoadError("Resolve preview blockers/conflicts before applying.");
    if (!c.insertRows.length) throw new WorkbookLoadError("No new rows to apply. Existing identical prices are not rewritten.");
    const inserted = await tx.execute<{id: number}>(sql`INSERT INTO competitor_prices
      (competitor,category,description,size,price,unit,competitor_code,code_source,effective_date,
       matched_prayag_code,match_status,match_confidence,is_current,price_basis,gst_pct,load_batch_id)
      SELECT r.competitor,p.category,p.product_name,p.size,r.price,r.unit,r."competitorCode",'unverified',r."effectiveDate",
        p.item_code,'matched','High',false,'MRP',18,${id}
      FROM jsonb_to_recordset(${JSON.stringify(c.insertRows)}::jsonb) AS r(competitor text,"prayagCode" text,
        "competitorCode" text,price float8,unit text,"effectiveDate" date)
      JOIN catalog_products p ON p.item_code=r."prayagCode"
      WHERE r.competitor = ANY(${arrayParam(m.brands)}) AND r.competitor <> ALL(${arrayParam(PROTECTED_WORKBOOK_BRANDS)}) RETURNING id`);
    if (inserted.rows.length !== c.insertRows.length) throw new WorkbookLoadError("Scoped insert count mismatch; entire batch rolled back.");
    const affected = [...new Set(c.insertRows.map(r => r.prayagCode))];
    await tx.execute(sql`UPDATE competitor_prices c SET is_current = coalesce(
      (c.effective_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND c.id = (
        SELECT q.id FROM competitor_prices q WHERE q.competitor=c.competitor AND q.matched_prayag_code=c.matched_prayag_code
          AND q.effective_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY q.effective_date DESC,q.id DESC LIMIT 1)),false)
      WHERE c.competitor = ANY(${arrayParam(m.brands)}) AND c.competitor <> ALL(${arrayParam(PROTECTED_WORKBOOK_BRANDS)})
        AND c.matched_prayag_code = ANY(${arrayParam(affected)})`);
    const after = await snapshot(tx, m.brands);
    const applied: Metadata = {...m, status: "applied", appliedAt: new Date().toISOString(), appliedBy: actor,
      before_snapshot: c.before, after_snapshot: after};
    const [updated] = await tx.update(mrpLoadBatchesTable).set({rowCount: inserted.rows.length, loadedBy: actor,
      loadedAt: new Date(), notes: JSON.stringify(applied)}).where(eq(mrpLoadBatchesTable.id, id)).returning();
    return workbookBatchDetail(updated!);
  });
}
export async function undoWorkbook(id: number, reason: string, actor: string) {
  if (!reason.trim() || reason.length > 1000) throw new WorkbookLoadError("An undo reason (1–1000 characters) is required.", 400);
  return db.transaction(async tx => {
    const [batch] = await tx.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, id)).for("update");
    if (!batch) throw new WorkbookLoadError("Batch not found.", 404);
    const m = readMetadata(batch.notes);
    assertWorkbookScope(m.brands);
    await locks(tx, m.brands);
    if (m.status !== "applied" || !m.after_snapshot || !m.before_snapshot) throw new WorkbookLoadError("Batch is not undoable.");
    if (stable(await snapshot(tx, m.brands)) !== stable(m.after_snapshot)) {
      throw new WorkbookLoadError("Selected brand rows changed since apply; undo would overwrite later work and is refused.");
    }
    const unrelated = await tx.execute(sql`SELECT id FROM mrp_price_history WHERE load_batch_id=${id} LIMIT 1`);
    const unsafe = await tx.execute(sql`SELECT id FROM competitor_prices WHERE load_batch_id=${id}
      AND (competitor <> ALL(${arrayParam(m.brands)}) OR competitor = ANY(${arrayParam(PROTECTED_WORKBOOK_BRANDS)})) LIMIT 1`);
    if (unrelated.rows.length || unsafe.rows.length) throw new WorkbookLoadError("Batch has unrelated references; undo refused.");
    const removed = await tx.execute(sql`DELETE FROM competitor_prices WHERE load_batch_id=${id}
      AND competitor = ANY(${arrayParam(m.brands)}) AND competitor <> ALL(${arrayParam(PROTECTED_WORKBOOK_BRANDS)}) RETURNING id`);
    if (removed.rows.length !== batch.rowCount) throw new WorkbookLoadError("Undo count mismatch; transaction rolled back.");
    if (m.before_snapshot.length) await tx.execute(sql`UPDATE competitor_prices c SET is_current=r.is_current
      FROM jsonb_to_recordset(${JSON.stringify(m.before_snapshot)}::jsonb) AS r(id integer,is_current boolean)
      WHERE c.id=r.id AND c.competitor = ANY(${arrayParam(m.brands)}) AND c.competitor <> ALL(${arrayParam(PROTECTED_WORKBOOK_BRANDS)})
        AND c.is_current IS DISTINCT FROM r.is_current`);
    if (stable(await snapshot(tx, m.brands)) !== stable(m.before_snapshot)) throw new WorkbookLoadError("Undo restoration mismatch; rolled back.");
    const undone: Metadata = {...m, status: "undone", undoneAt: new Date().toISOString(), undoneBy: actor, undoReason: reason.trim()};
    const [updated] = await tx.update(mrpLoadBatchesTable).set({notes: JSON.stringify(undone)})
      .where(and(eq(mrpLoadBatchesTable.id, id))).returning();
    return workbookBatchDetail(updated!);
  });
}
