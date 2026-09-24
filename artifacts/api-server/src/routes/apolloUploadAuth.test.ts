import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import catalogImportExportRouter from "./catalogImportExport";
import importBatchesRouter from "./importBatches";
import apolloStagedLoadRouter from "./apolloStagedLoad";

describe("P045 Step 2 Apollo upload access", () => {
  const app = express();
  app.use((req, _res, next) => {
    // An authenticated non-admin request, without creating a user or touching
    // the development database. Keep the real route and requireAdmin guard.
    req.user = { id: "test-user", role: "user", mustChangePassword: false } as typeof req.user;
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });
  app.use("/api", catalogImportExportRouter, importBatchesRouter, apolloStagedLoadRouter);

  for (const path of [
    "/api/catalog/load-competitor",
    "/api/catalog/import-batches/preflight",
    "/api/catalog/import-batches",
    "/api/catalog/apollo-load/preview",
    "/api/catalog/apollo-load/1/apply",
    "/api/catalog/apollo-load/1/undo",
  ]) {
    it(`returns 403 before processing a non-admin upload at ${path}`, async () => {
      const response = await request(app)
        .post(path)
        .field("competitor", "Apollo")
        .attach("file", Buffer.from("not a real upload"), "apollo.pdf");
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "Admin access required." });
    });
  }
});