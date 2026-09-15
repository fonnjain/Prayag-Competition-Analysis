import express from "express";
import supertest from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPricesTable,
  db,
  mrpGeneratorResultsTable,
  mrpGeneratorRunsTable,
  mrpGeneratorScenariosTable,
  mrpHistoryProvenanceEventsTable,
  mrpPriceHistoryTable,
  mrpRevisionBatchesTable,
  mrpRevisionRowsTable,
} from "@workspace/db";
import routes from "./index";
import { createMrpFixtureBatch, deleteMrpFixtureBatch } from "./testMrpFixture.js";
import { SalesApiClient, resetSalesApiClient, setSalesApiClientForTests, type SalesApiClientOptions } from "../lib/salesApi";
import { DEFAULT_P012_SCENARIO, promoteP012ToAdvanced } from "../lib/mrpGenerator";

const RUN = Date.now();
const CODE = `__MRP_GENERATOR_${RUN}__`;
const EXCLUDED_CODE = `__MRP_GENERATOR_EXCLUDED_${RUN}__`;
const NO_CHANGE_CODE = `__MRP_GENERATOR_NO_CHANGE_${RUN}__`;
const RIGHT_ONLY_CODE = `__MRP_GENERATOR_RIGHT_ONLY_${RUN}__`;
const COMPETITOR = `Generator Competitor ${RUN}`;
const P012_COMPETITOR = `P012 Competitor ${RUN}`;
const P012_CODES = [
  `__MRP_P012_DIVISION_${RUN}__`,
  `__MRP_P012_SERIES_${RUN}__`,
  `__MRP_P012_CATEGORY_${RUN}__`,
  `__MRP_P012_EXPLICIT_${RUN}__`,
] as const;
const DATE = "2020-01-01";
const AS_OF = new Date().toISOString().slice(0, 10);

const testSalesClient = (options: SalesApiClientOptions = {}): SalesApiClient =>
  new SalesApiClient({
    ...options,
    sleep: options.sleep ?? (async () => undefined),
    now: options.now ?? (() => Date.now()),
  });

function authenticatedSalesFixture(): SalesApiClient {
  const coverage = {
    requested: ["2026-04..2026-08"], returned: ["2026-04..2026-08"],
    read_at: "2026-08-01", dataSource: "fixture-before-each",
    held: [], unavailable: [], provisional: [],
  };
  return testSalesClient({
    apiKey: "fixture-authenticated",
    fetch: async (url) => url.includes("sales-by-item")
      ? new Response(JSON.stringify({ coverage, rows: [{
        code: CODE, month_label: "2026-04", fy: "2026-27", qty: 10,
        amount_taxable: 1000, row_count: 1, catalogue_status: "matched",
      }] }))
      : new Response(JSON.stringify({ coverage, rows: [{
        item_code: CODE, month_label: "2026-06", fy: "2026-27", segment: "PTMT",
        qty: 10, sale_value: 1000, bom_value: 100, gross_margin_pct: 0.9,
        mrp: 100, avg_sale: 100, discount_frac: 0,
      }] })),
  });
}

function unavailableSalesFixture(): SalesApiClient {
  return testSalesClient({
    fetch: async () => {
      throw new Error("Sales fixture intentionally unavailable.");
    },
  });
}

function requestAs(role?: "admin" | "user") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => Boolean(role)) as never;
    if (role) {
      req.user = {
        id: `generator-${role}-${RUN}`,
        email: `generator-${role}-${RUN}@example.test`,
        mustChangePassword: false,
        role,
      };
    }
    next();
  });
  app.use("/api", routes);
  return supertest(app);
}

const admin = requestAs("admin");
const user = requestAs("user");
let fixtureBatchId = 0;
let scenarioId = 0;
let rightOnlyScenarioId = 0;
let stage2ScenarioId = 0;
let p011ScenarioId = 0;
let p011CompareScenarioId = 0;
const p012ScenarioIds: number[] = [];
const runIds: number[] = [];
const revisionBatchIds: number[] = [];

async function historyDigest() {
  const result = await db.execute<{ digest: string; count: number }>(sql`
    SELECT md5(COALESCE(string_agg(to_jsonb(h)::text, '|' ORDER BY h.id), '')) AS digest,
           COUNT(*)::int AS count
    FROM mrp_price_history h
    WHERE h.item_code IN (${sql.join([CODE, EXCLUDED_CODE, NO_CHANGE_CODE].map((code) => sql`${code}`), sql`, `)})
  `);
  return result.rows[0]!;
}

