import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@workspace/db";
import routes from "./index";

const source = fileURLToPath(new URL(
  "../../../../attached_assets/Competitor_Master_-_Plumbing_Apollo_1790252780224.xlsx",
  import.meta.url,
));
const file = readFileSync(source);
const filename = "Competitor_Master_-_Plumbing_Apollo.xlsx";
const writeSpies: ReturnType<typeof vi.spyOn>[] = [];

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: "brand-scope-test", email: "brand-scope@example.test", role: "admin", mustChangePassword: false };
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });
  server.use(routes);
  return server;
}

function guardWrites() {
  for (const method of ["insert", "update", "delete", "transaction"] as const) {
    writeSpies.push(vi.spyOn(db, method));
  }
}

afterEach(() => {
  for (const spy of writeSpies.splice(0)) spy.mockRestore();
});

describe("P047 Step 3 brand-scoped workbook safety (no staging or price writes)", () => {
  it("inspects the Apollo workbook without reading Prince's dated columns", async () => {
    guardWrites();
    const response = await request(app()).post("/catalog/preview-competitor")
      .field("competitor", "Apollo").attach("file", file, filename);
    expect(response.status).toBe(200);
    expect(response.body.isPrinceMaster).toBe(false);
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("retains Prince's audited-position date refusal when Prince is selected", async () => {
    guardWrites();
    const response = await request(app()).post("/catalog/preview-competitor")
      .field("competitor", "Prince").attach("file", file, filename);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Prince sheet CPVC PIPE must use effective date 2026-03-01.*found 2026-08-01/);
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("refuses generic staging of a grouped workbook under another brand", async () => {
    guardWrites();
    const response = await request(app()).post("/catalog/stage-competitor-workbook")
      .field("competitor", "Astral").field("effectiveDate", "2026-08-01")
      .attach("file", file, filename);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("GROUPED_COMPETITOR_BRAND_SCOPE_REQUIRED");
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("routes Apollo away from generic staging", async () => {
    guardWrites();
    const response = await request(app()).post("/catalog/stage-competitor-workbook")
      .field("competitor", "Apollo").field("effectiveDate", "2026-08-01")
      .attach("file", file, filename);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("APOLLO_BRAND_PREVIEW_REQUIRED");
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
  });
});