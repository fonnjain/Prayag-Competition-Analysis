import { describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  catalogProductClassificationCorrectionsTable,
  catalogProductsTable,
  db,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  competitorPricesTable,
  competitorPriceStagingTable,
} from "@workspace/db";
import router from "./catalogImportExport";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
  req.user = { id: "p029-admin", email: "p029-admin@example.com", role: "admin", mustChangePassword: false };
  next();
});
app.use(router);

const nonAdmin = express();
nonAdmin.use(express.json());
nonAdmin.use((req, _res, next) => {
  req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
  req.user = { id: "p029-test", email: "p029-test@example.com", role: "user", mustChangePassword: false };
  next();
});
nonAdmin.use(router);

const SELF_FIT_CODES = ["U-11CS", "U-13CS", "U-14CS", "U-15CS", "U-16CS", "U-13BS", "U-14BS"];
const TARGET_CODES = ["U-11CS", "U-12CS", "U-13CS", "U-14CS", "U-15CS", "U-16CS", "U-11BS", "U-12BS", "U-13BS", "U-14BS"];
const UNTOUCHED_CODES = ["20", "25", "32"];
const CLASSIFICATION_FIELDS = ["division", "category", "seriesRange", "size", "uom", "kgCost"] as const;
function digest(rows: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
async function protectedSnapshot() {
  const [products, history, competitors, staging] = await Promise.all([
    db.select().from(catalogProductsTable),
    db.select().from(mrpPriceHistoryTable),
    db.select().from(competitorPricesTable),
    db.select().from(competitorPriceStagingTable),
  ]);
  const sortRows = (rows: any[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    productCount: products.length,
    products: digest(sortRows(products)),
    history: digest(sortRows(history)),
    competitors: digest(sortRows(competitors)),
    staging: digest(sortRows(staging)),
    productState: new Map(products.map((row) => [row.itemCode, {
      productName: row.productName, isActive: row.isActive, discontinuedFrom: row.discontinuedFrom,
    }])),
    classifications: new Map(products.map((row) => [row.itemCode,
      Object.fromEntries(CLASSIFICATION_FIELDS.map((field) => [field, row[field]])),
    ])),
  };
}

async function restoreClassifications(snapshot: Awaited<ReturnType<typeof protectedSnapshot>>) {
  for (const code of TARGET_CODES) {
    const values = snapshot.classifications.get(code);
    if (values) await db.update(catalogProductsTable).set(values).where(eq(catalogProductsTable.itemCode, code));
  }
}

describe("P029 UGD classification correction", () => {
  it("previews, applies, and undoes without touching prices or competitors", async () => {
    const before = await protectedSnapshot();
    const beforePrince = await db.select({
      matchedPrayagCode: competitorPricesTable.matchedPrayagCode,
      price: competitorPricesTable.price,
    }).from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, "Prince"),
      inArray(competitorPricesTable.matchedPrayagCode, SELF_FIT_CODES),
    ));
    const untouchedBefore = await db.select().from(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, UNTOUCHED_CODES));
    let correctionKey = "";
    let batchIds: number[] = [];
    try {
      const preview = await supertest(app).post("/catalog/ugd-classification/preview").send({});
      expect(preview.status).toBe(200);
      expect(preview.body.rows).toHaveLength(10);
      expect(preview.body.copiedFields).toEqual(["division", "category", "seriesRange", "size", "uom", "kgCost"]);
      expect(preview.body.sizeAction).toContain("unchanged");
      expect(preview.body.priceChecks.every((row: any) => row.matches && row.siblingMrp === row.expectedMrp && row.targetMrp === row.expectedMrp)).toBe(true);
      correctionKey = preview.body.correctionKey;

      const applied = await supertest(app).post(`/catalog/ugd-classification/${correctionKey}/apply`).send({});
      expect(applied.status).toBe(200);
      expect(applied.body.changed).toBe(10);
      const [selfFit] = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, "U-11CS"));
      const [ringFit] = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, "U-11C"));
      expect(selfFit?.division).toBe(ringFit?.division);
      expect(selfFit?.category).toBe(ringFit?.category);
      expect(selfFit?.seriesRange).toBe(ringFit?.seriesRange);
      expect(selfFit?.size).toBe(ringFit?.size);
      expect(selfFit?.uom).toBe(ringFit?.uom);
      expect(selfFit?.kgCost).toBe(ringFit?.kgCost);
      const afterApply = await protectedSnapshot();
      expect(afterApply.productCount).toBe(before.productCount);
      expect(afterApply.history).toBe(before.history);
      expect(afterApply.competitors).toBe(before.competitors);
      expect(afterApply.staging).toBe(before.staging);
      for (const code of TARGET_CODES) {
        const [target] = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, code));
        const [sibling] = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, code.replace(/S$/, "")));
        expect(target?.productName).toBe(before.productState.get(code)?.productName);
        expect(target?.isActive).toBe(before.productState.get(code)?.isActive);
        expect(target?.discontinuedFrom).toBe(before.productState.get(code)?.discontinuedFrom);
        for (const field of CLASSIFICATION_FIELDS) expect(target?.[field]).toBe(sibling?.[field]);
      }
      const uncategorized = await db
        .select({ itemCode: catalogProductsTable.itemCode })
        .from(catalogProductsTable)
        .where(and(
          eq(catalogProductsTable.division, "Pipes & Fittings"),
          eq(catalogProductsTable.isActive, true),
          sql`${catalogProductsTable.category} IS NULL OR btrim(${catalogProductsTable.category}) = ''`,
        ));
      expect(uncategorized.map((row) => row.itemCode).sort()).toEqual(["20", "25", "32"]);
      expect(await db.select().from(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, UNTOUCHED_CODES))).toEqual(untouchedBefore);
      expect(await db.select({ matchedPrayagCode: competitorPricesTable.matchedPrayagCode, price: competitorPricesTable.price })
        .from(competitorPricesTable).where(and(eq(competitorPricesTable.competitor, "Prince"), inArray(competitorPricesTable.matchedPrayagCode, SELF_FIT_CODES)))).toEqual(beforePrince);

      const undone = await supertest(app).post(`/catalog/ugd-classification/${correctionKey}/undo`).send({});
      expect(undone.status).toBe(200);
      expect([0, 10]).toContain(undone.body.restored);
      expect(await protectedSnapshot()).toMatchObject({
        productCount: before.productCount, history: before.history, competitors: before.competitors, staging: before.staging,
      });
      const restored = await db.select().from(catalogProductsTable);
      for (const row of restored) {
        expect({ productName: row.productName, isActive: row.isActive, discontinuedFrom: row.discontinuedFrom })
          .toEqual(before.productState.get(row.itemCode));
      }
      const audits = await db.select().from(catalogProductClassificationCorrectionsTable)
        .where(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey));
      expect(audits).toHaveLength(10);
      expect(audits.every((row) => row.actor === "p029-admin@example.com")).toBe(true);
      expect(audits.every((row) => row.appliedAt != null && row.loadBatchId != null)).toBe(true);
      const [batch] = await db.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, audits[0]!.loadBatchId!));
      expect(batch?.loadedBy).toBe("p029-admin@example.com");
      expect(batch?.fileSha256).toMatch(/^[a-f0-9]{64}$/);
      batchIds = audits.map((row) => row.loadBatchId).filter((id): id is number => id != null);
    } finally {
      await restoreClassifications(before);
      if (correctionKey) {
        const pendingAudits = await db.select().from(catalogProductClassificationCorrectionsTable)
          .where(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey));
        for (const audit of pendingAudits) {
          await db.update(catalogProductsTable).set(JSON.parse(audit.previousValues))
            .where(eq(catalogProductsTable.itemCode, audit.itemCode));
        }
      }
      if (correctionKey) await db.delete(catalogProductClassificationCorrectionsTable).where(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey));
      if (batchIds.length) await db.delete(mrpLoadBatchesTable).where(inArray(mrpLoadBatchesTable.id, [...new Set(batchIds)]));
    }
  });

  it("rejects a stale preview before writing", async () => {
    const before = await protectedSnapshot();
    const preview = await supertest(app).post("/catalog/ugd-classification/preview").send({});
    expect(preview.status).toBe(200);
    const correctionKey = preview.body.correctionKey as string;
    await db.update(catalogProductsTable).set({ category: "P029 stale fixture" })
      .where(eq(catalogProductsTable.itemCode, "U-11CS"));
    try {
      const applied = await supertest(app).post(`/catalog/ugd-classification/${correctionKey}/apply`).send({});
      expect(applied.status).toBe(409);
      expect(applied.body.error).toMatch(/stale/i);
    } finally {
      await restoreClassifications(before);
      await db.delete(catalogProductClassificationCorrectionsTable)
        .where(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey));
    }
  });

  it("blocks undo after an applied classification is changed", async () => {
    const before = await protectedSnapshot();
    const preview = await supertest(app).post("/catalog/ugd-classification/preview").send({});
    expect(preview.status).toBe(200);
    const correctionKey = preview.body.correctionKey as string;
    let batchIds: number[] = [];
    try {
      expect((await supertest(app).post(`/catalog/ugd-classification/${correctionKey}/apply`).send({})).status).toBe(200);
      await db.update(catalogProductsTable).set({ category: "P029 undo stale fixture" })
        .where(eq(catalogProductsTable.itemCode, "U-11CS"));
      const blocked = await supertest(app).post(`/catalog/ugd-classification/${correctionKey}/undo`).send({});
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toMatch(/changed after apply/i);
      await db.update(catalogProductsTable).set({ category: "UGD Pipe" })
        .where(eq(catalogProductsTable.itemCode, "U-11CS"));
      expect((await supertest(app).post(`/catalog/ugd-classification/${correctionKey}/undo`).send({})).status).toBe(200);
      const audits = await db.select().from(catalogProductClassificationCorrectionsTable)
        .where(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey));
      batchIds = audits.map((row) => row.loadBatchId).filter((id): id is number => id != null);
    } finally {
      await restoreClassifications(before);
      await db.delete(catalogProductClassificationCorrectionsTable)
        .where(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey));
      if (batchIds.length) await db.delete(mrpLoadBatchesTable).where(inArray(mrpLoadBatchesTable.id, [...new Set(batchIds)]));
    }
  });

  it("rejects non-admin users with 403", async () => {
    const response = await supertest(nonAdmin).post("/catalog/ugd-classification/preview").send({});
    expect(response.status).toBe(403);
  });
});