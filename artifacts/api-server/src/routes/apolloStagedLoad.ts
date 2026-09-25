import { Router, type IRouter } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, catalogProductsTable, competitorPricesTable, competitorPriceStagingTable, importBatchesTable, mrpLoadBatchesTable, mrpSourcesTable, apolloReservationsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";
import { parseApolloMaster, type ApolloMasterRow } from "../lib/apolloMaster";
import { apolloContentFingerprint, APOLLO_TRUSTED_CONTENT_FINGERPRINT } from "../lib/apolloContentFingerprint";
import { getComparisonEvidence } from "../lib/comparisonEvidenceRegistry";
import { recomputeCompetitorCurrentFlagsInTransaction } from "../lib/catalog";
import { normCode } from "../lib/catalog";
import { apolloPipeIdentityV2 } from "../lib/apolloPipeIdentity";
import { sha256ForBuffer, isIsoDate } from "../lib/mrpProvenance";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const APOLLO = "Apollo";
const lock = 917045;

export type ApolloCollisionRow = {
  competitor: string; competitorCode: string | null; codeSource: string | null;
  matchedPrayagCode: string | null; category: string | null; size: string | null;
};

/** Rejects a workbook code already owned by another mapping, while allowing
 * the same Apollo mapping to recur in another effective period. */
export function findApolloCodeCollision(incoming: ApolloMasterRow, existing: ApolloCollisionRow[]): ApolloCollisionRow | null {
  const code = normCode(incoming.competitorCode);
  const identity = incoming.codeSource === "locally_assigned"
    ? apolloPipeIdentityV2(incoming.category, incoming.prayagCode, incoming.size) : null;
  return existing.find(row => normCode(row.competitorCode) === code && !(
    row.competitor === APOLLO &&
    row.codeSource === incoming.codeSource &&
    (incoming.codeSource === "locally_assigned"
      ? apolloPipeIdentityV2(row.category, row.matchedPrayagCode, row.size) === identity
      : normCode(row.matchedPrayagCode) === normCode(incoming.prayagCode))
  )) ?? null;
}

