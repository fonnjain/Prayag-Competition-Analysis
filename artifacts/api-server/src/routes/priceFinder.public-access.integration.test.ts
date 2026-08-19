import { describe, expect, it } from "vitest";
import supertest from "supertest";

import app from "../app.js";

const request = supertest(app);

describe("public Price Finder access", () => {
  it("allows anonymous price lookup while keeping internal catalog routes protected", async () => {
    const [priceFinder, catalog] = await Promise.all([
      request.get("/api/price-finder/browse"),
      request.get("/api/catalog/filters"),
    ]);

    expect(priceFinder.status).toBe(200);
    expect(priceFinder.body).toHaveProperty("divisions");
    expect(catalog.status).toBe(401);
  });
});