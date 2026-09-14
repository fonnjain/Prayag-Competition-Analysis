import { describe, expect, it } from "vitest";
import { SalesApiClient, SalesApiError } from "./salesApi";

const salesRow = {
  code: "151", month_label: "2026-04", fy: "2026-27", qty: 2,
  amount_taxable: 100, row_count: 1, catalogue_status: "matched",
};
const marginRow = {
  item_code: "151", month_label: "2026-06", fy: "2026-27", segment: "PTMT",
  qty: 2, sale_value: 100, bom_value: 55, gross_margin_pct: 0.45,
  mrp: 100, avg_sale: 50, discount_frac: 0.1,
};
const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const coverage = { requested: ["2026-04"], returned: ["2026-04"], read_at: "2026-08-01", dataSource: "sales-db" };

describe("SalesApiClient", () => {
  it("reads coverage before validating and aggregating cursor pages", async () => {
    const urls: string[] = [];
    const client = new SalesApiClient({
      apiKey: "do-not-log",
      fetch: async (url) => {
        urls.push(url);
        if (url.includes("cursor=next")) {
          return response({ coverage, rows: [{ ...salesRow, qty: null, amount_taxable: 25, qty_unresolved: true }] });
        }
        if (url.includes("sales-by-item")) {
          return response({ coverage, rows: [salesRow], next_cursor: "next" });
        }
        return response({ coverage, rows: [marginRow] });
      },
    });
    const snapshot = await client.getSnapshot();
    expect(snapshot.salesByCode["151"]).toMatchObject({ salesAmount: 125, qty: null, qtyUnknown: true });
    expect(urls).toHaveLength(3);
    expect(urls.every((url) => url.includes("limit=500"))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("do-not-log");
  });

  it("retrieves volume independently when margin is down and reports component detail", async () => {
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url) => url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ error: "margin unavailable" }, 503),
    });
    const snapshot = await client.getOptionSnapshot({ sales: true });
    expect(snapshot.salesByCode["151"]?.salesAmount).toBe(100);
    expect(snapshot.marginByCode).toEqual({});
    expect(client.componentStatus("sales")).toMatchObject({ available: true, status: "authenticated" });
    await expect(client.getOptionSnapshot({ margin: true })).rejects.toMatchObject({ kind: "network", statusCode: 503 });
    expect(client.componentStatus("margin")).toMatchObject({ available: false, status: "unavailable", upstreamStatus: 503 });
  });

  it("retrieves margin independently when sales is down and reports component detail", async () => {
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url) => url.includes("sales-by-item")
        ? response({ error: "sales unavailable" }, 503)
        : response({ coverage, rows: [marginRow] }),
    });
    const snapshot = await client.getOptionSnapshot({ margin: true });
    expect(snapshot.marginByCode["151"]?.unitBomValue).toBeCloseTo(27.5);
    expect(snapshot.salesByCode).toEqual({});
    expect(client.componentStatus("margin")).toMatchObject({ available: true, status: "authenticated" });
    await expect(client.getOptionSnapshot({ sales: true })).rejects.toMatchObject({ kind: "network", statusCode: 503 });
    expect(client.componentStatus("sales")).toMatchObject({ available: false, status: "unavailable", upstreamStatus: 503 });
  });

  it("preserves a negative discount when realized sale is above MRP", async () => {
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url) => url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [{ ...marginRow, avg_sale: 106.67, discount_frac: -0.0667 }] }),
    });
    const snapshot = await client.getSnapshot();
    expect(snapshot.marginRows[0]?.discountFrac).toBe(-0.0667);
    expect(snapshot.marginByCode["151"]?.discountFrac).toBe(-0.0667);
  });

  it("rejects discounts outside the valid fraction interval", async () => {
    for (const discount of [-1, 1]) {
      const client = new SalesApiClient({
        apiKey: "secret",
        fetch: async (url) => url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [{ ...marginRow, discount_frac: discount }] }),
      });
      await expect(client.getSnapshot()).rejects.toMatchObject({ kind: "schema" });
    }
  });

  it("restarts both traversals from the first page after source_changed", async () => {
    let calls = 0;
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url) => {
        calls++;
        if (calls === 1) return response({ code: "source_changed" }, 409);
        return url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [marginRow] });
      },
    });
    await client.getSnapshot();
    expect(calls).toBe(3);
  });

  it("distinguishes missing credentials and upstream authentication", async () => {
    await expect(new SalesApiClient({ apiKey: "" }).getSnapshot()).rejects.toMatchObject({
      kind: "missing_credential",
    });
    await expect(new SalesApiClient({
      apiKey: "secret",
      fetch: async () => response({ error: "unauthorized" }, 401),
    }).getSnapshot()).rejects.toMatchObject({ kind: "auth", statusCode: 401 });
  });

  it("does not accept rows when coverage is absent", async () => {
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async () => response({ rows: [salesRow] }),
    });
    await expect(client.getSnapshot()).rejects.toMatchObject({ kind: "schema" });
    try { await client.getSnapshot(); } catch (error) {
      expect(error).toBeInstanceOf(SalesApiError);
    }
  });

  it("bootstraps once and invalidates the cached snapshot after a refresh is rejected", async () => {
    let calls = 0;
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url) => {
        calls++;
        if (calls > 2) return response({ error: "revoked" }, 401);
        return url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [marginRow] });
      },
    });
    await client.getSnapshot();
    expect(client.status().status).toBe("authenticated");
    await client.getSnapshot();
    expect(calls).toBe(2);
    await expect(client.getSnapshot({ refresh: true })).rejects.toMatchObject({ kind: "auth" });
    expect(client.cachedSnapshot()).toBeNull();
    expect(client.status()).toMatchObject({ available: false, status: "auth_failed" });
    await expect(client.getSnapshot()).rejects.toMatchObject({ kind: "auth" });
  });

  it("retains a dedicated awaiting-confirmation aggregate", async () => {
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url) => url.includes("sales-by-item")
        ? response({ coverage, rows: [{ ...salesRow, code: "WCT-3LL-10" }] })
        : response({ coverage, rows: [marginRow] }),
    });
    const snapshot = await client.getSnapshot();
    expect(snapshot.salesByCode["WCT-3LL-10"]).toBeUndefined();
    expect(snapshot.awaitingConfirmationByCode["WCT-3LL-10"]?.salesAmount).toBe(100);
  });

  it("normalizes held, unavailable, and provisional coverage into stable string arrays", async () => {
    const variedCoverage = {
      requested: { period: "2026-27", months: ["Apr", "May"] },
      returned: "2026-04..2026-06",
      held: { scope: "PTMT", months: ["H1", "H3"] },
      unavailable: ["2026-07", { month: "2026-08", reason: "not loaded" }],
      provisional: { status: "provisional", reason: "awaiting close" },
      read_at: "2026-08-01",
      dataSource: "sales-db",
    };
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url) => url.includes("sales-by-item")
        ? response({ coverage: variedCoverage, rows: [salesRow] })
        : response({ coverage: variedCoverage, rows: [marginRow] }),
    });
    const snapshot = await client.getSnapshot();
    expect(snapshot.coverage.sales.requested).toEqual(["months: Apr", "months: May", "period: 2026-27"]);
    expect(snapshot.coverage.sales.returned).toEqual(["2026-04..2026-06"]);
    expect(snapshot.coverage.sales.held).toEqual(["months: H1", "months: H3", "scope: PTMT"]);
    expect(snapshot.coverage.sales.unavailable).toEqual(["2026-07", "month: 2026-08", "reason: not loaded"]);
    expect(snapshot.coverage.sales.provisional).toEqual(["reason: awaiting close", "status: provisional"]);
  });

  it("maps false and null status coverage to empty arrays", async () => {
    const mixedCoverage = {
      requested: false,
      returned: null,
      held: { scope: "PTMT", period: "H1" },
      unavailable: false,
      provisional: null,
      read_at: "2026-08-01",
      dataSource: "sales-db",
    };
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url) => url.includes("sales-by-item")
        ? response({ coverage: mixedCoverage, rows: [salesRow] })
        : response({ coverage: mixedCoverage, rows: [marginRow] }),
    });
    const snapshot = await client.getSnapshot();
    expect(snapshot.coverage.sales.requested).toEqual([]);
    expect(snapshot.coverage.sales.returned).toEqual([]);
    expect(snapshot.coverage.sales.unavailable).toEqual([]);
    expect(snapshot.coverage.sales.provisional).toEqual([]);
    expect(snapshot.coverage.sales.held).toEqual(["period: H1", "scope: PTMT"]);
  });

  it("uses one X-API-Key request when the upstream accepts it", async () => {
    const headers: Array<Record<string, string>> = [];
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url, init) => {
        headers.push((init?.headers ?? {}) as Record<string, string>);
        return url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [marginRow] });
      },
    });
    await client.getSnapshot();
    expect(headers).toHaveLength(2);
    expect(headers.every((value) => (value as Record<string, string>)["X-API-Key"] === "secret")).toBe(true);
  });

  it("retries a rejected API-key request once with Bearer", async () => {
    const attempts: string[] = [];
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url, init) => {
        const requestHeaders = init?.headers as Record<string, string>;
        attempts.push(requestHeaders.Authorization ? "bearer" : "api-key");
        if (!requestHeaders.Authorization) return response({ error: "use bearer" }, 403);
        return url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [marginRow] });
      },
    });
    await client.getSnapshot();
    expect(attempts).toEqual(["api-key", "bearer", "api-key", "bearer"]);
  });

  it("invalidates a cached snapshot when both authentication styles reject", async () => {
    let reject = false;
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url, init) => {
        if (reject) return response({ error: "revoked" }, 403);
        return url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [marginRow] });
      },
    });
    await client.getSnapshot();
    reject = true;
    await expect(client.getSnapshot({ refresh: true })).rejects.toMatchObject({ kind: "auth" });
    expect(client.cachedSnapshot()).toBeNull();
    expect(client.status()).toMatchObject({ available: false, status: "auth_failed" });
  });

  it.each([
    [400, "network"],
    [409, "network"],
    [503, "network"],
  ] as const)("classifies HTTP %s as unavailable upstream, not auth", async (status, kind) => {
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async () => response(
        status === 409 ? { code: "other_conflict" } : { error: "upstream" },
        status,
      ),
    });
    await expect(client.getSnapshot()).rejects.toMatchObject({ kind, statusCode: status, httpStatus: status });
    expect(client.status()).toMatchObject({ available: false, status: "unavailable" });
    expect(client.status()).not.toMatchObject({ status: "auth_failed" });
  });

  it("retains but does not advertise a cached snapshot after non-auth upstream failure", async () => {
    let fail = false;
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async (url) => fail
        ? response({ error: "temporarily unavailable" }, 503)
        : url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [marginRow] }),
    });
    await client.getSnapshot();
    fail = true;
    await expect(client.getSnapshot({ refresh: true })).rejects.toMatchObject({ kind: "network", httpStatus: 503 });
    expect(client.cachedSnapshot()).not.toBeNull();
    expect(client.status()).toMatchObject({ available: false, status: "unavailable" });
  });

  it("restarts source_changed conflicts and reports unavailable source_changed after bounded exhaustion", async () => {
    let calls = 0;
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async () => {
        calls++;
        return response({ code: "source_changed" }, 409);
      },
    });
    await expect(client.getSnapshot()).rejects.toMatchObject({
      kind: "source_changed", statusCode: 409, httpStatus: 409,
    });
    expect(calls).toBe(3);
    expect(client.status()).toMatchObject({ available: false, status: "unavailable" });
  });

  it.each([
    [401, "Sales API authentication failed (HTTP 401)."],
    [403, "Sales API denied access to the endpoint (HTTP 403)."],
  ] as const)("classifies final HTTP %s as auth_failed with a safe reason", async (status, message) => {
    const client = new SalesApiClient({
      apiKey: "secret",
      fetch: async () => response({ error: "provider secret must never escape" }, status),
    });
    const error = await client.getSnapshot().catch((value: unknown) => value as SalesApiError);
    expect(error).toMatchObject({ kind: "auth", statusCode: status, httpStatus: status, message });
    expect(client.cachedSnapshot()).toBeNull();
    expect(client.status()).toMatchObject({ available: false, status: "auth_failed", reason: message });
    expect(JSON.stringify(error)).not.toContain("provider secret");
  });
});