function jsonCounts(batch: any): any { try { return JSON.parse(batch.rowCounts ?? "{}"); } catch { return {}; } }
function parseId(value: unknown): number | null { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
export function stagedRowsDigest(rows: readonly Record<string, unknown>[]): string {
  const records = rows.map(row => [
    row.competitorCodeMaster ?? "", row.competitorCodeCatalogue ?? "", row.matchedPrayagCode ?? "",
    row.codeSource ?? "", row.newMrp ?? "", row.status ?? "", row.reviewReason ?? "",
    row.description ?? "", row.catalogueDescription ?? "", row.variant ?? "", row.effectiveDate ?? "",
    row.discoveryEvidence ?? "",
  ].map(value => String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim()).join("|")).sort();
  return createHash("sha256").update(records.join("\n"), "utf8").digest("hex");
}

/**
 * Build the staged Apollo route set with an explicit content allowlist.
 * Production mounts the default router below, whose sole accepted fingerprint
 * is the fixed trusted master. Tests may construct an isolated app with
 * additional known fingerprints without changing the production instance.
 */
export function createApolloStagedLoadRouter(allowedFingerprints: readonly string[]): IRouter {
  const router: IRouter = Router();
  const allowlistedFingerprints = new Set(allowedFingerprints);

router.post("/catalog/apollo-load/preview", requireAdmin, upload.single("file"), async (req, res) => {
  const file = req.file;
  const effectiveDate = String(req.body?.effectiveDate ?? "").trim();
  const reason = String(req.body?.reason ?? "").trim();
  if (!file) { res.status(400).json({ error: "No workbook uploaded" }); return; }
  if (!isIsoDate(effectiveDate)) { res.status(400).json({ error: "effectiveDate must be a valid calendar date (YYYY-MM-DD)" }); return; }
  if (!reason) { res.status(400).json({ error: "reason is required" }); return; }
  let parsed;
  try { parsed = parseApolloMaster(file.buffer); } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : "Apollo workbook could not be parsed", noWrites: true }); return;
  }
  const fingerprint = apolloContentFingerprint(parsed.rows);
  if (!allowlistedFingerprints.has(fingerprint)) {
    res.status(422).json({ error: "Apollo workbook content is not the trusted development master", code: "APOLLO_CONTENT_FINGERPRINT_MISMATCH", contentFingerprint: fingerprint, noWrites: true }); return;
  }
  const catalogue = await db.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable);
  const codes = new Set(catalogue.map((x) => normCode(x.itemCode)));
  const conflictCodes = new Set(parsed.conflicts.map((x) => x.competitorCode.toUpperCase()));
  const before = await db.select().from(competitorPricesTable).where(eq(competitorPricesTable.competitor, APOLLO)).orderBy(competitorPricesTable.id);
  const periodBefore = before.filter(r => r.effectiveDate === effectiveDate);
  const canonical = new Map(catalogue.map(p => [normCode(p.itemCode), p.itemCode]));
  const allCompetitors = await db.select({
    competitor: competitorPricesTable.competitor, competitorCode: competitorPricesTable.competitorCode,
    codeSource: competitorPricesTable.codeSource, matchedPrayagCode: competitorPricesTable.matchedPrayagCode,
    category: competitorPricesTable.category, size: competitorPricesTable.size,
  }).from(competitorPricesTable);
  const rows = parsed.rows.map((sourceRow) => {
    const canonicalPrayag = sourceRow.prayagCode ? canonical.get(normCode(sourceRow.prayagCode)) ?? null : null;
    const identity = sourceRow.codeSource === "locally_assigned"
      ? apolloPipeIdentityV2(sourceRow.category, canonicalPrayag, sourceRow.size)
      : null;
    const sameIdentity = identity ? periodBefore.find(r =>
      r.codeSource === "locally_assigned" &&
      apolloPipeIdentityV2(r.category, r.matchedPrayagCode, r.size) === identity) : null;
    const row = canonicalPrayag && sameIdentity?.matchedPrayagCode
      ? { ...sourceRow, prayagCode: sameIdentity.matchedPrayagCode }
      : canonicalPrayag ? { ...sourceRow, prayagCode: canonicalPrayag } : sourceRow;
    const heldReason = conflictCodes.has(row.competitorCode.toUpperCase())
      ? "supplier price conflict requires review"
      : (!row.prayagCode || !codes.has(normCode(row.prayagCode)) ? "unmapped Prayag code" : null);
    const evidence = row.prayagCode ? getComparisonEvidence(APOLLO, row.competitorCode, row.prayagCode, effectiveDate) : null;
    // Evidence is durable context, not a rejection: all priced, mapped rows
    // remain eligible. Only the five unmapped rows and the two conflicting
    // PPRMB rows are held by the P047 contract.
    return { row, status: heldReason ? "needs_review" : "ok", reason: heldReason, evidence, rawPrayagCode: sourceRow.prayagCode };
  });
  const acceptedRows = rows.filter(x => x.status === "ok").map(x => x.row);
  const localKeys = new Set(acceptedRows.filter(x => x.codeSource === "locally_assigned").map(x => apolloPipeIdentityV2(x.category, x.prayagCode, x.size)));
  if (localKeys.size !== 272) { res.status(409).json({ error: `Apollo local identity validation failed: expected 272, found ${localKeys.size}`, code: "APOLLO_IDENTITY_VALIDATION_FAILED", noWrites: true }); return; }
  const prayagKeys = new Set<string>();
  for (const row of acceptedRows) {
    if (prayagKeys.has(normCode(row.prayagCode))) { res.status(409).json({ error: `Duplicate Apollo matched Prayag code ${row.prayagCode}`, code: "APOLLO_DUPLICATE_MAPPING", noWrites: true }); return; }
    prayagKeys.add(normCode(row.prayagCode));
    const collision = findApolloCodeCollision(row, allCompetitors);
    if (collision) { res.status(409).json({ error: `Apollo competitor code collision: ${row.competitorCode}`, code: "APOLLO_COMPETITOR_CODE_COLLISION", competitorCode: row.competitorCode, noWrites: true }); return; }
  }
  const beforeProducts = await db.select().from(catalogProductsTable)
    .where(sql`${catalogProductsTable.itemCode} IN (${sql.join([...new Set(parsed.rows.map(x => canonical.get(normCode(x.prayagCode)) ?? x.prayagCode).filter(Boolean))].map(code => sql`${code}`), sql`, `)})`)
    .orderBy(catalogProductsTable.itemCode);
  const workbookPrayagCodes = [...new Set(parsed.rows.map(x => canonical.get(normCode(x.prayagCode)) ?? x.prayagCode).filter(Boolean))];
  const stagedDigest = stagedRowsDigest(rows.map(({ row, status, reason, evidence, rawPrayagCode }) => ({
    competitorCodeMaster: row.competitorCode, competitorCodeCatalogue: row.competitorCode,
    matchedPrayagCode: row.prayagCode, codeSource: row.codeSource, newMrp: row.price,
    description: row.description, catalogueDescription: row.description, variant: row.size,
    status, reviewReason: reason, discoveryEvidence: JSON.stringify({ rawPrayagCode, evidence, category: row.category }),
    effectiveDate,
  })));
  const oldByIdentity = new Map(periodBefore.map(r => [`${r.matchedPrayagCode ?? ""}|${r.codeSource}|${normCode(r.competitorCode)}`, r]));
  const evidenceIssues = new Set(rows.filter(x => x.evidence && x.evidence.kind !== "not-verified").map(x => x.row.competitorCode.toUpperCase()));
  const counts = { total: parsed.rows.length, accepted: rows.filter(x => x.status === "ok").length, held: rows.filter(x => x.status !== "ok").length, local: rows.filter(x => x.status === "ok" && x.row.codeSource === "locally_assigned").length, supplier: rows.filter(x => x.status === "ok" && x.row.codeSource === "supplier").length, reviewIssues: evidenceIssues.size + (parsed.conflicts.length ? 1 : 0), notVerified: rows.filter(x => x.evidence?.kind === "not-verified").length,
    create: rows.filter(x => x.status === "ok" && !oldByIdentity.has(`${x.row.prayagCode ?? ""}|${x.row.codeSource}|${normCode(x.row.competitorCode)}`)).length,
    update: rows.filter(x => x.status === "ok" && oldByIdentity.has(`${x.row.prayagCode ?? ""}|${x.row.codeSource}|${normCode(x.row.competitorCode)}`) && oldByIdentity.get(`${x.row.prayagCode ?? ""}|${x.row.codeSource}|${normCode(x.row.competitorCode)}`)!.price !== x.row.price).length,
    unchanged: rows.filter(x => x.status === "ok" && oldByIdentity.get(`${x.row.prayagCode ?? ""}|${x.row.codeSource}|${normCode(x.row.competitorCode)}`)?.price === x.row.price).length };
  const batchRows = JSON.stringify({ ...counts, contentFingerprint: fingerprint, reason, beforeSnapshot: before, beforeProducts, workbookPrayagCodes, stagedDigest, reservations: parsed.reservations, insertedIds: [], updatedIds: [], createdAt: new Date().toISOString(), source: "apollo_staged_load", conflicts: parsed.conflicts, unpriced: parsed.unpriced, renames: parsed.renames });
  const batch = await db.transaction(async (tx) => {
    const source = (await tx.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq(mrpSourcesTable.division, "Apollo")).limit(1))[0]
      ?? (await tx.insert(mrpSourcesTable).values({ division: "Apollo", sheetId: "apollo-master", sheetUrl: "internal://apollo-master", expectedFileName: file.originalname, notes: "Development-only staged Apollo competitor loads", sourceKind: "competitor" }).returning({ id: mrpSourcesTable.id }))[0]!;
    const [load] = await tx.insert(mrpLoadBatchesTable).values({
      sourceId: source.id, fileName: file.originalname, fileSha256: sha256ForBuffer(file.buffer),
      fileSizeBytes: file.size, loadedBy: req.user?.email ?? req.user?.id ?? null,
      rowCount: rows.length, notes: `Apollo staged preview: ${reason}`,
    }).returning({ id: mrpLoadBatchesTable.id });
    const [createdBatch] = await tx.insert(importBatchesTable).values({
      competitor: APOLLO, effectiveDate, sourceFileName: file.originalname, status: "pending", priceBasis: "MRP",
      rowCounts: batchRows, fileSha256: sha256ForBuffer(file.buffer), fileSizeBytes: file.size, loadBatchId: load!.id,
    }).returning({ id: importBatchesTable.id });
    await tx.insert(competitorPriceStagingTable).values(rows.map(({ row, status, reason, evidence, rawPrayagCode }) => ({
    batchId: createdBatch!.id, competitor: APOLLO, effectiveDate, competitorCodeMaster: row.competitorCode,
    competitorCodeCatalogue: row.competitorCode, codeSource: row.codeSource, matchedPrayagCode: row.prayagCode,
    description: row.description, catalogueDescription: row.description, variant: row.size,
    oldMrp: oldByIdentity.get(`${row.prayagCode ?? ""}|${row.codeSource}|${normCode(row.competitorCode)}`)?.price ?? null,
    newMrp: row.price,
    status, reviewReason: reason, discoveryEvidence: JSON.stringify({ rawPrayagCode, evidence, category: row.category }), matchMethod: "code+desc",
    })));
    return createdBatch;
  });
  const response = { batchId: batch!.id, contentFingerprint: fingerprint, summary: counts, rows: rows.map(x => ({ ...x.row, oldPrice: oldByIdentity.get(`${x.row.prayagCode ?? ""}|${x.row.codeSource}|${normCode(x.row.competitorCode)}`)?.price ?? null, newPrice: x.row.price, status: x.status, reason: x.reason, evidence: x.evidence })), undoWindowHours: 24 };
  res.json(response);
});

