import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  catalogProductsTable,
  competitorPriceStagingTable,
  competitorPricesTable,
  db,
  importBatchesTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import importBatchesRouter from "./importBatches.js";
import apolloStagedLoadRouter, { createApolloStagedLoadRouter } from "./apolloStagedLoad.js";
import { parseApolloMaster } from "../lib/apolloMaster.js";
import { apolloContentFingerprint, APOLLO_TRUSTED_CONTENT_FINGERPRINT } from "../lib/apolloContentFingerprint.js";

const workbookPath = fileURLToPath(new URL(
  "../../../../attached_assets/Competitor_Master_-_Plumbing_Apollo_1790252780224.xlsx",
  import.meta.url,
));
const originalWorkbook = readFileSync(workbookPath);

function authenticatedAdminApp(router = createApolloStagedLoadRouter([APOLLO_TRUSTED_CONTENT_FINGERPRINT])) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: "apollo-step2-admin",
      email: "apollo-step2-admin@example.test",
      role: "admin",
      mustChangePassword: false,
    } as typeof req.user;
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });
  app.use("/api", importBatchesRouter, router);
  return app;
}

function withPriceChanged(input: Buffer, sourceSheet: string, sourceRow: number, expectedPrice: number): Buffer {
  const workbook = XLSX.read(input, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[sourceSheet];
  if (!sheet) throw new Error(`Original Apollo sheet is missing: ${sourceSheet}`);
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null }) as unknown[][];
  const group = (values[0] ?? []).map(value => String(value ?? "").trim());
  const headers = (values[1] ?? []).map(value => String(value ?? "").trim());
  const apolloStarts = group.map((value, index) => /^apollo$/i.test(value) ? index : -1).filter(index => index >= 0);
  if (!apolloStarts.length) throw new Error(`Apollo header group is missing on ${sourceSheet}`);
  const start = apolloStarts[0]!;
  const end = apolloStarts[1] ?? group.length;
  const apolloHeaders = headers.slice(start, end);
  const codeOffset = apolloHeaders.findIndex(value => /^item code$/i.test(value));
  const priceOffset = apolloHeaders[codeOffset + 1] && /mrp\s*\(/i.test(apolloHeaders[codeOffset + 1]!)
    ? codeOffset + 2
    : apolloHeaders.findIndex((value, index) => index > codeOffset &&
      (/mrp|price|net|date/i.test(value) || /^\d{1,2}\s+[a-z]{3}/i.test(value) || /^\d{5}$/.test(value)));
  if (codeOffset < 0 || priceOffset < 0) throw new Error(`Apollo price column is missing on ${sourceSheet}`);
  const address = XLSX.utils.encode_cell({ r: sourceRow - 1, c: start + priceOffset });
  const cell = sheet[address];
  if (!cell || Number(cell.v) !== expectedPrice) {
    throw new Error(`Expected ${expectedPrice} at ${sourceSheet}!${address}, found ${String(cell?.v)}`);
  }
  sheet[address] = { ...cell, t: "n", v: expectedPrice + 1 };
  delete sheet[address]!.w;
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

async function apolloRows() {
  return db.select().from(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, "Apollo"))
    .orderBy(competitorPricesTable.id);
}

