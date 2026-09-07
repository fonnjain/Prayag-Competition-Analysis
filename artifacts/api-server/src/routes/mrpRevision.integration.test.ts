import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPricesTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpPriceHistoryTable,
  mrpRevisionBatchesTable,
  mrpRevisionRowsTable,
} from "@workspace/db";
import revisionRouter from "./mrpRevision";
import { warningFor } from "./mrpRevision";
import { createMrpFixtureBatch, deleteMrpFixtureBatch } from "./testMrpFixture.js";

const RUN = Date.now();
const CODE = `__MRP_REVISION_${RUN}__`;
const UNTOUCHED_CODE = `__MRP_REVISION_UNTOUCHED_${RUN}__`;
const DATE = "2040-03-05";
const COMPETITOR = `Revision Competitor ${RUN}`;
const OTHER_COMPETITOR = `Other Revision Competitor ${RUN}`;
const COMPETITOR_CODE = `REV-COMP-${RUN}`;
const COMPETITOR_DATE = "2040-04-01";
const COMPETITOR_LATER_DATE = "2040-09-01";
const SUPPLIED_WORKBOOK = fileURLToPath(
  new URL(
    "../../../../attached_assets/MRP_Revision_Upload_Template_1787838250278.xlsx",
    import.meta.url,
  ),
);
const request = supertest(
  express()
    .use(express.json())
    .use((req, _res, next) => {
      req.user = {
        id: "revision-test-admin",
        email: "revision-test-admin@example.com",
        mustChangePassword: false,
        role: "admin",
      };
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    })
    .use(revisionRouter),
);
const batchIds: number[] = [];
let fixtureBatchId = 0;

function workbook(): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["item_code", "effective_date", "variant", "new_mrp", "note"],
    [CODE, DATE, "Standard", 40, "intentional low-price test"],
    [` ${UNTOUCHED_CODE} .0`, DATE, "Standard", 200, "normalization no-op test"],
    [CODE, "2040-03-06", "Standard", 110, "must not create a period"],
    ["DOES-NOT-EXIST", DATE, "Standard", 110, "must not create product"],
    [CODE, DATE, "Ivory", null, "blank must be rejected"],
  ]), "revision");
  // This intentionally dangerous-looking sheet proves the parser reads only
  // the explicitly named revision sheet.
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["item_code", "effective_date", "new_mrp"],
    [CODE, DATE, 99999],
  ]), "reference_do_not_upload");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

function noopWorkbook(): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["item_code", "effective_date", "variant", "new_mrp", "note"],
    [` ${UNTOUCHED_CODE} .0`, DATE, "Standard", 200, "must not change"],
  ]), "revision");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

function noDateWorkbook(): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["item_code", "variant", "new_mrp", "note"],
    [CODE, "Standard", 110, "selected date must be used"],
  ]), "revision");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

function competitorWorkbook(
  date = COMPETITOR_DATE,
  competitor = COMPETITOR,
): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["item_code", "effective_date", "variant", "new_mrp", "competitor", "note"],
    [COMPETITOR_CODE, date, "Standard", 125, competitor, "competitor correction"],
  ]), "revision");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