beforeAll(async () => {
  fixtureBatchId = await createMrpFixtureBatch("mrp-generator", RUN);
  await db.insert(catalogProductsTable).values([
    { itemCode: CODE, productName: "Generator change", division: "PTMT", category: "Generator test", seriesRange: "Fixture" },
    { itemCode: EXCLUDED_CODE, productName: "Generator excluded", division: "PTMT", category: "Generator test", seriesRange: "Fixture" },
    { itemCode: NO_CHANGE_CODE, productName: "Generator no change", division: "PTMT", category: "Generator test", seriesRange: "Fixture" },
    { itemCode: RIGHT_ONLY_CODE, productName: "Generator right only", division: "PTMT", category: "Generator test", seriesRange: "Fixture" },
    { itemCode: P012_CODES[0], productName: "P012 division", division: "P012-DIVISION", category: "P012", seriesRange: "P012-1" },
    { itemCode: P012_CODES[1], productName: "P012 series", division: "P012-OTHER", category: "P012", seriesRange: "P012-SERIES" },
    { itemCode: P012_CODES[2], productName: "P012 category", division: "P012-OTHER", category: "P012-CATEGORY", seriesRange: "P012-3" },
    { itemCode: P012_CODES[3], productName: "P012 explicit", division: "P012-OTHER", category: "P012", seriesRange: "P012-4" },
  ]);
  await db.insert(mrpPriceHistoryTable).values([
    { itemCode: CODE, mrp: 100, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard", loadBatchId: fixtureBatchId },
    { itemCode: EXCLUDED_CODE, mrp: 100, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard", loadBatchId: fixtureBatchId },
    { itemCode: NO_CHANGE_CODE, mrp: 150, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard", loadBatchId: fixtureBatchId },
    { itemCode: RIGHT_ONLY_CODE, mrp: 120, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard", loadBatchId: fixtureBatchId },
    ...P012_CODES.map((itemCode) => ({ itemCode, mrp: 100, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard", loadBatchId: fixtureBatchId })),
  ]);
  await db.insert(competitorPricesTable).values([
    {
      competitor: COMPETITOR,
      competitorCode: `GEN-${RUN}`,
      price: 200,
      priceBasis: "MRP",
      effectiveDate: DATE,
      matchedPrayagCode: CODE,
      matchStatus: "matched",
    },
    ...P012_CODES.map((matchedPrayagCode, index) => ({
      competitor: P012_COMPETITOR,
      competitorCode: `P012-${RUN}-${index}`,
      price: 120 + index * 10,
      priceBasis: "MRP",
      effectiveDate: DATE,
      matchedPrayagCode,
      matchStatus: "matched",
    })),
    {
      competitor: COMPETITOR,
      competitorCode: `GEN-NOCHANGE-${RUN}`,
      price: 150,
      priceBasis: "MRP",
      effectiveDate: DATE,
      matchedPrayagCode: NO_CHANGE_CODE,
      matchStatus: "matched",
    },
  ]);
});

afterAll(async () => {
  // The dependency order makes this cleanup safe even when an assertion above
  // fails halfway through the scenario.
  const cleanup = async (work: () => Promise<unknown>) => {
    try { await work(); } catch { /* preserve cleanup of independent fixture tables */ }
  };
  if (revisionBatchIds.length) {
    await cleanup(() => db.delete(mrpRevisionRowsTable).where(inArray(mrpRevisionRowsTable.batchId, revisionBatchIds)));
    await cleanup(() => db.delete(mrpRevisionBatchesTable).where(inArray(mrpRevisionBatchesTable.id, revisionBatchIds)));
  }
  if (runIds.length) {
    await cleanup(() => db.delete(mrpGeneratorResultsTable).where(inArray(mrpGeneratorResultsTable.runId, runIds)));
    await cleanup(() => db.delete(mrpGeneratorRunsTable).where(inArray(mrpGeneratorRunsTable.id, runIds)));
  }
  if (scenarioId) await cleanup(() => db.delete(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, scenarioId)));
  if (rightOnlyScenarioId) await cleanup(() => db.delete(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, rightOnlyScenarioId)));
  if (stage2ScenarioId) await cleanup(() => db.delete(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, stage2ScenarioId)));
  if (p011ScenarioId) await cleanup(() => db.delete(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, p011ScenarioId)));
  if (p011CompareScenarioId) await cleanup(() => db.delete(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, p011CompareScenarioId)));
  if (p012ScenarioIds.length) await cleanup(() => db.delete(mrpGeneratorScenariosTable).where(inArray(mrpGeneratorScenariosTable.id, p012ScenarioIds)));
  resetSalesApiClient();
  await cleanup(() => db.delete(competitorPricesTable).where(sql`${competitorPricesTable.competitor} IN (${COMPETITOR}, ${P012_COMPETITOR})`));
  await cleanup(() => db.delete(mrpHistoryProvenanceEventsTable).where(inArray(mrpHistoryProvenanceEventsTable.itemCode, [CODE, EXCLUDED_CODE, NO_CHANGE_CODE, RIGHT_ONLY_CODE, ...P012_CODES])));
  await cleanup(() => db.delete(mrpPriceHistoryTable).where(inArray(mrpPriceHistoryTable.itemCode, [CODE, EXCLUDED_CODE, NO_CHANGE_CODE, RIGHT_ONLY_CODE, ...P012_CODES])));
  await cleanup(() => deleteMrpFixtureBatch(fixtureBatchId));
  await cleanup(() => db.delete(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, [CODE, EXCLUDED_CODE, NO_CHANGE_CODE, RIGHT_ONLY_CODE, ...P012_CODES])));
});

beforeEach(({ task }) => {
  const authenticated = task.name.includes("Stage 2") || task.name.includes("P011");
  setSalesApiClientForTests(authenticated ? authenticatedSalesFixture() : unavailableSalesFixture());
});

afterEach(() => {
  resetSalesApiClient();
});

describe("MRP Generator HTTP contract and safety", () => {
  it("returns 403 for non-admin reads and writes", async () => {
    const responses = await Promise.all([
      user.get("/api/mrp-generator/metadata"),
      user.get("/api/mrp-generator/scopes"),
      user.get("/api/mrp-generator/freshness"),
      user.get("/api/mrp-generator/scenarios"),
      user.get("/api/mrp-generator/scenarios/999999"),
      user.post("/api/mrp-generator/scenarios").send({ name: "nope", rules: [{ type: "match", competitor: COMPETITOR }] }),
      user.patch("/api/mrp-generator/scenarios/999999").send({ name: "nope" }),
      user.delete("/api/mrp-generator/scenarios/999999"),
      user.post("/api/mrp-generator/scenarios/999999/run").send({ asOf: AS_OF }),
      user.get("/api/mrp-generator/runs"),
      user.get("/api/mrp-generator/runs/999999"),
      user.get("/api/mrp-generator/runs/999999/results"),
      user.get("/api/mrp-generator/compare?leftRunId=1&rightRunId=2"),
      user.post("/api/mrp-generator/runs/999999/handoff").send({ itemCodes: [CODE] }),
    ]);
    expect(responses.every((response) => response.status === 403)).toBe(true);
  });

  it("creates a scenario, runs it twice deterministically, and exposes stale source metadata", async () => {
    const metadata = await admin.get("/api/mrp-generator/metadata");
    expect(metadata.status).toBe(200);
    expect(metadata.body.disabledRules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "margin_floor",
        configurationSummary: expect.stringContaining("PTMT 65%"),
      }),
      expect.objectContaining({
        type: "volume_tier",
        configurationSummary: expect.stringContaining("cumulative sales-value contribution"),
      }),
    ]));
    expect(JSON.stringify(metadata.body.disabledRules)).not.toContain("percentile");

    const disabled = await admin.post("/api/mrp-generator/scenarios").send({
      name: `Generator disabled ${RUN}`,
      rules: [{ type: "margin_floor", percent: 45 }],
    });
    expect(disabled.status).toBe(400);
    expect(disabled.body.error).toContain("unavailable");

    const created = await admin.post("/api/mrp-generator/scenarios").send({
      name: `Generator fixture ${RUN}`,
      description: "route integration fixture",
      scope: { explicitCodes: [CODE, EXCLUDED_CODE, NO_CHANGE_CODE] },
      rules: [{ type: "match", competitor: COMPETITOR }],
    });
    expect(created.status).toBe(201);
    scenarioId = created.body.id;
    expect(created.body).toEqual(expect.objectContaining({
      id: scenarioId,
      policyVersion: 1,
      name: `Generator fixture ${RUN}`,
      scope: { explicitCodes: [CODE, EXCLUDED_CODE, NO_CHANGE_CODE] },
      rules: [{ type: "match", competitor: COMPETITOR }],
    }));
    const listedLegacy = await admin.get("/api/mrp-generator/scenarios");
    const listedLegacyScenario = listedLegacy.body.find((row: any) => row.id === scenarioId);
    expect(listedLegacyScenario).toEqual(expect.objectContaining({ policyVersion: 1, policy: null }));
    const fetchedLegacy = await admin.get(`/api/mrp-generator/scenarios/${scenarioId}`);
    expect(fetchedLegacy.body).toEqual(expect.objectContaining({ policyVersion: 1, policy: null }));
    const disabledPatch = await admin.patch(`/api/mrp-generator/scenarios/${scenarioId}`).send({
      rules: [{ type: "volume_tier", tier: "top" }],
    });
    expect(disabledPatch.status).toBe(400);
    expect(disabledPatch.body.error).toContain("unavailable");

    const before = await historyDigest();
    const first = await admin.post(`/api/mrp-generator/scenarios/${scenarioId}/run`).send({ asOf: AS_OF });
    const second = await admin.post(`/api/mrp-generator/scenarios/${scenarioId}/run`).send({ asOf: AS_OF });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.policyVersion).toBe(1);
    runIds.push(first.body.runId, second.body.runId);
    expect(first.body.inputFingerprint).toBe(second.body.inputFingerprint);

    const firstDetail = await admin.get(`/api/mrp-generator/runs/${first.body.runId}`);
    const secondResults = await admin.get(`/api/mrp-generator/runs/${second.body.runId}/results`);
    expect(firstDetail.status).toBe(200);
    expect(secondResults.status).toBe(200);
    const firstComparable = firstDetail.body.results.map((row: any) => ({ itemCode: row.itemCode, suggestedMrp: row.suggestedMrp, status: row.status, trace: row.trace }));
    const secondComparable = secondResults.body.results.map((row: any) => ({ itemCode: row.itemCode, suggestedMrp: row.suggestedMrp, status: row.status, trace: row.trace }));
    expect(firstComparable).toEqual(secondComparable);
    expect(firstDetail.body.results.find((row: any) => row.itemCode === EXCLUDED_CODE)).toEqual(expect.objectContaining({ status: "excluded", suggestedMrp: null }));
    expect(firstDetail.body.results.find((row: any) => row.itemCode === CODE)).toEqual(expect.objectContaining({ status: "suggested", suggestedMrp: 200 }));
    expect(firstDetail.body.results.find((row: any) => row.itemCode === CODE).competitorValues[0]).toEqual(expect.objectContaining({ stale: true }));
    expect(firstDetail.body.results.find((row: any) => row.itemCode === CODE).competitorValues[0].ageDays).toBeGreaterThanOrEqual(548);

    const history = await historyDigest();
    expect(history).toEqual(before);
    const freshness = await admin.get(`/api/mrp-generator/freshness?asOf=${AS_OF}`);
    expect(freshness.status).toBe(200);
    expect(freshness.body.competitors).toEqual(expect.arrayContaining([
      expect.objectContaining({ competitor: COMPETITOR, stale: true }),
    ]));

    const historyList = await admin.get(`/api/mrp-generator/runs?scenarioId=${scenarioId}&limit=10`);
    expect(historyList.status).toBe(200);
    expect(historyList.body.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.body.runId, scenarioName: `Generator fixture ${RUN}` }),
      expect.objectContaining({ id: second.body.runId, scenarioName: `Generator fixture ${RUN}` }),
    ]));

    const rightScenario = await admin.post("/api/mrp-generator/scenarios").send({
      name: `Generator right-only ${RUN}`,
      scope: { explicitCodes: [RIGHT_ONLY_CODE] },
      rules: [{ type: "match", competitor: COMPETITOR }],
    });
    rightOnlyScenarioId = rightScenario.body.id;
    const rightRun = await admin.post(`/api/mrp-generator/scenarios/${rightOnlyScenarioId}/run`).send({ asOf: AS_OF });
    expect(rightRun.status).toBe(201);
    runIds.push(rightRun.body.runId);
    const comparison = await admin.get(`/api/mrp-generator/compare?leftRunId=${first.body.runId}&rightRunId=${rightRun.body.runId}`);
    expect(comparison.status).toBe(200);
    expect(comparison.body.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemCode: RIGHT_ONLY_CODE, left: null, right: expect.any(Object) }),
    ]));
    const missingLeft = await admin.get(`/api/mrp-generator/compare?leftRunId=999999999&rightRunId=${rightRun.body.runId}`);
    expect(missingLeft.status).toBe(404);
    expect(missingLeft.body.error).toContain("999999999");
    const missingBoth = await admin.get("/api/mrp-generator/compare?leftRunId=999999998&rightRunId=999999999");
    expect(missingBoth.status).toBe(404);
    expect(missingBoth.body.error).toContain("999999998");
    expect(missingBoth.body.error).toContain("999999999");

    // Converting the mutable scenario after a legacy run must not rewrite
    // immutable run metadata or make a legacy run appear to have a policy.
    const converted = await admin.patch(`/api/mrp-generator/scenarios/${scenarioId}`).send({
      policyVersion: 2,
      policy: {
        policyVersion: 2, period: "2026-27", maxIncreasePercent: 0,
        competitor: { mode: "nearest", staleAfterDays: 365, excludeStale: false },
      },
    });
    expect(converted.status).toBe(200);
    const legacyAfterConversion = await admin.get(`/api/mrp-generator/runs/${first.body.runId}`);
    expect(legacyAfterConversion.body).toEqual(expect.objectContaining({
      policyVersion: 1,
      policy: null,
    }));
    expect(legacyAfterConversion.body.run.inputSnapshot.policyVersion).toBe(1);
    const restored = await admin.patch(`/api/mrp-generator/scenarios/${scenarioId}`).send({
      rules: [{ type: "match", competitor: COMPETITOR }],
    });
    expect(restored.status).toBe(200);
  });

  it("hands off only eligible suggestions to a pending revision with provenance", async () => {
    const run = await admin.post(`/api/mrp-generator/scenarios/${scenarioId}/run`).send({ asOf: AS_OF });
    runIds.push(run.body.runId);
    const before = await historyDigest();
    const handoff = await admin.post(`/api/mrp-generator/runs/${run.body.runId}/handoff`).send({ itemCodes: [` ${CODE} `] });
    expect(handoff.status).toBe(201);
    revisionBatchIds.push(handoff.body.batchId);
    const batch = (await db.select().from(mrpRevisionBatchesTable).where(eq(mrpRevisionBatchesTable.id, handoff.body.batchId)))[0]!;
    expect(batch).toEqual(expect.objectContaining({ status: "preview", scenarioId, runId: run.body.runId, lockedEffectiveDate: DATE }));
    const rows = await db.select().from(mrpRevisionRowsTable).where(eq(mrpRevisionRowsTable.batchId, handoff.body.batchId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ itemCode: CODE, effectiveDate: DATE, outcome: "change", newValue: 200 }));
    expect(await historyDigest()).toEqual(before);

    // A preview is never allowed to carry a stale source value forward.
    await db.update(mrpPriceHistoryTable).set({ mrp: 101 }).where(eq(mrpPriceHistoryTable.id, rows[0]!.targetRowId!));
    const stale = await admin.post(`/api/mrp-generator/runs/${run.body.runId}/handoff`).send({ itemCodes: [CODE] });
    await db.update(mrpPriceHistoryTable).set({ mrp: 100 }).where(eq(mrpPriceHistoryTable.id, rows[0]!.targetRowId!));
    expect(stale.status).toBe(409);

    await db.update(mrpPriceHistoryTable).set({ mrp: 101 }).where(eq(mrpPriceHistoryTable.id, rows[0]!.targetRowId!));
    const staleApply = await admin.post(`/api/catalog/mrp-revisions/${handoff.body.batchId}/apply`).send({ acknowledgeWarnings: true });
    await db.update(mrpPriceHistoryTable).set({ mrp: 100 }).where(eq(mrpPriceHistoryTable.id, rows[0]!.targetRowId!));
    expect(staleApply.status).toBe(409);

    const excluded = await admin.post(`/api/mrp-generator/runs/${run.body.runId}/handoff`).send({ itemCodes: [EXCLUDED_CODE] });
    const noChange = await admin.post(`/api/mrp-generator/runs/${run.body.runId}/handoff`).send({ itemCodes: [NO_CHANGE_CODE] });
    expect(excluded.status).toBe(409);
    expect(noChange.status).toBe(409);

    const futureRun = await admin.post(`/api/mrp-generator/scenarios/${scenarioId}/run`).send({ asOf: "2999-01-01" });
    expect(futureRun.status).toBe(201);
    runIds.push(futureRun.body.runId);
    const futureHandoff = await admin.post(`/api/mrp-generator/runs/${futureRun.body.runId}/handoff`).send({ itemCodes: [CODE] });
    expect(futureHandoff.status).toBe(409);
    expect(futureHandoff.body.error).toContain("Future-dated");
  });

  it("bootstraps authenticated Stage 2 metadata/save/run and invalidates rejected credentials", async () => {
    const unauthorized = testSalesClient({
      apiKey: "revoked",
      fetch: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    });
    setSalesApiClientForTests(unauthorized);
    const rejected = await admin.get("/api/mrp-generator/metadata");
    expect(rejected.status).toBe(200);
    expect(rejected.body.salesApi).toEqual(expect.objectContaining({ status: "auth_failed", available: false }));
    expect(rejected.body.stage).toBe(1);

    const coverage = {
      requested: ["2026-04..2026-08"], returned: ["2026-04..2026-08"],
      read_at: "2026-08-01", dataSource: "fixture-sales",
      held: null, unavailable: [], provisional: false,
    };
    const fixtureSales = testSalesClient({
      apiKey: "valid",
      fetch: async (url) => url.includes("sales-by-item")
        ? new Response(JSON.stringify({ coverage, rows: [{
          code: CODE, month_label: "2026-04", fy: "2026-27", qty: 10,
          amount_taxable: 1000, row_count: 1, catalogue_status: "matched",
        }] }))
        : new Response(JSON.stringify({ coverage, rows: [{
          item_code: CODE, month_label: "2026-06", fy: "2026-27", segment: "PTMT",
          qty: 10, sale_value: 1000, bom_value: 100, gross_margin_pct: 0.9,
          mrp: 100, avg_sale: 100, discount_frac: 0,
        }] })),
    });
    setSalesApiClientForTests(fixtureSales);
    const metadata = await admin.get("/api/mrp-generator/metadata");
    expect(metadata.body.stage).toBe(2);
    expect(metadata.body.salesApi.status).toBe("authenticated");
    const created = await admin.post("/api/mrp-generator/scenarios").send({
      name: `Generator Stage 2 ${RUN}`,
      scope: { explicitCodes: [CODE] },
      rules: [{ type: "margin_floor", categoryFloors: { PTMT: 50 } }, {
        type: "volume_tier", period: "2026-27", mode: "cumulative", tier: "A", cumulativeValuePercent: 80,
      }],
    });
    expect(created.status).toBe(201);
    stage2ScenarioId = created.body.id;
    const first = await admin.post(`/api/mrp-generator/scenarios/${stage2ScenarioId}/run`).send({ asOf: AS_OF });
    const second = await admin.post(`/api/mrp-generator/scenarios/${stage2ScenarioId}/run`).send({ asOf: AS_OF });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    runIds.push(first.body.runId, second.body.runId);
    expect(first.body.inputFingerprint).toBe(second.body.inputFingerprint);
    expect(first.body.sourceFreshness.coverageSummary).toEqual(expect.objectContaining({
      periods: expect.objectContaining({ sales: expect.any(Object), margin: expect.any(Object) }),
    }));
    expect(first.body.sourceFreshness.knownLimits).toEqual(expect.objectContaining({ pageLimit: 500, maxRestarts: 2 }));
    const detail = await admin.get(`/api/mrp-generator/runs/${first.body.runId}`);
    expect(detail.body.results[0]).toEqual(expect.objectContaining({
      salesEvidence: expect.objectContaining({ qty: 10 }),
      marginEvidence: expect.objectContaining({ unitBomValue: 10 }),
    }));
  });

  it("runs and persists a P011 policy once against an injected Sales snapshot without writing MRP history", async () => {
    const coverage = {
      requested: ["2026-04..2026-08"], returned: ["2026-04..2026-08"],
      read_at: "2026-08-01", dataSource: "fixture-p011",
      held: [], unavailable: [], provisional: [],
    };
    setSalesApiClientForTests(testSalesClient({
      apiKey: "valid-p011",
      fetch: async (url) => url.includes("sales-by-item")
        ? new Response(JSON.stringify({ coverage, rows: [{
          code: CODE, month_label: "2026-04", fy: "2026-27", qty: 10,
          amount_taxable: 1000, row_count: 1, catalogue_status: "matched",
        }] }))
        : new Response(JSON.stringify({ coverage, rows: [{
          item_code: CODE, month_label: "2026-06", fy: "2026-27", segment: "PTMT",
          qty: 10, sale_value: 1000, bom_value: 100, gross_margin_pct: 0.9,
          mrp: 100, avg_sale: 100, discount_frac: 0,
        }] })),
    }));
    const before = await historyDigest();
    const created = await admin.post("/api/mrp-generator/scenarios").send({
      name: `Generator P011 ${RUN}`,
      policyVersion: 2,
      policy: {
        policyVersion: 2, period: "2026-27",
        competitor: { mode: "nearest", staleAfterDays: 365, excludeStale: true },
      },
      scope: { explicitCodes: [CODE] },
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({
      version: 2, policyVersion: 2, policy: expect.objectContaining({ policyVersion: 2 }),
    }));
    p011ScenarioId = created.body.id;
    const listed = await admin.get("/api/mrp-generator/scenarios");
    expect(listed.body.find((row: any) => row.id === p011ScenarioId)).toEqual(expect.objectContaining({ policyVersion: 2 }));
    const fetched = await admin.get(`/api/mrp-generator/scenarios/${p011ScenarioId}`);
    expect(fetched.body).toEqual(expect.objectContaining({ policyVersion: 2, rules: [] }));
    const patched = await admin.patch(`/api/mrp-generator/scenarios/${p011ScenarioId}`).send({
      policyVersion: 2,
      policy: { period: "2026-27", competitor: { mode: "nearest", staleAfterDays: 365, excludeStale: true } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toEqual(expect.objectContaining({ policyVersion: 2, rules: [] }));
    const harmlessEmptyRules = await admin.patch(`/api/mrp-generator/scenarios/${p011ScenarioId}`).send({
      policyVersion: 2,
      policy: { period: "2026-27", competitor: { mode: "nearest", staleAfterDays: 365, excludeStale: true } },
      rules: [],
    });
    expect(harmlessEmptyRules.status).toBe(200);
    const mixed = await admin.patch(`/api/mrp-generator/scenarios/${p011ScenarioId}`).send({
      policyVersion: 2,
      policy: { period: "2026-27", competitor: { mode: "nearest", staleAfterDays: 365, excludeStale: true } },
      rules: [{ type: "match", competitor: COMPETITOR }],
    });
    expect(mixed.status).toBe(400);
    const first = await admin.post(`/api/mrp-generator/scenarios/${p011ScenarioId}/run`).send({ asOf: AS_OF });
    const second = await admin.post(`/api/mrp-generator/scenarios/${p011ScenarioId}/run`).send({ asOf: AS_OF });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.policyVersion).toBe(2);
    runIds.push(first.body.runId, second.body.runId);
    expect(first.body.inputFingerprint).toBe(second.body.inputFingerprint);
    expect(first.body.summary).toEqual(expect.objectContaining({
      policyVersion: 2,
      actionCounts: expect.objectContaining({ MARGIN_ONLY: 1 }),
      bandDistribution: expect.objectContaining({ E: 1 }),
    }));
    const mutatedScenario = await admin.patch(`/api/mrp-generator/scenarios/${p011ScenarioId}`).send({
      policyVersion: 2,
      policy: {
        policyVersion: 2, period: "2026-27", maxIncreasePercent: 0,
        competitor: { mode: "nearest", staleAfterDays: 365, excludeStale: false },
      },
    });
    expect(mutatedScenario.status).toBe(200);
    const detail = await admin.get(`/api/mrp-generator/runs/${first.body.runId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(expect.objectContaining({
      policyVersion: 2,
      policy: expect.objectContaining({ policyVersion: 2, maxIncreasePercent: 15 }),
      scenario: expect.objectContaining({
        policyVersion: 2,
        policy: expect.objectContaining({ policyVersion: 2, maxIncreasePercent: 15 }),
      }),
    }));
    expect(detail.body.run.inputSnapshot.policyVersion).toBe(2);
    expect(detail.body.results[0]).toEqual(expect.objectContaining({
      policyVersion: 2, band: "E", action: "MARGIN_ONLY",
    }));
    const compareCreated = await admin.post("/api/mrp-generator/scenarios").send({
      name: `Generator P011 compare ${RUN}`,
      policyVersion: 2,
      policy: {
        policyVersion: 2, period: "2026-27", maxIncreasePercent: 0,
        competitor: { mode: "nearest", staleAfterDays: 365, excludeStale: false },
      },
      scope: { explicitCodes: [CODE] },
    });
    expect(compareCreated.status).toBe(201);
    p011CompareScenarioId = compareCreated.body.id;
    const compareRun = await admin.post(`/api/mrp-generator/scenarios/${p011CompareScenarioId}/run`).send({ asOf: AS_OF });
    expect(compareRun.status).toBe(201);
    runIds.push(compareRun.body.runId);
    const compare = await admin.get(`/api/mrp-generator/compare?leftRunId=${first.body.runId}&rightRunId=${compareRun.body.runId}`);
    expect(compare.status).toBe(200);
    expect(compare.body).toEqual(expect.objectContaining({ leftPolicyVersion: 2, rightPolicyVersion: 2 }));
    expect(compare.body.leftPolicy).toEqual(expect.objectContaining({ policyVersion: 2, maxIncreasePercent: 15 }));
    expect(compare.body.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemCode: CODE,
        left: expect.objectContaining({ action: "MARGIN_ONLY", suggestedMrp: null }),
        right: expect.objectContaining({ action: "HOLD", suggestedMrp: null }),
      }),
    ]));
    expect(await historyDigest()).toEqual(before);
  });

  it("P012 supplies one idempotent default, edits in place, duplicates, and resets exactly", async () => {
    const first = await admin.get("/api/mrp-generator/scenarios");
    const second = await admin.get("/api/mrp-generator/scenarios");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const defaults = second.body.filter((row: any) => row.name === "Match competition, stay below");
    expect(defaults).toHaveLength(1);
    expect(defaults[0]).toEqual(expect.objectContaining({
      policyVersion: 3,
      description: "Starting point. Edit freely -- it explains itself as you change it.",
      scope: { competitorMapped: true },
      simplePolicy: expect.objectContaining({
        holdBelow: 50, marginEnabled: false, volumeEnabled: false,
        rows: [expect.objectContaining({ order: 1, catchAll: true })],
      }),
    }));
    const forged = await admin.post("/api/mrp-generator/scenarios").send({
      name: "Match competition, stay below", policyVersion: 3,
      simplePolicy: defaults[0].simplePolicy,
    });
    expect(forged.status).toBe(409);
    const id = defaults[0].id;
    const edited = await admin.patch(`/api/mrp-generator/scenarios/${id}`).send({
      name: `P012 edited ${RUN}`,
      simplePolicy: {
        ...defaults[0].simplePolicy,
        rows: defaults[0].simplePolicy.rows.map((row: any) => ({ ...row, label: "Edited row" })),
      },
      policyVersion: 3,
    });
    expect(edited.status).toBe(200);
    const afterEdit = await admin.get("/api/mrp-generator/scenarios");
    expect(afterEdit.body.filter((row: any) => row.name === `P012 edited ${RUN}`)).toHaveLength(1);
    expect(afterEdit.body.filter((row: any) => row.name === "Match competition, stay below")).toHaveLength(0);
    const copy = await admin.post(`/api/mrp-generator/scenarios/${id}/duplicate`).send();
    expect(copy.status).toBe(201);
    expect(copy.body.name).toBe(`P012 edited ${RUN} copy`);
    expect(copy.body.isDefault).toBe(false);
    expect((await admin.post(`/api/mrp-generator/scenarios/${copy.body.id}/reset`)).status).toBe(409);
    p012ScenarioIds.push(copy.body.id);
    const reset = await admin.post(`/api/mrp-generator/scenarios/${id}/reset`).send();
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual(expect.objectContaining({
      name: "Match competition, stay below",
      description: "Starting point. Edit freely -- it explains itself as you change it.",
      policyVersion: 3,
      simplePolicy: expect.objectContaining({ holdBelow: 50, marginEnabled: false, volumeEnabled: false }),
    }));
    const runnable = await admin.post(`/api/mrp-generator/scenarios/${id}/run`).send({ asOf: AS_OF });
    expect(runnable.status).toBe(201);
    runIds.push(runnable.body.runId);
    p012ScenarioIds.push(id);
  });

  it("P012 runs competitively during a Sales outage, reports four-row reach and named no-fallthrough", async () => {
    const created = await admin.post("/api/mrp-generator/scenarios").send({
      name: `P012 four rows ${RUN}`,
      scope: { explicitCodes: [...P012_CODES] },
      policyVersion: 3,
      simplePolicy: {
        policyVersion: 3, mode: "simple", holdBelow: 50,
        rounding: { unit: 1, direction: "nearest" }, marginEnabled: false, volumeEnabled: false,
        rows: [
          { id: "division", order: 1, label: "Division first", competitor: { mode: "nearest" }, appliesTo: { type: "division", value: "P012-DIVISION" }, target: { mode: "below", percent: 5 }, maxIncrease: 15, maxDecrease: 5 },
          { id: "series", order: 2, label: "Series second", competitor: { mode: "nearest" }, appliesTo: { type: "series", value: "P012-SERIES" }, target: { mode: "match" }, maxIncrease: 15, maxDecrease: 5 },
          { id: "category", order: 3, label: "Category third", competitor: { mode: "nearest" }, appliesTo: { type: "category", value: "P012-CATEGORY" }, target: { mode: "above", percent: 2 }, maxIncrease: 15, maxDecrease: 5 },
          { id: "all", order: 4, label: "Catch all", competitor: { mode: "lowest" }, appliesTo: { type: "all" }, target: { mode: "close_gap", percent: 50 }, catchAll: true },
        ],
      },
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    p012ScenarioIds.push(id);
    const run = await admin.post(`/api/mrp-generator/scenarios/${id}/run`).send({ asOf: AS_OF });
    expect(run.status).toBe(201);
    expect(run.body).toEqual(expect.objectContaining({
      policyVersion: 3,
      summary: expect.objectContaining({
        evaluated: 4, wouldChange: 4, noCompetitorUntouched: 0, fallthroughUntouched: 0,
        rowCounts: {
          division: expect.objectContaining({ scopeMatched: 1, withCompetitorPrice: 1, wouldChange: 1 }),
          series: expect.objectContaining({ scopeMatched: 1, withCompetitorPrice: 1, wouldChange: 1 }),
          category: expect.objectContaining({ scopeMatched: 1, withCompetitorPrice: 1, wouldChange: 1 }),
          all: expect.objectContaining({ scopeMatched: 1, withCompetitorPrice: 1, wouldChange: 1 }),
        },
      }),
    }));
    runIds.push(run.body.runId);
    const detail = await admin.get(`/api/mrp-generator/runs/${run.body.runId}`);
    expect(detail.body.results.map((row: any) => row.matchedRowNumber).sort()).toEqual([1, 2, 3, 4]);
    const named = await admin.post("/api/mrp-generator/scenarios").send({
      name: `P012 named missing ${RUN}`,
      scope: { explicitCodes: [P012_CODES[0]] },
      policyVersion: 3,
      simplePolicy: {
        ...created.body.simplePolicy,
        rows: [
          { id: "named", order: 1, label: "Missing named", competitor: { mode: "named", name: "Not loaded" }, appliesTo: { type: "all" }, target: { mode: "match" } },
          { id: "fallback", order: 2, label: "Should not fire", competitor: { mode: "lowest" }, appliesTo: { type: "all" }, target: { mode: "below", percent: 5 }, catchAll: true },
        ],
      },
    });
    expect(named.status).toBe(201);
    p012ScenarioIds.push(named.body.id);
    const namedRun = await admin.post(`/api/mrp-generator/scenarios/${named.body.id}/run`).send({ asOf: AS_OF });
    expect(namedRun.status).toBe(201);
    runIds.push(namedRun.body.runId);
    expect(namedRun.body.summary).toEqual(expect.objectContaining({ noCompetitorUntouched: 1, wouldChange: 0 }));
    const namedDetail = await admin.get(`/api/mrp-generator/runs/${namedRun.body.runId}`);
    expect(namedDetail.body.results[0]).toEqual(expect.objectContaining({ matchedRowNumber: 1, selectedCompetitorPrice: null, suggestedMrp: 100 }));
  });

  it("P012 warns and counts fallthrough, previews without writes, and keeps optional options typed", async () => {
    const noCatchAll = {
      policyVersion: 3, mode: "simple", holdBelow: 50, rounding: { unit: 1, direction: "nearest" },
      marginEnabled: false, volumeEnabled: false,
      rows: [{ id: "division-only", order: 1, label: "Only division", competitor: { mode: "nearest" }, appliesTo: { type: "division", value: "P012-DIVISION" }, target: { mode: "below", percent: 5 } }],
    };
    const beforeRuns = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM mrp_generator_runs`);
    const beforeResults = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM mrp_generator_results`);
    const beforeHistory = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM mrp_price_history`);
    const preview = await admin.post("/api/mrp-generator/scenarios/preview").send({
      simplePolicy: noCatchAll, scope: { explicitCodes: [...P012_CODES] }, asOf: AS_OF, limit: 2,
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      preview: true, evidence: expect.any(Array),
      warnings: [expect.stringContaining("No catch-all")],
      summary: expect.objectContaining({ fallthroughUntouched: 3 }),
    }));
    const afterRuns = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM mrp_generator_runs`);
    const afterResults = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM mrp_generator_results`);
    const afterHistory = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM mrp_price_history`);
    expect(afterRuns.rows[0]!.count).toBe(beforeRuns.rows[0]!.count);
    expect(afterResults.rows[0]!.count).toBe(beforeResults.rows[0]!.count);
    expect(afterHistory.rows[0]!.count).toBe(beforeHistory.rows[0]!.count);
    for (const [name, option] of [["margin", true], ["volume", false]] as const) {
      const response = await admin.post("/api/mrp-generator/scenarios/preview").send({
        simplePolicy: { ...noCatchAll, marginEnabled: name === "margin", volumeEnabled: name === "volume" },
        scope: { explicitCodes: [P012_CODES[0]] },
      });
      expect(response.status).toBe(503);
      expect(response.body).toEqual(expect.objectContaining({ option: name, code: `${name}_evidence_unavailable` }));
      void option;
    }
  });

  it("retrieves margin and volume options independently when the opposite Sales endpoint is down", async () => {
    const coverage = {
      requested: ["2026-04..2026-08"], returned: ["2026-04..2026-08"],
      read_at: "2026-08-01", dataSource: "independent-fixture", held: [], unavailable: [], provisional: [],
    };
    setSalesApiClientForTests(testSalesClient({
      apiKey: "independent-fixture",
      fetch: async (url) => {
        if (url.includes("sales-by-item")) throw new Error("sales endpoint down");
        return new Response(JSON.stringify({ coverage, rows: [{
          item_code: P012_CODES[0], month_label: "2026-06", fy: "2026-27", segment: "PTMT",
          qty: 10, sale_value: 1000, bom_value: 100, gross_margin_pct: 0.9,
          mrp: 100, avg_sale: 100, discount_frac: 0,
        }] }));
      },
    }));
    const marginScenario = await admin.post("/api/mrp-generator/scenarios").send({
      name: `P012 margin independent ${RUN}`, scope: { explicitCodes: [P012_CODES[0]] }, policyVersion: 3,
      simplePolicy: {
        ...DEFAULT_P012_SCENARIO.policy, marginEnabled: true,
        rows: [{ ...DEFAULT_P012_SCENARIO.policy.rows[0]!, appliesTo: { type: "all" } }],
      },
    });
    expect(marginScenario.status).toBe(201);
    p012ScenarioIds.push(marginScenario.body.id);
    const marginRun = await admin.post(`/api/mrp-generator/scenarios/${marginScenario.body.id}/run`).send({ asOf: AS_OF });
    expect(marginRun.status).toBe(201);
    runIds.push(marginRun.body.runId);

    setSalesApiClientForTests(testSalesClient({
      apiKey: "independent-fixture",
      fetch: async (url) => {
        if (url.includes("margin-by-item")) throw new Error("margin endpoint down");
        return new Response(JSON.stringify({ coverage, rows: [{
          code: P012_CODES[0], month_label: "2026-04", fy: "2026-27", qty: 10,
          amount_taxable: 1000, row_count: 1, catalogue_status: "matched",
        }] }));
      },
    }));
    const volumeScenario = await admin.post("/api/mrp-generator/scenarios").send({
      name: `P012 volume independent ${RUN}`, scope: { explicitCodes: [P012_CODES[0]] }, policyVersion: 3,
      simplePolicy: {
        ...DEFAULT_P012_SCENARIO.policy, volumeEnabled: true,
        rows: [{ ...DEFAULT_P012_SCENARIO.policy.rows[0]!, appliesTo: { type: "all" } }],
      },
    });
    expect(volumeScenario.status).toBe(201);
    p012ScenarioIds.push(volumeScenario.body.id);
    const volumeRun = await admin.post(`/api/mrp-generator/scenarios/${volumeScenario.body.id}/run`).send({ asOf: AS_OF });
    expect(volumeRun.status).toBe(201);
    runIds.push(volumeRun.body.runId);
  });

  it("P012 promotion is lossless, demotion refuses unrelated Advanced, and repeated runs do not write MRPs", async () => {
    const created = await admin.post("/api/mrp-generator/scenarios").send({
      name: `P012 promotion ${RUN}`, scope: { explicitCodes: [P012_CODES[0]] }, policyVersion: 3, simplePolicy: {
        policyVersion: 3, mode: "simple", holdBelow: 50, rounding: { unit: 1, direction: "nearest" },
        marginEnabled: false, volumeEnabled: false,
        rows: [{ id: "stable-row", order: 1, label: "Stable row", competitor: { mode: "nearest" }, appliesTo: { type: "all" }, target: { mode: "below", percent: 5 }, maxIncrease: 15, maxDecrease: 5, catchAll: true }],
      },
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    p012ScenarioIds.push(id);
    const unsavedPolicy = {
      ...created.body.simplePolicy,
      rows: [{ ...created.body.simplePolicy.rows[0], label: "Unsaved edit" }],
    };
    const unsavedPromotion = await admin.post(`/api/mrp-generator/scenarios/${id}/promote`).send({ simplePolicy: unsavedPolicy });
    expect(unsavedPromotion.status).toBe(200);
    expect(unsavedPromotion.body.unsaved).toBe(true);
    expect(unsavedPromotion.body.advanced.simpleRows[0].label).toBe("Unsaved edit");
    const beforeSave = await admin.get(`/api/mrp-generator/scenarios/${id}`);
    expect(beforeSave.body.simplePolicy.rows[0].label).toBe("Stable row");
    const promoted = await admin.post(`/api/mrp-generator/scenarios/${id}/promote`);
    expect(promoted.status).toBe(200);
    expect(promoted.body.advanced.simpleRows[0]).toEqual(expect.objectContaining({ id: "stable-row", label: "Stable row" }));
    const promotedStored = await admin.get(`/api/mrp-generator/scenarios/${id}`);
    expect(promotedStored.body.advanced.simpleRows).toEqual(promoted.body.advanced.simpleRows);
    const storedBeforeDemotion = await db.select({ rules: mrpGeneratorScenariosTable.rules, version: mrpGeneratorScenariosTable.version })
      .from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id));
    const refusedPayload = await admin.post(`/api/mrp-generator/scenarios/${id}/demote`).send({
      advancedPolicy: {
        ...promoted.body.advanced,
        simpleRows: promoted.body.advanced.simpleRows.map((row: any) => ({ ...row, label: "changed" })),
      },
    });
    expect(refusedPayload.status).toBe(409);
    const demoted = await admin.post(`/api/mrp-generator/scenarios/${id}/demote`);
    expect(demoted.status).toBe(200);
    expect(demoted.body.simplePolicy.rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: "stable-row" })]));
    const storedAfterDemotion = await db.select({ rules: mrpGeneratorScenariosTable.rules, version: mrpGeneratorScenariosTable.version })
      .from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id));
    expect(storedAfterDemotion).toEqual(storedBeforeDemotion);
    const before = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM mrp_price_history`);
    const first = await admin.post(`/api/mrp-generator/scenarios/${id}/run`).send({ asOf: AS_OF });
    const second = await admin.post(`/api/mrp-generator/scenarios/${id}/run`).send({ asOf: AS_OF });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.inputFingerprint).toBe(second.body.inputFingerprint);
    runIds.push(first.body.runId, second.body.runId);
    const after = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM mrp_price_history`);
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    const refused = await admin.patch(`/api/mrp-generator/scenarios/${id}`).send({
      policyVersion: 2, policy: { policyVersion: 2, period: "2026-27", portfolio: { mode: "improve_by_points", points: 1 } },
    });
    expect(refused.status).toBe(200);
    const beforeRefusal = await admin.get(`/api/mrp-generator/scenarios/${id}`);
    const advancedRefusal = await admin.post(`/api/mrp-generator/scenarios/${id}/demote`);
    expect(advancedRefusal.status).toBe(409);
    const afterRefusal = await admin.get(`/api/mrp-generator/scenarios/${id}`);
    expect(afterRefusal.body.rules).toEqual(beforeRefusal.body.rules);
    expect(afterRefusal.body.policy).toEqual(beforeRefusal.body.policy);
  });

  it("creates and patches typed P012 advancedPolicy without treating it as native P011", async () => {
    const source = promoteP012ToAdvanced(DEFAULT_P012_SCENARIO.policy);
    const created = await admin.post("/api/mrp-generator/scenarios").send({
      name: `P012 typed advanced ${RUN}`, scope: { explicitCodes: [P012_CODES[0]] },
      policyVersion: 2, advancedPolicy: source,
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    p012ScenarioIds.push(id);
    expect(created.body.policyVersion).toBe(2);
    expect(created.body.policy).toBeNull();
    expect(created.body.advancedPolicy).toEqual(expect.objectContaining({ source: "p012-simple", simpleRows: source.simpleRows }));
    const patched = await admin.patch(`/api/mrp-generator/scenarios/${id}`).send({
      policyVersion: 2,
      advancedPolicy: { ...source, categoryFloors: { PTMT: 60 } },
    });
    expect(patched.status).toBe(200);
    const reopened = await admin.get(`/api/mrp-generator/scenarios/${id}`);
    expect(reopened.body.policy).toBeNull();
    expect(reopened.body.advancedPolicy.categoryFloors).toEqual({ PTMT: 60 });
    const run = await admin.post(`/api/mrp-generator/scenarios/${id}/run`).send({ asOf: AS_OF });
    expect(run.status).toBe(201);
    runIds.push(run.body.runId);
    const detail = await admin.get(`/api/mrp-generator/runs/${run.body.runId}`);
    expect(detail.body.policyVersion).toBe(3);
    expect(detail.body.simplePolicy.rows).toEqual(source.simpleRows);
    expect(detail.body.advancedPolicy).toEqual(expect.objectContaining({ source: "p012-simple" }));
    expect(detail.body.results[0]).toEqual(expect.objectContaining({ policyVersion: 3, matchedRowId: source.simpleRows[0].id }));
  });
});