async function selectTestDate(): Promise<string> {
  const rows = await apolloRows();
  const batches = await db.select({ effectiveDate: importBatchesTable.effectiveDate })
    .from(importBatchesTable)
    .where(eq(importBatchesTable.competitor, "Apollo"));
  const used = new Set([
    ...rows.map(row => row.effectiveDate).filter((date): date is string => Boolean(date)),
    ...batches.map(batch => batch.effectiveDate),
  ]);
  for (let day = 0; day < 36525; day++) {
    const candidate = new Date(Date.UTC(1970, 0, 1 + day)).toISOString().slice(0, 10);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Could not find an unused historical Apollo effectiveDate");
}

describe("P047 Step 2 Apollo staged-load lifecycle", () => {
  it("accepts only explicit test fingerprints and applies, updates, conflicts, then undoes atomically", async () => {
    const parsedOriginal = parseApolloMaster(originalWorkbook);
    expect(parsedOriginal.rows).toHaveLength(698);
    const originalFingerprint = apolloContentFingerprint(parsedOriginal.rows);
    expect(originalFingerprint).toBe(APOLLO_TRUSTED_CONTENT_FINGERPRINT);

    const target = parsedOriginal.rows.find(row => row.competitorCode === "APU001");
    expect(target).toBeDefined();
    expect(target!.category).toBe("UPVC PIPE");
    expect(target!.competitorCode).toBe("APU001");
    expect(target!.price).toBe(324);
    expect(target!.codeSource).toBe("locally_assigned");
    expect(parsedOriginal.conflicts.some(conflict => conflict.competitorCode === target!.competitorCode)).toBe(false);
    const changedWorkbook = withPriceChanged(originalWorkbook, target!.sheet, target!.sourceRow, 324);
    const parsedChanged = parseApolloMaster(changedWorkbook);
    expect(parsedChanged.rows).toHaveLength(698);
    expect(parsedChanged.rows.find(row => row.competitorCode === target!.competitorCode)?.price).toBe(325);
    const changedFingerprint = apolloContentFingerprint(parsedChanged.rows);
    expect(changedFingerprint).not.toBe(originalFingerprint);
    const originalBySource = new Map(parsedOriginal.rows.map(row => [`${row.sheet}:${row.sourceRow}`, row]));
    for (const changedRow of parsedChanged.rows) {
      const originalRow = originalBySource.get(`${changedRow.sheet}:${changedRow.sourceRow}`);
      expect(originalRow).toBeDefined();
      expect(changedRow).toEqual(changedRow.competitorCode === target!.competitorCode
        ? { ...originalRow!, price: 325 }
        : originalRow);
    }

    const app = authenticatedAdminApp(createApolloStagedLoadRouter([originalFingerprint, changedFingerprint]));
    const productionApp = authenticatedAdminApp(apolloStagedLoadRouter);
    const api = supertest(app);
    const date = await selectTestDate();
    const baselineApollo = await apolloRows();
    const baselineProducts = await db.select().from(catalogProductsTable).orderBy(catalogProductsTable.id);
    const baselineMrpHistory = await db.select().from(mrpPriceHistoryTable).orderBy(mrpPriceHistoryTable.id);
    const latestByMapping = new Map<string, (typeof baselineApollo)[number]>();
    const latestUnmatchedDate = baselineApollo
      .filter(row => !row.matchedPrayagCode && row.effectiveDate && row.effectiveDate <= new Date().toISOString().slice(0, 10))
      .reduce<string | null>((latest, row) => !latest || row.effectiveDate! > latest ? row.effectiveDate! : latest, null);
    for (const row of baselineApollo) {
      if (!row.matchedPrayagCode || !row.effectiveDate || row.effectiveDate > new Date().toISOString().slice(0, 10)) continue;
      const key = row.matchedPrayagCode;
      const previous = latestByMapping.get(key);
      if (!previous || row.effectiveDate > previous.effectiveDate! ||
          (row.effectiveDate === previous.effectiveDate && row.id > previous.id)) latestByMapping.set(key, row);
    }
    for (const row of baselineApollo) {
      const expectedCurrent = row.matchedPrayagCode
        ? latestByMapping.get(row.matchedPrayagCode)?.id === row.id
        : Boolean(latestUnmatchedDate && row.effectiveDate === latestUnmatchedDate &&
          row.effectiveDate <= new Date().toISOString().slice(0, 10));
      expect(row.isCurrent, `Apollo row ${row.id} must already have its derived current flag`).toBe(expectedCurrent);
    }
    const baselineCounts = {
      apolloRows: baselineApollo.length,
      products: baselineProducts.length,
      mrpHistoryRows: baselineMrpHistory.length,
    };
    const batchIds: number[] = [];
    let batchA: number | null = null;
    let batchB: number | null = null;
    let liveAfterA: Awaited<ReturnType<typeof apolloRows>> | null = null;
    let liveAfterB: Awaited<ReturnType<typeof apolloRows>> | null = null;

    try {
      expect(baselineApollo.some(row => row.effectiveDate === date)).toBe(false);

      const productionReject = await supertest(productionApp)
        .post("/api/catalog/apollo-load/preview")
        .field("effectiveDate", date)
        .field("reason", "P047 Step 2 test fingerprint rejection")
        .attach("file", changedWorkbook, "apollo-modified.xlsx");
      expect(productionReject.status).toBe(422);
      expect(productionReject.body.code).toBe("APOLLO_CONTENT_FINGERPRINT_MISMATCH");
      expect(productionReject.body.contentFingerprint).toBe(changedFingerprint);

      const previewA = await api.post("/api/catalog/apollo-load/preview")
        .field("effectiveDate", date)
        .field("reason", "P047 Step 2 baseline lifecycle test")
        .attach("file", originalWorkbook, "apollo-original.xlsx");
      expect(previewA.status).toBe(200);
      batchA = previewA.body.batchId;
      batchIds.push(batchA!);
      expect(previewA.body.summary).toMatchObject({ total: 698, accepted: 691, held: 7, create: 691, update: 0, unchanged: 0 });
      expect(previewA.body.contentFingerprint).toBe(originalFingerprint);

      const appliedA = await api.post(`/api/catalog/apollo-load/${batchA}/apply`)
        .send({ contentFingerprint: originalFingerprint });
      expect(appliedA.status).toBe(200);
      expect(appliedA.body).toMatchObject({ created: 691, updated: 0, unchanged: 0 });
      liveAfterA = await apolloRows();
      const rowsForDateA = liveAfterA.filter(row => row.effectiveDate === date);
      expect(rowsForDateA).toHaveLength(691);
      const targetAfterA = rowsForDateA.find(row => row.competitorCode === target!.competitorCode);
      expect(targetAfterA).toBeDefined();
      expect(Number(targetAfterA!.price)).toBe(324);

      const previewB = await api.post("/api/catalog/apollo-load/preview")
        .field("effectiveDate", date)
        .field("reason", "P047 Step 2 single-price revision test")
        .attach("file", changedWorkbook, "apollo-one-price-revision.xlsx");
      expect(previewB.status).toBe(200);
      batchB = previewB.body.batchId;
      batchIds.push(batchB!);
      expect(previewB.body.contentFingerprint).toBe(changedFingerprint);
      expect(previewB.body.summary).toMatchObject({ total: 698, accepted: 691, held: 7, create: 0, update: 1, unchanged: 690 });

      const appliedB = await api.post(`/api/catalog/apollo-load/${batchB}/apply`)
        .send({ contentFingerprint: changedFingerprint });
      expect(appliedB.status).toBe(200);
      expect(appliedB.body).toMatchObject({ created: 0, updated: 1, unchanged: 690 });
      liveAfterB = await apolloRows();
      expect(liveAfterB).toHaveLength(liveAfterA.length);
      const targetAfterB = liveAfterB.find(row => row.id === targetAfterA!.id);
      expect(targetAfterB).toBeDefined();
      expect(Number(targetAfterB!.price)).toBe(325);
      expect(targetAfterB!.updatedAt).toBeDefined();
      expect(targetAfterB!.loadBatchId).not.toBe(targetAfterA!.loadBatchId);
      for (const rowA of liveAfterA) {
        if (rowA.id === targetAfterA!.id) continue;
        expect(liveAfterB.find(row => row.id === rowA.id)).toEqual(rowA);
      }

      const beforeConflictingUndo = await apolloRows();
      const rejectedUndoA = await api.post(`/api/catalog/apollo-load/${batchA}/undo`)
        .send({ reason: "P047 Step 2 expected stale snapshot conflict" });
      expect(rejectedUndoA.status).toBe(409);
      expect(rejectedUndoA.body).toMatchObject({
        code: "UNDO_CONFLICT",
        error: "Affected rows changed after apply",
      });
      const [stillApprovedA] = await db.select({ status: importBatchesTable.status })
        .from(importBatchesTable).where(eq(importBatchesTable.id, batchA!));
      expect(stillApprovedA?.status).toBe("approved");
      const afterConflictingUndo = await apolloRows();
      expect(afterConflictingUndo).toEqual(beforeConflictingUndo);
      expect(afterConflictingUndo).toHaveLength(liveAfterB.length);
      expect((await db.select().from(catalogProductsTable).orderBy(catalogProductsTable.id))).toEqual(baselineProducts);
      expect((await db.select().from(mrpPriceHistoryTable).orderBy(mrpPriceHistoryTable.id))).toEqual(baselineMrpHistory);

      const undoneB = await api.post(`/api/catalog/apollo-load/${batchB}/undo`)
        .send({ reason: "P047 Step 2 restore original price" });
      expect(undoneB.status).toBe(200);
      expect(undoneB.body).toMatchObject({ restored: 1, deleted: 0 });
      expect(await apolloRows()).toEqual(liveAfterA);

      const undoneA = await api.post(`/api/catalog/apollo-load/${batchA}/undo`)
        .send({ reason: "P047 Step 2 remove isolated historical test period" });
      expect(undoneA.status).toBe(200);
      expect(undoneA.body).toMatchObject({ restored: 0, deleted: 691 });
      expect(await apolloRows()).toEqual(baselineApollo);
      expect((await db.select().from(catalogProductsTable).orderBy(catalogProductsTable.id))).toEqual(baselineProducts);
      expect((await db.select().from(mrpPriceHistoryTable).orderBy(mrpPriceHistoryTable.id))).toEqual(baselineMrpHistory);

      const closingCounts = {
        apolloRows: (await apolloRows()).length,
        products: (await db.select({ id: catalogProductsTable.id }).from(catalogProductsTable)).length,
        mrpHistoryRows: (await db.select({ id: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable)).length,
      };
      expect(closingCounts).toEqual(baselineCounts);
    } finally {
      const cleanupFailures: string[] = [];
      let safeToUndoEarlierApprovedBatch = true;
      for (const id of [batchB, batchA].filter((value): value is number => value !== null)) {
        try {
          const [batch] = await db.select({ status: importBatchesTable.status })
            .from(importBatchesTable).where(eq(importBatchesTable.id, id));
          if (!batch) {
            cleanupFailures.push(`batch ${id}: batch record is missing during undo cleanup`);
            safeToUndoEarlierApprovedBatch = false;
            continue;
          }
          if (batch?.status !== "approved") continue;
          if (!safeToUndoEarlierApprovedBatch) {
            cleanupFailures.push(`batch ${id}: not undone because a later approved batch could not be undone`);
            continue;
          }
          const undo = await api.post(`/api/catalog/apollo-load/${id}/undo`)
            .send({ reason: "P047 Step 2 automatic integration-test cleanup" });
          if (undo.status !== 200) {
            cleanupFailures.push(`batch ${id}: undo returned ${undo.status} ${JSON.stringify(undo.body)}`);
            safeToUndoEarlierApprovedBatch = false;
          }
        } catch (error) {
          cleanupFailures.push(`batch ${id}: undo cleanup raised ${error instanceof Error ? error.message : String(error)}`);
          safeToUndoEarlierApprovedBatch = false;
        }
      }
      for (const id of batchIds) {
        try {
          const [batch] = await db.select({ status: importBatchesTable.status })
            .from(importBatchesTable).where(eq(importBatchesTable.id, id));
          if (!batch) {
            cleanupFailures.push(`batch ${id}: batch record is missing during staging cleanup`);
            continue;
          }
          if (batch.status === "approved") continue;
          const deletion = await api.delete(`/api/catalog/import-batches/${id}`);
          if (deletion.status !== 200) cleanupFailures.push(`batch ${id}: staging cleanup returned ${deletion.status} ${JSON.stringify(deletion.body)}`);
          const remaining = await db.select({ id: competitorPriceStagingTable.id })
            .from(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, id));
          if (remaining.length) cleanupFailures.push(`batch ${id}: ${remaining.length} staging rows remain`);
        } catch (error) {
          cleanupFailures.push(`batch ${id}: staging cleanup raised ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (cleanupFailures.length) {
        throw new Error(`Apollo Step 2 cleanup failed for batch IDs [${batchIds.join(", ")}]: ${cleanupFailures.join("; ")}`);
      }
    }
  }, 240_000);

});