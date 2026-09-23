import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import {
  competitorMappingDecisionsTable,
  competitorPricesTable,
  competitorPriceStagingTable,
  db,
  importBatchesTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpRevisionBatchesTable,
  mrpRevisionRowsTable,
} from "@workspace/db";
import routes from "./index";

const request = supertest(
  express()
    .use(express.json())
    .use((req, _res, next) => {
      req.user = { id: "p034r2-test", email: "p034r2-test@example.test", mustChangePassword: false, role: "admin" };
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    })
    .use(routes),
);
let batchId = 0;
const createdBatchIds = new Set<number>();

describe("P034r2 competitor mapping decision flow", () => {
  it("rejects non-admin access and previews the reversed A-464 target", async () => {
    const anonymous = await supertest(express().use(express.json()).use((req, _res, next) => {
      req.isAuthenticated = (() => false) as typeof req.isAuthenticated;
      next();
    }).use(routes))
      .post("/catalog/competitor-mapping-decisions/p034r2/preview");
    expect(anonymous.status).toBe(401);
    const normalUser = await supertest(express().use(express.json()).use((req, _res, next) => {
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      req.user = { id: "p034r2-user", email: "p034r2-user@example.test", mustChangePassword: false, role: "user" };
      next();
    }).use(routes)).post("/catalog/competitor-mapping-decisions/p034r2/preview");
    expect(normalUser.status).toBe(403);

    const preview = await request.post("/catalog/competitor-mapping-decisions/p034r2/preview");
    if (preview.body.batchId) createdBatchIds.add(preview.body.batchId);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      promptVersion: "P034r2",
      deletionTarget: "SIM100150 → A-464",
      rowsChanged: expect.any(Number),
      decisionsToCreate: 5,
    });
    expect(preview.body.deletionTarget).not.toContain("A-414");
    batchId = preview.body.batchId;
  });

  it("atomically applies and rolls back exactly one mapping plus five decisions", async () => {
    const beforeMrp = await db.select({ id: mrpPriceHistoryTable.id, mrp: mrpPriceHistoryTable.mrp })
      .from(mrpPriceHistoryTable);
    const beforeKept = await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, "Prince"),
      eq(competitorPricesTable.competitorCode, "SIM100150"),
      eq(competitorPricesTable.matchedPrayagCode, "A-414"),
    ));
    const beforeSwr = await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, "Prince"),
      eq(competitorPricesTable.competitorCode, "SIM103500"),
    ));
    const beforeSwr2 = await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, "Prince"),
      eq(competitorPricesTable.competitorCode, "SIM103501"),
    ));
    expect((await request.post(`/catalog/mrp-revisions/${batchId}/apply`)).status).toBe(409);
    const applied = await request.post(`/catalog/competitor-mapping-decisions/p034r2/${batchId}/apply`);
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ status: "applied", decisionsCreated: 5 });
    expect(applied.body.deleted).toContain("SIM100150 → A-464");
    expect(await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitorCode, "SIM100150"),
      eq(competitorPricesTable.matchedPrayagCode, "A-464"),
    ))).toHaveLength(0);
    expect(await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitorCode, "SIM100150"),
      eq(competitorPricesTable.matchedPrayagCode, "A-414"),
    ))).toEqual(beforeKept);
    expect(await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitorCode, "SIM103500"),
    ))).toEqual(beforeSwr);
    expect(await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitorCode, "SIM103501"),
    ))).toEqual(beforeSwr2);
    expect(await db.select().from(competitorMappingDecisionsTable).where(eq(competitorMappingDecisionsTable.batchId, batchId))).toHaveLength(5);
    const afterMrp = await db.select({ id: mrpPriceHistoryTable.id, mrp: mrpPriceHistoryTable.mrp }).from(mrpPriceHistoryTable);
    expect(afterMrp).toEqual(beforeMrp);

    const rolledBack = await request.post(`/catalog/competitor-mapping-decisions/p034r2/${batchId}/rollback`);
    expect(rolledBack.status).toBe(200);
    expect(await db.select().from(competitorMappingDecisionsTable).where(eq(competitorMappingDecisionsTable.batchId, batchId))).toHaveLength(0);
    expect(await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitorCode, "SIM100150"),
      eq(competitorPricesTable.matchedPrayagCode, "A-464"),
    ))).toHaveLength(1);
  });

  it("rejects a stale non-price-field mutation before allowing a restored preview", async () => {
    const preview = await request.post("/catalog/competitor-mapping-decisions/p034r2/preview");
    if (preview.body.batchId) createdBatchIds.add(preview.body.batchId);
    expect(preview.status).toBe(200);
    batchId = preview.body.batchId;
    const [target] = await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitorCode, "SIM100150"),
      eq(competitorPricesTable.matchedPrayagCode, "A-464"),
    ));
    expect(target).toBeTruthy();
    try {
      await db.update(competitorPricesTable).set({ description: "P034r2 stale test" }).where(eq(competitorPricesTable.id, target!.id));
      const stale = await request.post(`/catalog/competitor-mapping-decisions/p034r2/${batchId}/apply`);
      expect(stale.status).toBe(409);
    } finally {
      await db.update(competitorPricesTable).set({ description: target!.description }).where(eq(competitorPricesTable.id, target!.id));
    }
    expect((await request.post(`/catalog/competitor-mapping-decisions/p034r2/${batchId}/apply`)).status).toBe(200);
    expect((await request.post(`/catalog/competitor-mapping-decisions/p034r2/${batchId}/rollback`)).status).toBe(200);
  });

  it("reports decisions on same-hash trusted loads and does not reuse a changed hash", async () => {
    const temporary = [
      ["SIM200032", "A-86B", "exclusion"],
      ["SIM200032", "A-86A", "exclusion"],
      ["SIM100150", "A-464", "exclusion"],
      ["SIM103500", "*", "confirmation"],
      ["SIM103501", "*", "confirmation"],
    ] as const;
    try {
      await db.insert(competitorMappingDecisionsTable).values(temporary.map(([competitorCode, prayagCode, decision]) => ({
        competitor: "Prince", competitorCode, prayagCode, decision,
        reason: "isolated trusted-loader test", promptVersion: "TEST",
      })));
      const workbook = readFileSync(new URL("../../../../attached_assets/Competitor_Master_-_Plumbing_Prince_1790080853652.xlsx", import.meta.url));
      const sameHash = await request.post("/catalog/stage-competitor-workbook")
        .field("competitor", "Prince")
        .attach("file", workbook, "Competitor_Master_-_Plumbing_Prince_1790080853652.xlsx");
      expect(sameHash.status).toBe(200);
      expect(sameHash.body).toMatchObject({
        idempotent: true, excluded_by_decision_count: 3, confirmed_by_decision_count: 4,
      });
      expect(sameHash.body.excluded_by_decision).toHaveLength(3);
      expect(sameHash.body.confirmed_by_decision).toHaveLength(4);

      const metadataWorkbook = XLSX.read(workbook, { type: "buffer" });
      metadataWorkbook.Props = { ...(metadataWorkbook.Props ?? {}), LastAuthor: "P034r2-loader-test" };
      const byteDifferentEquivalent = XLSX.write(metadataWorkbook, { type: "buffer", bookType: "xlsx" });
      const rebuilt = await request.post("/catalog/stage-competitor-workbook")
        .field("competitor", "Prince")
        .attach("file", byteDifferentEquivalent, "metadata-only-prince-master.xlsx");
      expect(rebuilt.status).toBe(200);
      expect(rebuilt.body.idempotent).toBe(true);
      expect(rebuilt.body.excluded_by_decision_count).toBe(3);
      expect(rebuilt.body.confirmed_by_decision_count).toBe(4);
      expect((await request.post(`/catalog/import-batches/${sameHash.body.batchId}/approve`)).status).toBe(200);
      expect((await request.post(`/catalog/import-batches/${sameHash.body.batchId}/approve`)).body.idempotent).toBe(true);

      const changedWorkbook = XLSX.read(workbook, { type: "buffer" });
      const changedSheet = changedWorkbook.Sheets[changedWorkbook.SheetNames[0]!]!;
      changedSheet.G4 = { t: "n", v: Number(changedSheet.G4?.v ?? 0) + 1 };
      const changed = XLSX.write(changedWorkbook, { type: "buffer", bookType: "xlsx" });
      const changedHash = await request.post("/catalog/stage-competitor-workbook")
        .field("competitor", "Prince")
        .attach("file", changed, "changed-prince-master.xlsx");
      expect(changedHash.status).toBe(400);
      expect(changedHash.body.error).toMatch(/checksum|fingerprint|Could not stage|trusted/i);
      if (changedHash.body.batchId) {
        const [createdBatch] = await db.select({ loadBatchId: importBatchesTable.loadBatchId })
          .from(importBatchesTable).where(eq(importBatchesTable.id, changedHash.body.batchId));
        await db.delete(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, changedHash.body.batchId));
        await db.delete(importBatchesTable).where(eq(importBatchesTable.id, changedHash.body.batchId));
        if (createdBatch?.loadBatchId) await db.delete(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, createdBatch.loadBatchId));
      }
    } finally {
      await db.delete(competitorMappingDecisionsTable).where(eq(competitorMappingDecisionsTable.promptVersion, "TEST"));
    }
  });

  it("filters a pre-decision pending Prince batch again at approval time", async () => {
    let pendingBatchId: number | null = null;
    try {
      const [batch] = await db.insert(importBatchesTable).values({
        competitor: "Prince", effectiveDate: "2026-03-01", sourceFileName: "pre-P034r2-pending.xlsx",
        priceBasis: "MRP", status: "pending", rowCounts: JSON.stringify({ source: "trusted_prince_competitor_master" }),
        fileSha256: "pre-p034r2-test", fileSizeBytes: 1,
      }).returning({ id: importBatchesTable.id });
      pendingBatchId = batch!.id;
      await db.insert(competitorPriceStagingTable).values({
        batchId: pendingBatchId, competitor: "Prince", effectiveDate: "2026-03-01",
        competitorCodeMaster: "SIM100150", competitorCodeCatalogue: "SIM100150",
        matchedPrayagCode: "A-464", newMrp: 30, status: "ok",
      });
      await db.insert(competitorMappingDecisionsTable).values([
        { competitor: "Prince", competitorCode: "SIM200032", prayagCode: "A-86B", decision: "exclusion", reason: "pending approval regression", promptVersion: "TEST_PENDING", },
        { competitor: "Prince", competitorCode: "SIM200032", prayagCode: "A-86A", decision: "exclusion", reason: "pending approval regression", promptVersion: "TEST_PENDING", },
        { competitor: "Prince", competitorCode: "SIM100150", prayagCode: "A-464", decision: "exclusion", reason: "pending approval regression", promptVersion: "TEST_PENDING", },
        { competitor: "Prince", competitorCode: "SIM103500", prayagCode: "*", decision: "confirmation", reason: "pending approval regression", promptVersion: "TEST_PENDING", },
        { competitor: "Prince", competitorCode: "SIM103501", prayagCode: "*", decision: "confirmation", reason: "pending approval regression", promptVersion: "TEST_PENDING", },
      ]);
      const approved = await request.post(`/catalog/import-batches/${pendingBatchId}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body.excludedByDecision).toHaveLength(1);
      expect(await db.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(and(
        eq(competitorPricesTable.competitor, "Prince"), eq(competitorPricesTable.competitorCode, "SIM100150"),
        eq(competitorPricesTable.matchedPrayagCode, "A-464"),
      ))).toHaveLength(1);
    } finally {
      if (pendingBatchId) {
        await db.delete(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, pendingBatchId));
        await db.delete(importBatchesTable).where(eq(importBatchesTable.id, pendingBatchId));
      }
      await db.delete(competitorMappingDecisionsTable).where(eq(competitorMappingDecisionsTable.promptVersion, "TEST_PENDING"));
    }
  });
});

afterAll(async () => {
  for (const createdBatchId of createdBatchIds) {
    const [batch] = await db.select().from(mrpRevisionBatchesTable).where(eq(mrpRevisionBatchesTable.id, createdBatchId));
    if (batch?.status === "applied") {
      await request.post(`/catalog/competitor-mapping-decisions/p034r2/${createdBatchId}/rollback`);
    }
    const restored = await db.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, "Prince"),
      eq(competitorPricesTable.competitorCode, "SIM100150"),
      eq(competitorPricesTable.matchedPrayagCode, "A-464"),
    ));
    if (restored.length !== 1) throw new Error("P034r2 test cleanup refused to delete audit rows because A-464 was not restored.");
    await db.delete(competitorMappingDecisionsTable).where(eq(competitorMappingDecisionsTable.batchId, createdBatchId));
    await db.delete(mrpRevisionRowsTable).where(eq(mrpRevisionRowsTable.batchId, createdBatchId));
    await db.delete(mrpRevisionBatchesTable).where(eq(mrpRevisionBatchesTable.id, createdBatchId));
  }
});