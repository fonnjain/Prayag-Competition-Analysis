import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

describe("build identity", () => {
  it("returns immutable build metadata without authentication or data access", async () => {
    const identity = { commitSha: "a".repeat(40), branch: "main", builtAt: "2026-10-18T10:00:00.000Z" };
    vi.stubGlobal("__BUILD_INFO__", identity);
    try {
      const { default: buildInfoRouter } = await import("./buildInfo");
      const app = express();
      app.use("/api", buildInfoRouter);
      app.use(() => { throw new Error("Authentication/data middleware must not run"); });
      const response = await request(app).get("/api/_build").set("Cookie", "sid=expired");
      expect(response.status).toBe(200);
      expect(response.body).toEqual(identity);
      expect(response.headers["cache-control"]).toBe("no-store");
      const again = await request(app).get("/api/_build");
      expect(again.body).toEqual(response.body);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
