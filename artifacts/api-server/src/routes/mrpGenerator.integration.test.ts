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
import { SalesApiClient, resetSalesApiClient, setSalesApiClientForTests } from "../lib/salesApi";

const RUN = Date.now();
const CODE = `__MRP_GENERATOR_${RUN}__`;
const EXCLUDED_CODE = `__MRP_GENERATOR_EXCLUDED_${RUN}__`;
const NO_CHANGE_CODE = `__MRP_GENERATOR_NO_CHANGE_${RUN}__`;
const RIGHT_ONLY_CODE = `__MRP_GENERATOR_RIGHT_ONLY_${RUN}__`;
const COMPETITOR = `Generator Competitor ${RUN}`;
const DATE = "2020-01-01";
const AS_OF = new Date().toISOString().slice(0, 10);

function authenticatedSalesFixture(): SalesApiClient {
  const coverage = {
    requested: ["2026-04..2026-08"], returned: ["2026-04..2026-08"],
    read_at: "2026-08-01", dataSource: "fixture-before-each",
    held: [], unavailable: [], provisional: [],
  };
  return new SalesApiClient({
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
  return new SalesApiClient({
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
  ]);
  await db.insert(mrpPriceHistoryTable).values([
    { itemCode: CODE, mrp: 100, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard", loadBatchId: fixtureBatchId },
    { itemCode: EXCLUDED_CODE, mrp: 100, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard", loadBatchId: fixtureBatchId },
    { itemCode: NO_CHANGE_CODE, mrp: 150, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard", loadBatchId: fixtureBatchId },
    { itemCode: RIGHT_ONLY_CODE, mrp: 120, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard", loadBatchId: fixtureBatchId },
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
  resetSalesApiClient();
  await cleanup(() => db.delete(competitorPricesTable).where(eq(competitorPricesTable.competitor, COMPETITOR)));
  await cleanup(() => db.delete(mrpHistoryProvenanceEventsTable).where(inArray(mrpHistoryProvenanceEventsTable.itemCode, [CODE, EXCLUDED_CODE, NO_CHANGE_CODE, RIGHT_ONLY_CODE])));
  await cleanup(() => db.delete(mrpPriceHistoryTable).where(inArray(mrpPriceHistoryTable.itemCode, [CODE, EXCLUDED_CODE, NO_CHANGE_CODE, RIGHT_ONLY_CODE])));
  await cleanup(() => deleteMrpFixtureBatch(fixtureBatchId));
  await cleanup(() => db.delete(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, [CODE, EXCLUDED_CODE, NO_CHANGE_CODE, RIGHT_ONLY_CODE])));
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
    const unauthorized = new SalesApiClient({
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
    const fixtureSales = new SalesApiClient({
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
    setSalesApiClientForTests(new SalesApiClient({
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
});