import express from "express";
import supertest from "supertest";
import { describe, expect, it } from "vitest";
import routes from "./index";

function requestAs(role?: "admin" | "user") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => Boolean(role)) as never;
    if (role) {
      req.user = {
        id: `test-${role}`,
        email: `${role}@example.test`,
        role,
      };
    }
    next();
  });
  app.use(routes);
  return supertest(app);
}

describe("admin-only catalogue writes", () => {
  it("keeps Price Finder public while anonymous writes receive 401", async () => {
    const anonymous = requestAs();
    const [finder, importAttempt] = await Promise.all([
      anonymous.get("/price-finder/search?q="),
      anonymous.post("/catalog/load-mrp"),
    ]);
    expect(finder.status).toBe(200);
    expect(importAttempt.status).toBe(401);
  });

  it("rejects non-admin users from all administrative write boundaries", async () => {
    const user = requestAs("user");
    const responses = await Promise.all([
      user.post("/catalog/load-mrp"),
      user.post("/catalog/sync/preflight"),
      user.post("/catalog/import-batches/999999/approve"),
      user.post("/keys").send({ name: "not-allowed" }),
      user.patch("/catalog/products/TEST/mrp").send({ mrp: 100, reason: "test" }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Admin access required.");
    }
  });

  it("allows an admin through the guard to normal route validation", async () => {
    const admin = requestAs("admin");
    const [importAttempt, keyAttempt] = await Promise.all([
      admin.post("/catalog/load-mrp"),
      admin.post("/keys").send({ name: "" }),
    ]);
    expect(importAttempt.status).toBe(400);
    expect(keyAttempt.status).toBe(400);
  });
});