router.get("/catalog/apollo-load/:batchId", requireAdmin, async (req, res) => {
  const id = parseId(req.params.batchId); if (!id) { res.status(400).json({ error: "Invalid batchId" }); return; }
  const [batch] = await db.select().from(importBatchesTable).where(eq(importBatchesTable.id, id));
  if (!batch || batch.competitor !== APOLLO) { res.status(404).json({ error: "Not found" }); return; }
  const staged = await db.select().from(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, id));
  const counts = jsonCounts(batch);
  res.json({ batchId: id, status: batch.status, contentFingerprint: counts.contentFingerprint, summary: counts, rows: staged.map(row => ({
    competitorCode: row.competitorCodeMaster ?? row.competitorCodeCatalogue,
    prayagCode: row.matchedPrayagCode, description: row.catalogueDescription ?? row.description,
    size: row.variant, codeSource: row.codeSource, oldPrice: row.oldMrp, newPrice: row.newMrp,
    status: row.status, reason: row.reviewReason,
    evidence: row.discoveryEvidence ? (() => { try { const parsed = JSON.parse(row.discoveryEvidence!); return parsed.evidence ?? parsed; } catch { return null; } })() : null,
  })), undoWindowHours: 24 });
});

router.post("/catalog/apollo-load/:batchId/apply", requireAdmin, async (req, res) => {
  const id = parseId(req.params.batchId); if (!id) { res.status(400).json({ error: "Invalid batchId" }); return; }
  const [batch] = await db.select().from(importBatchesTable).where(eq(importBatchesTable.id, id));
  if (!batch || batch.competitor !== APOLLO) { res.status(404).json({ error: "Not found" }); return; }
  const counts = jsonCounts(batch);
  if (String(req.body?.contentFingerprint ?? "") !== counts.contentFingerprint) { res.status(409).json({ error: "Content fingerprint does not match immutable preview", code: "STALE_PREVIEW" }); return; }
  if (batch.status === "approved") { res.json({ batchId: id, created: 0, updated: 0, unchanged: counts.unchanged ?? counts.accepted }); return; }
  let created = 0, updated = 0, unchanged = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lock})`);
    const [lockedBatch] = await tx.select({ status: importBatchesTable.status, rowCounts: importBatchesTable.rowCounts, effectiveDate: importBatchesTable.effectiveDate, loadBatchId: importBatchesTable.loadBatchId, sourceFileName: importBatchesTable.sourceFileName })
      .from(importBatchesTable).where(eq(importBatchesTable.id, id));
    const immutableCounts = jsonCounts(lockedBatch);
    if (!lockedBatch || lockedBatch.status !== "pending") {
      if (lockedBatch?.status === "approved") { created = 0; updated = 0; unchanged = immutableCounts.unchanged ?? immutableCounts.accepted; return; }
      throw Object.assign(new Error("Batch is no longer pending"), { httpStatus: 409 });
    }
    const staging = await tx.select().from(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, id));
    const currentStagedDigest = stagedRowsDigest(staging as unknown as Array<Record<string, unknown>>);
    if (currentStagedDigest !== immutableCounts.stagedDigest) throw Object.assign(new Error("Staging rows changed after preview"), { httpStatus: 409 });
    if (!lockedBatch.loadBatchId) throw Object.assign(new Error("Apollo batch has no provenance loadBatchId"), { httpStatus: 409 });
    const [provenance] = await tx.select({ id: mrpLoadBatchesTable.id, sourceId: mrpLoadBatchesTable.sourceId })
      .from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, lockedBatch.loadBatchId));
    if (!provenance) throw Object.assign(new Error("Apollo provenance load batch is missing"), { httpStatus: 409 });
    const [provenanceSource] = await tx.select({ division: mrpSourcesTable.division })
      .from(mrpSourcesTable).where(eq(mrpSourcesTable.id, provenance.sourceId));
    if (!provenanceSource || normCode(provenanceSource.division) !== normCode(APOLLO)) throw Object.assign(new Error("Apollo provenance source is invalid"), { httpStatus: 409 });
    const accepted = staging.filter(r => r.status === "ok" && r.newMrp != null && r.matchedPrayagCode);
    await tx.execute(sql`SELECT id FROM competitor_prices WHERE competitor = ${APOLLO} FOR UPDATE`);
    const allLive = await tx.select().from(competitorPricesTable).where(eq(competitorPricesTable.competitor, APOLLO)).orderBy(competitorPricesTable.id);
    if (JSON.stringify(allLive) !== JSON.stringify(immutableCounts.beforeSnapshot ?? [])) throw Object.assign(new Error("Live catalogue changed since preview"), { httpStatus: 409 });
    const live = allLive.filter(r => r.effectiveDate === lockedBatch.effectiveDate);
    const productCodes = new Set((immutableCounts.workbookPrayagCodes ?? []).filter(Boolean));
    const products = productCodes.size
      ? await tx.select().from(catalogProductsTable).where(sql`${catalogProductsTable.itemCode} IN (${sql.join([...productCodes].map(code => sql`${code}`), sql`, `)})`).orderBy(catalogProductsTable.itemCode)
      : [];
    const expectedProducts = (immutableCounts.beforeProducts ?? []).filter((p: any) => productCodes.has(p.itemCode)).sort((a: any, b: any) => a.itemCode.localeCompare(b.itemCode));
    if (JSON.stringify(products) !== JSON.stringify(expectedProducts)) throw Object.assign(new Error("Product mapping changed since preview"), { httpStatus: 409 });
    const collisionRows = await tx.select({
      competitor: competitorPricesTable.competitor, competitorCode: competitorPricesTable.competitorCode,
      codeSource: competitorPricesTable.codeSource, matchedPrayagCode: competitorPricesTable.matchedPrayagCode,
      category: competitorPricesTable.category, size: competitorPricesTable.size,
    }).from(competitorPricesTable);
    for (const staged of accepted) {
      const incoming = {
        category: (() => { try { return JSON.parse(staged.discoveryEvidence ?? "{}").category ?? ""; } catch { return ""; } })(),
        description: staged.description ?? "", size: staged.variant,
        prayagCode: staged.matchedPrayagCode, competitorCode: staged.competitorCodeMaster ?? "",
        codeSource: staged.codeSource as "supplier" | "locally_assigned", price: staged.newMrp ?? 0,
        sheet: "", sourceRow: 0,
      };
      if (findApolloCodeCollision(incoming, collisionRows)) throw Object.assign(new Error(`Apollo competitor code collision: ${incoming.competitorCode}`), { httpStatus: 409 });
    }
    for (const staged of accepted) {
      const samePrayag = live.filter(row => row.matchedPrayagCode === staged.matchedPrayagCode);
      const incomingCode = normCode(staged.competitorCodeMaster);
      const incomingIdentity = staged.codeSource === "locally_assigned"
        ? apolloPipeIdentityV2((() => { try { return JSON.parse(staged.discoveryEvidence ?? "{}").category ?? ""; } catch { return ""; } })(), staged.matchedPrayagCode, staged.variant)
        : incomingCode;
      if (samePrayag.some(row => {
        const existingIdentity = row.codeSource === "locally_assigned"
          ? apolloPipeIdentityV2(row.category, row.matchedPrayagCode, row.size)
          : normCode(row.competitorCode);
        return existingIdentity !== incomingIdentity;
      })) throw Object.assign(new Error(`Apollo mapping identity changed for Prayag code ${staged.matchedPrayagCode}`), { httpStatus: 409 });
    }
    const reservationCodesCreated: string[] = [];
    for (const reservation of (immutableCounts.reservations ?? [])) {
      const existing = await tx.select({ ownerIdentity: apolloReservationsTable.ownerIdentity })
        .from(apolloReservationsTable).where(and(eq(apolloReservationsTable.competitor, APOLLO), eq(apolloReservationsTable.competitorCode, reservation.code))).limit(1);
      if (existing[0] && existing[0].ownerIdentity !== reservation.owner) throw Object.assign(new Error(`Apollo reserved code ${reservation.code} belongs to another identity`), { httpStatus: 409 });
      if (!existing[0]) {
        await tx.insert(apolloReservationsTable).values({ competitor: APOLLO, competitorCode: reservation.code, ownerIdentity: reservation.owner, prayagCode: reservation.prayagCode, sourceSheet: reservation.sourceSheet ?? "UGD PIPE", sourceRow: reservation.sourceRow ?? 0, sourceFileName: lockedBatch.sourceFileName });
        reservationCodesCreated.push(reservation.code);
      }
    }
    const beforeRows = allLive;
    const insertedIds: number[] = [], updatedIds: number[] = [];
    for (const r of accepted) {
      const prior = live.find(x => x.matchedPrayagCode === r.matchedPrayagCode);
      if (!prior) {
        const category = (() => { try { return JSON.parse(r.discoveryEvidence ?? "{}").category as string | undefined; } catch { return undefined; } })();
        if (!category) throw Object.assign(new Error(`Apollo category is missing for ${r.competitorCodeMaster}`), { httpStatus: 409 });
        const [newRow] = await tx.insert(competitorPricesTable).values({ competitor: APOLLO, category, description: r.description, size: r.variant, price: r.newMrp!, unit: "MRP", competitorCode: r.competitorCodeMaster, codeSource: r.codeSource, effectiveDate: lockedBatch.effectiveDate, matchedPrayagCode: r.matchedPrayagCode, matchStatus: "matched", matchConfidence: "High", priceBasis: "MRP", isCurrent: false, loadBatchId: lockedBatch.loadBatchId }).returning({ id: competitorPricesTable.id });
        insertedIds.push(newRow!.id); created++;
      } else if (prior.price !== r.newMrp) {
        await tx.update(competitorPricesTable).set({ price: r.newMrp!, loadBatchId: lockedBatch.loadBatchId, updatedAt: new Date() }).where(eq(competitorPricesTable.id, prior.id)); updatedIds.push(prior.id); updated++;
      } else unchanged++;
    }
    if (created || updated) await recomputeCompetitorCurrentFlagsInTransaction(APOLLO, tx);
    const afterSnapshot = await tx.select().from(competitorPricesTable).where(eq(competitorPricesTable.competitor, APOLLO)).orderBy(competitorPricesTable.id);
    await tx.update(importBatchesTable).set({ status: "approved", rowCounts: JSON.stringify({ ...immutableCounts, beforeSnapshot: beforeRows, insertedIds, updatedIds, created, updated, unchanged, afterSnapshot, reservationCodesCreated, appliedAt: new Date().toISOString() }) }).where(eq(importBatchesTable.id, id));
  }, { isolationLevel: "serializable" }).catch((e: any) => {
    if (e?.httpStatus === 409 || e?.code === "40001" || e?.code === "23505") { res.status(409).json({ error: e.message, code: e?.code === "23505" ? "CONCURRENT_RESERVATION" : "STALE_PREVIEW" }); return; }
    throw e;
  });
  if (res.headersSent) return;
  res.json({ batchId: id, created, updated, unchanged });
});

router.post("/catalog/apollo-load/:batchId/undo", requireAdmin, async (req, res) => {
  const id = parseId(req.params.batchId); if (!id) { res.status(400).json({ error: "Invalid batchId" }); return; }
  if (!String(req.body?.reason ?? "").trim()) { res.status(400).json({ error: "reason is required" }); return; }
  const [batch] = await db.select().from(importBatchesTable).where(eq(importBatchesTable.id, id));
  if (!batch || batch.competitor !== APOLLO) { res.status(404).json({ error: "Not found" }); return; }
  const counts = jsonCounts(batch); if (batch.status !== "approved") { res.status(409).json({ error: "Batch is not applied" }); return; }
  if (Date.now() - new Date(counts.appliedAt ?? batch.createdAt).getTime() > 24 * 3600000) { res.status(409).json({ error: "Undo window expired" }); return; }
  let restored = 0, deleted = 0;
  try {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lock})`);
    const [locked] = await tx.select({ status: importBatchesTable.status, rowCounts: importBatchesTable.rowCounts, createdAt: importBatchesTable.createdAt })
      .from(importBatchesTable).where(eq(importBatchesTable.id, id));
    if (!locked || locked.status !== "approved") throw Object.assign(new Error("Batch is no longer approved"), { httpStatus: 409 });
    const lockedCounts = jsonCounts(locked);
    if (Date.now() - new Date(lockedCounts.appliedAt ?? locked.createdAt).getTime() > 24 * 3600000) throw Object.assign(new Error("Undo window expired"), { httpStatus: 409 });
    await tx.execute(sql`SELECT id FROM competitor_prices WHERE competitor = ${APOLLO} FOR UPDATE`);
    const inserted = lockedCounts.insertedIds ?? [], updatedIds = lockedCounts.updatedIds ?? [];
    const live = await tx.select().from(competitorPricesTable).where(eq(competitorPricesTable.competitor, APOLLO)).orderBy(competitorPricesTable.id);
    const after = lockedCounts.afterSnapshot ?? [];
    if (JSON.stringify(live) !== JSON.stringify(after)) throw Object.assign(new Error("Affected rows changed after apply"), { httpStatus: 409 });
    const afterById = new Map<number, any>(after.map((row: any) => [row.id, row]));
    for (const row of (lockedCounts.beforeSnapshot ?? []) as any[]) {
      const afterRow = afterById.get(row.id);
      if (!afterRow) throw Object.assign(new Error("Previously existing Apollo row is missing"), { httpStatus: 409 });
      if (JSON.stringify(row) === JSON.stringify(afterRow)) continue;
      const { id: _id, createdAt: _createdAt, updatedAt: previousUpdatedAt, ...restore } = row;
      await tx.update(competitorPricesTable).set({
        ...restore,
        updatedAt: previousUpdatedAt ? new Date(previousUpdatedAt) : null,
      }).where(eq(competitorPricesTable.id, row.id));
      restored++;
    }
    for (const rowId of inserted as number[]) { await tx.delete(competitorPricesTable).where(eq(competitorPricesTable.id, rowId)); deleted++; }
    const createdReservationCodes: string[] = lockedCounts.reservationCodesCreated ?? [];
    for (const code of createdReservationCodes) {
        const remaining = await tx.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
          .where(and(eq(competitorPricesTable.competitor, APOLLO), eq(competitorPricesTable.competitorCode, code))).limit(1);
        if (remaining.length) throw Object.assign(new Error(`Cannot undo reservation ${code}: it is still in use`), { httpStatus: 409 });
        const reservation = (lockedCounts.reservations ?? []).find((candidate: any) => candidate.code === code);
        if (!reservation) throw Object.assign(new Error(`Reservation ${code} provenance is missing`), { httpStatus: 409 });
        await tx.delete(apolloReservationsTable).where(and(
          eq(apolloReservationsTable.competitor, APOLLO),
          eq(apolloReservationsTable.competitorCode, code),
          eq(apolloReservationsTable.ownerIdentity, reservation.owner),
        ));
    }
    await tx.update(importBatchesTable).set({ status: "discarded", rowCounts: JSON.stringify({ ...lockedCounts, undoneAt: new Date().toISOString(), undoReason: String(req.body.reason).trim() }) }).where(eq(importBatchesTable.id, id));
  }, { isolationLevel: "serializable" });
  } catch (e: any) {
    if (e?.httpStatus === 409 || e?.code === "40001" || e?.code === "23505") { res.status(409).json({ error: e.message, code: e?.code === "23505" ? "CONCURRENT_RESERVATION" : "UNDO_CONFLICT" }); return; }
    throw e;
  }
  res.json({ batchId: id, restored, deleted });
});

  return router;
}

const router = createApolloStagedLoadRouter([APOLLO_TRUSTED_CONTENT_FINGERPRINT]);
export default router;