async function createChangePreview(reason: string) {
  const preview = await request.post("/catalog/mrp-revisions/preview")
    .field("targetType", "mrp")
    .field("effectiveDate", DATE)
    .field("reason", reason)
    .attach("file", workbook(), { filename: "revision.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  expect(preview.status).toBe(200);
  batchIds.push(preview.body.batchId);
  return preview;
}

beforeAll(async () => {
  fixtureBatchId = await createMrpFixtureBatch("mrp-revision", RUN);
  await db.insert(catalogProductsTable).values([
    { itemCode: CODE, productName: "Revision fixture", division: "PTMT & Plastic Fittings / CP Fittings", category: "Test" },
    { itemCode: UNTOUCHED_CODE, productName: "Untouched fixture", division: "PTMT & Plastic Fittings", category: "Test" },
  ]);
  await db.insert(mrpPriceHistoryTable).values([
    { itemCode: CODE, mrp: 100, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard" },
    { itemCode: CODE, mrp: 90, priceBasis: "MRP", effectiveDate: "2040-03-06", loadDate: "2040-03-06", variant: "Standard" },
    { itemCode: UNTOUCHED_CODE, mrp: 200, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard" },
  ].map((row) => ({ ...row, loadBatchId: fixtureBatchId })));
  await db.insert(competitorPricesTable).values([
    { competitor: COMPETITOR, competitorCode: COMPETITOR_CODE, price: 100, effectiveDate: COMPETITOR_DATE, matchStatus: "matched" },
    { competitor: COMPETITOR, competitorCode: COMPETITOR_CODE, price: 130, effectiveDate: COMPETITOR_LATER_DATE, matchStatus: "matched" },
    { competitor: OTHER_COMPETITOR, competitorCode: COMPETITOR_CODE, price: 140, effectiveDate: COMPETITOR_DATE, matchStatus: "matched" },
  ]);
});

afterAll(async () => {
  if (batchIds.length) {
    await db.delete(mrpRevisionRowsTable).where(inArray(mrpRevisionRowsTable.batchId, batchIds));
    await db.delete(mrpRevisionBatchesTable).where(inArray(mrpRevisionBatchesTable.id, batchIds));
  }
  await db.delete(mrpHistoryProvenanceEventsTable)
    .where(inArray(mrpHistoryProvenanceEventsTable.itemCode, [CODE, UNTOUCHED_CODE]));
  await db.delete(competitorPricesTable)
    .where(inArray(competitorPricesTable.competitor, [COMPETITOR, OTHER_COMPETITOR]));
  await db.delete(mrpPriceHistoryTable)
    .where(inArray(mrpPriceHistoryTable.itemCode, [CODE, UNTOUCHED_CODE]));
  await deleteMrpFixtureBatch(fixtureBatchId);
  await db.delete(catalogProductsTable)
    .where(inArray(catalogProductsTable.itemCode, [CODE, UNTOUCHED_CODE]));
});

describe("MRP revision preview, apply and rollback", () => {
  it("lists existing revision scopes and rejects a missing or nonexistent selected period without creating one", async () => {
    const beforePeriods = await db
      .selectDistinct({ effectiveDate: mrpPriceHistoryTable.effectiveDate })
      .from(mrpPriceHistoryTable);
    const scopes = await request.get("/catalog/mrp-revisions/scopes");
    expect(scopes.status).toBe(200);
    expect(scopes.body.mrpPeriods).toEqual(expect.arrayContaining([
      expect.objectContaining({
        effectiveDate: DATE,
        divisions: [
          { division: "PTMT & Plastic Fittings", count: 2 },
          { division: "CP Fittings", count: 1 },
        ],
        rowCount: 2,
      }),
    ]));
    expect(scopes.body.competitorPeriods).toEqual(expect.arrayContaining([
      expect.objectContaining({
        competitor: COMPETITOR,
        effectiveDate: COMPETITOR_DATE,
        rowCount: 1,
        endsOn: expect.any(String),
      }),
      expect.objectContaining({
        competitor: COMPETITOR,
        effectiveDate: COMPETITOR_LATER_DATE,
        rowCount: 1,
        endsOn: null,
      }),
    ]));

    const missingDate = await request.post("/catalog/mrp-revisions/preview")
      .field("targetType", "mrp")
      .field("reason", "A selected period is required")
      .attach("file", noopWorkbook(), { filename: "missing-date.xlsx" });
    expect(missingDate.status).toBe(400);
    expect(missingDate.body.error).toMatch(/existing effectiveDate/i);

    const nonexistentDate = await request.post("/catalog/mrp-revisions/preview")
      .field("targetType", "mrp")
      .field("effectiveDate", "2041-01-01")
      .field("reason", "Selected dates must already exist")
      .attach("file", noopWorkbook(), { filename: "nonexistent-date.xlsx" });
    expect(nonexistentDate.status).toBe(400);
    expect(nonexistentDate.body.error).toContain("No existing MRP period found");

    const afterPeriods = await db
      .selectDistinct({ effectiveDate: mrpPriceHistoryTable.effectiveDate })
      .from(mrpPriceHistoryTable);
    expect(afterPeriods).toEqual(beforePeriods);
  });

  it("normalizes uploaded codes, warns only on changing rows, rejects invalid rows, and restores exact previous values", async () => {
    const preview = await request.post("/catalog/mrp-revisions/preview")
      .field("targetType", "mrp")
      .field("effectiveDate", DATE)
      .field("reason", "Test the controlled revision pathway")
      .attach("file", workbook(), { filename: "revision.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      rowsInFile: 5,
      rowsChanged: 1,
      rowsNoop: 1,
      rowsRejected: 3,
      status: "preview",
    });
    expect(preview.body.warningCount).toBeGreaterThan(1);
    expect(preview.body).toMatchObject({
      hasEffectiveDateColumn: true,
      dateMismatchCount: 1,
      dateMismatchDates: ["2040-03-06"],
    });
    expect(preview.body.rows.find((row: { effectiveDate: string; outcome: string }) =>
      row.effectiveDate === "2040-03-06",
    )).toMatchObject({
      outcome: "rejected",
      rejectionReason: "Row date 2040-03-06 does not match the selected period 2040-03-05.",
      previousValue: 90,
    });
    batchIds.push(preview.body.batchId);
    expect(preview.body.rows.find((row: { outcome: string; itemCode: string }) =>
      row.itemCode === UNTOUCHED_CODE,
    )).toMatchObject({
      outcome: "noop",
      warningReasons: null,
    });
    expect(preview.body.rows.filter((row: { outcome: string }) => row.outcome === "rejected")
      .every((row: { warningReasons: string | null }) => row.warningReasons == null)).toBe(true);

    const beforeApply = await db.select({ mrp: mrpPriceHistoryTable.mrp })
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, CODE));
    expect(beforeApply[0]?.mrp).toBe(100);

    const missingAck = await request.post(`/catalog/mrp-revisions/${preview.body.batchId}/apply`).send({});
    expect(missingAck.status).toBe(409);

    const applied = await request.post(`/catalog/mrp-revisions/${preview.body.batchId}/apply`)
      .send({ acknowledgeWarnings: true });
    expect(applied.status).toBe(200);
    expect(applied.body.rowsChanged).toBe(1);
    const afterApply = await db.select({
      itemCode: mrpPriceHistoryTable.itemCode,
      mrp: mrpPriceHistoryTable.mrp,
      lastRevisionBatchId: mrpPriceHistoryTable.lastRevisionBatchId,
    }).from(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.itemCode, [CODE, UNTOUCHED_CODE]));
    expect(afterApply.find((row) => row.itemCode === CODE)?.mrp).toBe(40);
    expect(afterApply.find((row) => row.itemCode === CODE)?.lastRevisionBatchId).toBe(preview.body.batchId);
    expect(afterApply.find((row) => row.itemCode === UNTOUCHED_CODE)?.mrp).toBe(200);

    const rolledBack = await request.post(`/catalog/mrp-revisions/${preview.body.batchId}/rollback`);
    expect(rolledBack.status).toBe(200);
    const restored = await db.select({ mrp: mrpPriceHistoryTable.mrp })
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, CODE));
    expect(restored[0]?.mrp).toBe(100);
  });

  it("reports a no-op-only preview clearly, blocks direct apply, and records a durable discard", async () => {
    const preview = await request.post("/catalog/mrp-revisions/preview")
      .field("targetType", "mrp")
      .field("effectiveDate", DATE)
      .field("reason", "Test a no-op-only preview")
      .attach("file", noopWorkbook(), { filename: "noop-revision.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      rowsInFile: 1,
      rowsChanged: 0,
      rowsNoop: 1,
      rowsRejected: 0,
      warningCount: 0,
      status: "preview",
    });
    batchIds.push(preview.body.batchId);

    const apply = await request.post(`/catalog/mrp-revisions/${preview.body.batchId}/apply`).send({});
    expect(apply.status).toBe(409);
    expect(apply.body.error).toBe("Nothing to apply: 1 rows, all no-ops.");

    const discarded = await request.post(`/catalog/mrp-revisions/${preview.body.batchId}/discard`);
    expect(discarded.status).toBe(200);
    expect(discarded.body).toMatchObject({ batchId: preview.body.batchId, status: "discarded" });

    const retained = await request.get(`/catalog/mrp-revisions/${preview.body.batchId}`);
    expect(retained.status).toBe(200);
    expect(retained.body.batch).toMatchObject({
      status: "discarded",
      discardedBy: "revision-test-admin@example.com",
    });
    expect(retained.body.batch.discardedAt).toBeTruthy();
    expect(retained.body.rows).toHaveLength(1);
  });

  it("uses the selected existing period only when the workbook has no effective-date column", async () => {
    const preview = await request.post("/catalog/mrp-revisions/preview")
      .field("targetType", "mrp")
      .field("effectiveDate", DATE)
      .field("reason", "Allow a legacy correction file without a date column")
      .attach("file", noDateWorkbook(), { filename: "no-date-revision.xlsx" });
    expect(preview.status).toBe(200);
    batchIds.push(preview.body.batchId);
    expect(preview.body).toMatchObject({
      effectiveDate: DATE,
      hasEffectiveDateColumn: false,
      dateMismatchCount: 0,
      rowsChanged: 1,
      rowsRejected: 0,
    });
    expect(preview.body.rows).toEqual([
      expect.objectContaining({ effectiveDate: DATE, outcome: "change" }),
    ]);
    expect((await request.post(`/catalog/mrp-revisions/${preview.body.batchId}/discard`)).status).toBe(200);
  });

  it("scopes competitor revisions to the selected brand and existing period", async () => {
    const preview = await request.post("/catalog/mrp-revisions/preview")
      .field("targetType", "competitor")
      .field("competitor", COMPETITOR)
      .field("effectiveDate", COMPETITOR_DATE)
      .field("reason", "Correct an existing competitor period")
      .attach("file", competitorWorkbook(), { filename: "competitor-revision.xlsx" });
    expect(preview.status).toBe(200);
    batchIds.push(preview.body.batchId);
    expect(preview.body).toMatchObject({
      competitor: COMPETITOR,
      effectiveDate: COMPETITOR_DATE,
      rowsChanged: 1,
      rowsRejected: 0,
    });
    expect((await request.post(`/catalog/mrp-revisions/${preview.body.batchId}/discard`)).status).toBe(200);

    const crossBrandPeriod = await request.post("/catalog/mrp-revisions/preview")
      .field("targetType", "competitor")
      .field("competitor", COMPETITOR)
      .field("effectiveDate", DATE)
      .field("reason", "A competitor cannot use another brand's period")
      .attach("file", competitorWorkbook(DATE, COMPETITOR), { filename: "cross-brand-period.xlsx" });
    expect(crossBrandPeriod.status).toBe(400);
    expect(crossBrandPeriod.body.error).toContain(`No existing ${COMPETITOR} period found`);
  });

  it("exempts confirmed low-price codes without suppressing warnings for other codes", () => {
    expect(warningFor("PH-1", "PTMT & Plastic Fittings", 100, 22.44))
      .not.toContain("New value ₹22.44 is below ₹50 for PTMT & Plastic Fittings.");
    expect(warningFor("UNLISTED-PTMT", "PTMT & Plastic Fittings", 100, 22.44))
      .toContain("New value ₹22.44 is below ₹50 for PTMT & Plastic Fittings.");
  });

  it("allows only one terminal transition when Apply and Discard race", async () => {
    const preview = await createChangePreview("Test Apply and Discard race handling");
    const [apply, discard] = await Promise.all([
      request.post(`/catalog/mrp-revisions/${preview.body.batchId}/apply`).send({ acknowledgeWarnings: true }),
      request.post(`/catalog/mrp-revisions/${preview.body.batchId}/discard`),
    ]);
    expect([apply.status, discard.status].sort()).toEqual([200, 409]);

    const retained = await request.get(`/catalog/mrp-revisions/${preview.body.batchId}`);
    expect(retained.status).toBe(200);
    if (retained.body.batch.status === "applied") {
      expect(apply.status).toBe(200);
      const changed = await db.select({ mrp: mrpPriceHistoryTable.mrp })
        .from(mrpPriceHistoryTable)
        .where(eq(mrpPriceHistoryTable.itemCode, CODE));
      expect(changed[0]?.mrp).toBe(40);
      expect((await request.post(`/catalog/mrp-revisions/${preview.body.batchId}/rollback`)).status).toBe(200);
    } else {
      expect(retained.body.batch.status).toBe("discarded");
      expect(discard.status).toBe(200);
      const unchanged = await db.select({ mrp: mrpPriceHistoryTable.mrp })
        .from(mrpPriceHistoryTable)
        .where(eq(mrpPriceHistoryTable.itemCode, CODE));
      expect(unchanged[0]?.mrp).toBe(100);
    }
  });

  it("rejects a stale competing Apply before it can overwrite the first batch", async () => {
    const [firstPreview, secondPreview] = await Promise.all([
      createChangePreview("Test the first competing Apply"),
      createChangePreview("Test the second competing Apply"),
    ]);
    const [firstApply, secondApply] = await Promise.all([
      request.post(`/catalog/mrp-revisions/${firstPreview.body.batchId}/apply`).send({ acknowledgeWarnings: true }),
      request.post(`/catalog/mrp-revisions/${secondPreview.body.batchId}/apply`).send({ acknowledgeWarnings: true }),
    ]);
    const attempts = [
      { batchId: firstPreview.body.batchId, response: firstApply },
      { batchId: secondPreview.body.batchId, response: secondApply },
    ];
    const succeeded = attempts.filter(({ response }) => response.status === 200);
    expect(succeeded).toHaveLength(1);
    expect(attempts.filter(({ response }) => response.status === 409)).toHaveLength(1);

    const changed = await db.select({ mrp: mrpPriceHistoryTable.mrp })
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, CODE));
    expect(changed[0]?.mrp).toBe(40);
    expect((await request.post(`/catalog/mrp-revisions/${succeeded[0]!.batchId}/rollback`)).status).toBe(200);
  });

  it.runIf(existsSync(SUPPLIED_WORKBOOK))(
    "keeps the supplied uniform March workbook in its selected period and prominently rejects it against September",
    async () => {
      const matchingPreview = await request.post("/catalog/mrp-revisions/preview")
        .field("targetType", "mrp")
        .field("effectiveDate", "2026-03-05")
        .field("reason", "Verify the supplied revision workbook after code normalization")
        .attach("file", SUPPLIED_WORKBOOK);

      expect(matchingPreview.status).toBe(200);
      batchIds.push(matchingPreview.body.batchId);
      expect(matchingPreview.body).toMatchObject({
        rowsInFile: 343,
        rowsChanged: 0,
        rowsNoop: 343,
        rowsRejected: 0,
        warningCount: 0,
        status: "preview",
      });

      const mismatchPreview = await request.post("/catalog/mrp-revisions/preview")
        .field("targetType", "mrp")
        .field("effectiveDate", "2026-09-01")
        .field("reason", "Prove the selected period guards against the March workbook")
        .attach("file", SUPPLIED_WORKBOOK);
      expect(mismatchPreview.status).toBe(200);
      batchIds.push(mismatchPreview.body.batchId);
      expect(mismatchPreview.body).toMatchObject({
        rowsInFile: 343,
        rowsChanged: 0,
        rowsNoop: 0,
        rowsRejected: 343,
        dateMismatchCount: 343,
        dateMismatchDates: ["2026-03-05"],
      });
      expect(mismatchPreview.body.rows[0]).toMatchObject({
        outcome: "rejected",
        rejectionReason: "Row date 2026-03-05 does not match the selected period 2026-09-01.",
      });
      expect(mismatchPreview.body.rows[0].previousValue).not.toBeNull();
    },
  );
});