import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "@workspace/db";
import { createApolloStagedLoadRouter } from "./apolloStagedLoad";
import { APOLLO_TRUSTED_CONTENT_FINGERPRINT } from "../lib/apolloContentFingerprint";

const source = fileURLToPath(new URL("../../../../attached_assets/Competitor_Master_-_Plumbing_Apollo_1790252780224.xlsx", import.meta.url));
const databaseSpies: ReturnType<typeof vi.spyOn>[] = [];

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: "p047-date-test", email: "p047-date-test@example.test", role: "admin", mustChangePassword: false };
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });
  app.use(createApolloStagedLoadRouter([APOLLO_TRUSTED_CONTENT_FINGERPRINT]));
  return app;
}

function spyOnDatabase() {
  for (const method of ["select", "insert", "update", "delete", "transaction"] as const) {
    databaseSpies.push(vi.spyOn(db, method));
  }
}

afterEach(() => {
  for (const spy of databaseSpies.splice(0)) spy.mockRestore();
});

describe("P047 Step 3 Apollo effective-date safety", () => {
  it("reports the supplied and Apollo header dates and returns before any database access on mismatch", async () => {
    spyOnDatabase();
    const response = await request(makeApp())
      .post("/catalog/apollo-load/preview")
      .field("effectiveDate", "2026-08-10")
      .field("reason", "P047 Step 3 negative date-safety test")
      .attach("file", readFileSync(source), "Competitor_Master_-_Plumbing_Apollo.xlsx");

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "APOLLO_EFFECTIVE_DATE_MISMATCH",
      suppliedEffectiveDate: "2026-08-10",
      sourceEffectiveDate: "2026-08-01",
      noWrites: true,
    });
    expect(response.body.error).toContain("2026-08-10");
    expect(response.body.error).toContain("2026-08-01");
    for (const spy of databaseSpies) expect(spy).not.toHaveBeenCalled();
  });
});