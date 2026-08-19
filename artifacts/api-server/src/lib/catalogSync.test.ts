import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import catalogSyncRouter from "../routes/catalogSync";
import {
  CATALOG_ADMIN_EMAIL,
  createCatalogSyncBundleFromData,
  createCatalogSyncPreflightToken,
  type CatalogSyncData,
  parseAndValidateCatalogSyncBundle,
  verifyCatalogSyncPreflightToken,
} from "./catalogSync";

function fixtureData(): CatalogSyncData {
  return {
    catalogProducts: [
      {
        id: 1,
        itemCode: "P-1",
        productName: "Test product",
        division: "Test",
        category: "Test",
        seriesRange: null,
        size: null,
        uom: "NOS",
        kgCost: null,
        isActive: true,
        discontinuedFrom: null,
        sourceFiles: null,
        dataFlag: null,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    ],
    mrpSources: [
      {
        id: 1,
        division: "Test",
        sheetId: "sheet-1",
        sheetUrl: "https://example.com",
        expectedFileName: null,
        notes: null,
        sourceKind: "official",
      },
    ],
    mrpLoadBatches: [
      {
        id: 1,
        sourceId: 1,
        fileName: "source.xlsx",
        fileSha256: "a".repeat(64),
        fileSizeBytes: 10,
        downloadedAt: "2026-08-19",
        loadedAt: "2026-08-19T00:00:00.000Z",
        loadedBy: null,
        rowCount: 1,
        notes: null,
      },
    ],
    mrpPriceHistory: [
      {
        id: 1,
        itemCode: "P-1",
        mrp: 100,
        netPrice: null,
        discountPct: null,
        priceBasis: "MRP",
        effectiveDate: "2026-08-19",
        loadDate: "2026-08-19",
        sourceFile: "source.xlsx",
        isCurrent: true,
        notes: null,
        reviewStatus: "approved",
        reviewReasons: null,
        importBatchId: null,
        loadBatchId: 1,
        reviewedAt: null,
      },
    ],
    mrpHistoryProvenanceEvents: [
      {
        id: 1,
        historyRowId: 1,
        itemCode: "P-1",
        effectiveDate: "2026-08-19",
        action: "loaded",
        reason: null,
        sourceFile: "source.xlsx",
        loadBatchId: 1,
        previousMrp: null,
        mrp: 100,
        createdAt: "2026-08-19T00:00:00.000Z",
      },
    ],
    codeConflicts: [],
    competitorPrices: [
      {
        id: 1,
        competitor: "Sparsh Pearl",
        category: null,
        description: "Test",
        size: null,
        matchedPrayagCode: "P-1",
        matchStatus: "matched",
        price: 110,
        unit: null,
        competitorCode: "OLD-1",
        effectiveDate: "2026-08-19",
        matchConfidence: "High",
        prayagMrpAtCompare: 100,
        isCurrent: true,
        priceBasis: "MRP",
        gstPct: null,
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    ],
    competitorCodeAliases: [
      {
        id: 1,
        competitor: "Sparsh Pearl",
        oldCode: "OLD-1",
        newCode: "NEW-1",
        note: null,
        createdAt: "2026-08-19T00:00:00.000Z",
      },
    ],
  };
}

function serialize(data: CatalogSyncData = fixtureData()): Buffer {
  return Buffer.from(JSON.stringify(createCatalogSyncBundleFromData(data)));
}

beforeAll(() => {
  process.env.SESSION_SECRET = "catalog-sync-test-secret";
});

describe("catalog sync bundle validation", () => {
  it("accepts a signed bundle and binds preflight tokens to its checksum and administrator", () => {
    const bundle = parseAndValidateCatalogSyncBundle(serialize());
    const currentChecksum = "b".repeat(64);
    const token = createCatalogSyncPreflightToken(
      bundle,
      CATALOG_ADMIN_EMAIL,
      currentChecksum,
    );

    expect(() =>
      verifyCatalogSyncPreflightToken(token, bundle, CATALOG_ADMIN_EMAIL),
    ).not.toThrow();
    expect(() =>
      verifyCatalogSyncPreflightToken(token, bundle, "other@example.com"),
    ).toThrow(/expired or does not match/i);
  });

  it("rejects a tampered table", () => {
    const raw = JSON.parse(serialize().toString("utf8"));
    raw.data.mrpPriceHistory[0].mrp = 999;
    expect(() =>
      parseAndValidateCatalogSyncBundle(Buffer.from(JSON.stringify(raw))),
    ).toThrow(/integrity check/i);
  });

  it("rejects missing internal relationships before any write", () => {
    const data = fixtureData();
    data.mrpPriceHistory[0]!.loadBatchId = 999;
    expect(() => parseAndValidateCatalogSyncBundle(serialize(data))).toThrow(
      /missing load batch/i,
    );
  });

  it("rejects malformed field types and unexpected fields before any write", () => {
    const invalidDate = fixtureData();
    invalidDate.mrpPriceHistory[0]!.effectiveDate = "2026-02-30";
    expect(() => parseAndValidateCatalogSyncBundle(serialize(invalidDate))).toThrow(
      /effectiveDate has an invalid value/i,
    );

    const unexpected = fixtureData();
    unexpected.catalogProducts[0]!.passwordHash = "must-never-transfer";
    expect(() => parseAndValidateCatalogSyncBundle(serialize(unexpected))).toThrow(
      /missing or unexpected fields/i,
    );
  });

  it("strictly validates RFC3339 timestamps without calendar normalization", () => {
    for (const invalid of [
      "2026-02-30T00:00:00.000Z",
      "2026-08-19",
      "2026-08-19T12:30:00+24:00",
      "2026-08-19T12:30:00+05:99",
    ]) {
      const data = fixtureData();
      data.catalogProducts[0]!.createdAt = invalid;
      expect(() => parseAndValidateCatalogSyncBundle(serialize(data))).toThrow(
        /createdAt has an invalid value/i,
      );
    }

    const validOffset = fixtureData();
    validOffset.catalogProducts[0]!.createdAt = "2026-08-19T12:30:00+05:30";
    expect(() =>
      parseAndValidateCatalogSyncBundle(serialize(validOffset)),
    ).not.toThrow();
  });

  it("rejects an empty but otherwise correctly signed catalog", () => {
    const empty = Object.fromEntries(
      Object.keys(fixtureData()).map((key) => [key, []]),
    ) as unknown as CatalogSyncData;
    expect(() => parseAndValidateCatalogSyncBundle(serialize(empty))).toThrow(
      /empty catalog or MRP history/i,
    );
  });
});

describe("catalog sync route guards", () => {
  function appFor(email: string) {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: "test", email } as typeof req.user;
      next();
    });
    app.use(catalogSyncRouter);
    return app;
  }

  it("does not expose sync operations to ordinary signed-in users", async () => {
    const response = await request(appFor("viewer@example.com")).get(
      "/catalog/sync/export",
    );
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/administrator/i);
  });

  it("does not export a development bundle from production", async () => {
    const response = await request(appFor(CATALOG_ADMIN_EMAIL))
      .get("/catalog/sync/export")
      .set("x-catalog-sync-test-environment", "production");
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/only be exported from development/i);
  });

  it("does not import a bundle outside production", async () => {
    const response = await request(appFor(CATALOG_ADMIN_EMAIL))
      .post("/catalog/sync/preflight")
      .attach("file", serialize(), "bundle.json");
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/only be imported in production/i);
  });
});