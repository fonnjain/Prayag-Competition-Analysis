import { describe, expect, it } from "vitest";
import { SalesApiClient, SalesApiError, type SalesApiClientOptions } from "./salesApi";

const salesRow = {
  code: "151", month_label: "2026-04", fy: "2026-27", qty: 2,
  amount_taxable: 100, row_count: 1, catalogue_status: "matched",
};
const marginRow = {
  item_code: "151", month_label: "2026-06", fy: "2026-27", segment: "PTMT",
  qty: 2, sale_value: 100, bom_value: 55, gross_margin_pct: 0.45,
  mrp: 100, avg_sale: 50, discount_frac: 0.1,
};
const response = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extraHeaders } });
const coverage = { requested: ["2026-04"], returned: ["2026-04"], read_at: "2026-08-01", dataSource: "sales-db" };

function instantClient(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  options: { now?: () => number; sleep?: (milliseconds: number) => Promise<void>; apiKey?: string } = {},
) {
  return new SalesApiClient({
    apiKey: options.apiKey ?? "secret",
    fetch,
    now: options.now,
    sleep: options.sleep ?? (async () => undefined),
  });
}

const testClient = (options: SalesApiClientOptions = {}): SalesApiClient =>
  new SalesApiClient({
    ...options,
    sleep: options.sleep ?? (async () => undefined),
    now: options.now ?? (() => Date.now()),
  });

describe("SalesApiClient", () => {
  it("reads coverage before validating and aggregating cursor pages", async () => {
    const urls: string[] = [];
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
      const client = testClient({
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
    const client = testClient({
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
    await expect(testClient({ apiKey: "" }).getSnapshot()).rejects.toMatchObject({
      kind: "missing_credential",
    });
    await expect(testClient({
      apiKey: "secret",
      fetch: async () => response({ error: "unauthorized" }, 401),
    }).getSnapshot()).rejects.toMatchObject({ kind: "auth", statusCode: 401 });
  });

  it("does not accept rows when coverage is absent", async () => {
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    const client = testClient({
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
    expect(client.cachedSnapshot()).toBeNull();
    expect(client.status()).toMatchObject({ available: false, status: "unavailable" });
  });

  it.each([
    [401, "Sales API authentication failed (HTTP 401)."],
    [403, "Sales API denied access to the endpoint (HTTP 403)."],
  ] as const)("classifies final HTTP %s as auth_failed with a safe reason", async (status, message) => {
    const client = testClient({
      apiKey: "secret",
      fetch: async () => response({ error: "provider secret must never escape" }, status),
    });
    const error = await client.getSnapshot().catch((value: unknown) => value as SalesApiError);
    expect(error).toMatchObject({ kind: "auth", statusCode: status, httpStatus: status, message });
    expect(client.cachedSnapshot()).toBeNull();
    expect(client.status()).toMatchObject({ available: false, status: "auth_failed", reason: message });
    expect(JSON.stringify(error)).not.toContain("provider secret");
  });

  it("reports exact paired page and upstream request counts", async () => {
    const urls: string[] = [];
    const client = instantClient(async (url) => {
      urls.push(url);
      if (url.includes("sales-by-item") && !url.includes("cursor=next")) {
        return response({ coverage, rows: [salesRow], next_cursor: "next" });
      }
      if (url.includes("cursor=next")) return response({ coverage, rows: [salesRow] });
      return response({ coverage, rows: [marginRow] });
    });
    const snapshot = await client.getSnapshot();
    expect(urls).toHaveLength(3);
    expect(urls.every((url) => url.includes("limit=500"))).toBe(true);
    expect(snapshot.requestMetrics).toMatchObject({
      pageSize: 500, requestsMade: 3, completedPages: 3, requestLimit: 60, requestWindowSeconds: 60,
      countLabel: "actual",
    });
    expect(client.componentStatus("sales")).toMatchObject({
      pageSize: 500, requestsMade: 2, completedPages: 2,
    });
    expect(client.componentStatus("margin")).toMatchObject({
      pageSize: 500, requestsMade: 1, completedPages: 1,
    });
  });

  it("paces every paired request below the upstream budget", async () => {
    let clock = 1_000_000;
    const starts: number[] = [];
    const client = instantClient(async (url) => {
      starts.push(clock);
      // A completed upstream response takes no test time, so advance the fake
      // clock to keep the limiter focused on request starts.
      clock += 1_100;
      if (url.includes("sales-by-item") && !url.includes("cursor=next")) {
        return response({ coverage, rows: [salesRow], next_cursor: "next" });
      }
      if (url.includes("margin-by-item") && !url.includes("cursor=next")) {
        return response({ coverage, rows: [marginRow], next_cursor: "next" });
      }
      return response({ coverage, rows: [url.includes("sales-by-item") ? salesRow : marginRow] });
    }, { now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } });
    await client.getSnapshot();
    expect(starts).toHaveLength(4);
    expect(starts.slice(1).every((start, index) => start - starts[index]! >= 1_100)).toBe(true);
    for (const start of starts) {
      expect(starts.filter((value) => value >= start - 60_000 && value <= start).length).toBeLessThanOrEqual(55);
    }
  });

  it("retries a 429 after seconds on the same cursor and exposes rate-limited state while waiting", async () => {
    let clock = 1_000_000;
    let waiting = false;
    let release: (() => void) | undefined;
    const starts: string[] = [];
    const client = instantClient(async (url) => {
      starts.push(url);
      if (url.includes("sales-by-item") && !url.includes("cursor=next")) {
        return response({ coverage, rows: [salesRow], next_cursor: "next" });
      }
      if (url.includes("cursor=next") && !waiting) {
        waiting = true;
        return response({ error: "slow down" }, 429, { "retry-after": "7" });
      }
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    }, {
      now: () => clock,
      sleep: async (milliseconds) => {
        if (milliseconds >= 7_000) {
          await new Promise<void>((resolve) => { release = () => { clock += milliseconds; resolve(); }; });
        } else clock += milliseconds;
      },
    });
    const pending = client.getSnapshot({ refresh: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.status()).toMatchObject({ available: false, status: "rate_limited", retryAfterSeconds: 7, pageSize: 500 });
    expect(client.cachedSnapshot()).toBeNull();
    release!();
    const snapshot = await pending;
    expect(snapshot.requestMetrics.requestsMade).toBe(4);
    expect(starts[1]).toContain("cursor=next");
    expect(starts[2]).toBe(starts[1]);
    expect(client.status().status).toBe("authenticated");
  });

  it("parses an HTTP-date Retry-After header", async () => {
    const base = Date.parse("2026-08-01T00:00:00.000Z");
    let clock = base;
    const waits: number[] = [];
    let limited = true;
    const client = instantClient(async (url) => {
      if (limited && url.includes("sales-by-item")) {
        limited = false;
        return response({ error: "slow down" }, 429, {
          "retry-after": new Date(base + 5_000).toUTCString(),
        });
      }
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    }, {
      now: () => clock,
      sleep: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
    });
    await client.getSnapshot({ refresh: true });
    expect(waits).toContain(5_000);
  });

  it("uses deterministic exponential backoff when Retry-After is absent", async () => {
    let clock = 1_000_000;
    let limited = 0;
    const waits: number[] = [];
    const client = instantClient(async (url) => {
      if (url.includes("sales-by-item") && limited < 2) {
        limited++;
        return response({ error: "slow down" }, 429);
      }
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    }, {
      now: () => clock,
      sleep: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
    });
    await client.getSnapshot({ refresh: true });
    expect(waits).toEqual(expect.arrayContaining([1_000, 2_000]));
  });

  it("retains a completed cache while a refresh is rate limited", async () => {
    let clock = 1_000_000;
    let refresh = false;
    let limited = true;
    let release: (() => void) | undefined;
    const client = instantClient(async (url) => {
      if (refresh && limited && url.includes("sales-by-item")) {
        limited = false;
        return response({ error: "slow down" }, 429, { "retry-after": "10" });
      }
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    }, {
      now: () => clock,
      sleep: async (milliseconds) => {
        if (milliseconds >= 10_000) await new Promise<void>((resolve) => { release = () => { clock += milliseconds; resolve(); }; });
        else clock += milliseconds;
      },
    });
    const first = await client.getSnapshot();
    refresh = true;
    const pending = client.getSnapshot({ refresh: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.cachedSnapshot()).toBe(first);
    expect(await client.getSnapshot()).toBe(first);
    release!();
    await pending;
  });

  it("waits for source_changed restart cooldown and keeps rolling pacing", async () => {
    let clock = 1_000_000;
    const starts: number[] = [];
    let calls = 0;
    const client = instantClient(async (url) => {
      starts.push(clock);
      calls++;
      clock += 1_100;
      if (calls === 1) return response({ code: "source_changed" }, 409);
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    }, { now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } });
    await client.getSnapshot({ refresh: true });
    expect(calls).toBe(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1_500);
  });

  it("shares one in-flight paired refresh for concurrent callers", async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const client = instantClient(async (url) => {
      calls++;
      if (calls === 1) await new Promise<void>((resolve) => { release = resolve; });
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    });
    const first = client.getSnapshot({ refresh: true });
    const second = client.getSnapshot({ refresh: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release!();
    await Promise.all([first, second]);
    expect(calls).toBe(2);
  });

  it("propagates one shared rejection, cleans up, and allows the next refresh", async () => {
    let fail = true;
    let calls = 0;
    const client = testClient({
      apiKey: "secret",
      fetch: async (url) => {
        calls++;
        if (fail) return response({ error: "upstream" }, 503);
        return url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [marginRow] });
      },
    });
    const first = client.getSnapshot({ refresh: true });
    const second = client.getSnapshot({ refresh: true });
    await expect(first).rejects.toMatchObject({ kind: "network", statusCode: 503 });
    await expect(second).rejects.toMatchObject({ kind: "network", statusCode: 503 });
    expect(calls).toBe(1);
    fail = false;
    await expect(client.getSnapshot({ refresh: true })).resolves.toMatchObject({ requestMetrics: { requestsMade: 2 } });
    expect(calls).toBe(3);
  });

  it("continues component queue work after a rejected component traversal", async () => {
    let salesAttempt = true;
    const client = testClient({
      apiKey: "secret",
      fetch: async (url) => {
        if (url.includes("sales-by-item") && salesAttempt) {
          salesAttempt = false;
          return response({ error: "sales down" }, 503);
        }
        return url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [marginRow] });
      },
    });
    await expect(client.getOptionSnapshot({ sales: true, refresh: true })).rejects.toMatchObject({ kind: "network" });
    await expect(client.getOptionSnapshot({ margin: true, refresh: true })).resolves.toMatchObject({
      marginByCode: { "151": expect.any(Object) },
    });
  });

  it("queues independent sales and margin traversals without overlap", async () => {
    let active = 0;
    let maximum = 0;
    let release: (() => void) | undefined;
    let calls = 0;
    const client = instantClient(async (url) => {
      calls++;
      active++;
      maximum = Math.max(maximum, active);
      if (calls === 1) await new Promise<void>((resolve) => { release = resolve; });
      active--;
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    });
    const sales = client.getOptionSnapshot({ sales: true, refresh: true });
    const margin = client.getOptionSnapshot({ margin: true, refresh: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    release!();
    await Promise.all([sales, margin]);
    expect(maximum).toBe(1);
    expect(calls).toBe(2);
  });

  it("counts and paces authentication fallback requests", async () => {
    let clock = 1_000_000;
    const starts: number[] = [];
    const attempts: string[] = [];
    const client = instantClient(async (url, init) => {
      starts.push(clock);
      clock += 1_100;
      const headers = init?.headers as Record<string, string>;
      attempts.push(headers.Authorization ? "bearer" : "api-key");
      if (!headers.Authorization) return response({ error: "use bearer" }, 403);
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    }, { now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } });
    const snapshot = await client.getSnapshot({ refresh: true });
    expect(attempts).toEqual(["api-key", "bearer", "api-key", "bearer"]);
    expect(snapshot.requestMetrics.requestsMade).toBe(4);
    expect(starts.slice(1).every((start, index) => start - starts[index]! >= 1_100)).toBe(true);
  });

  it("keeps generic 5xx failures unavailable rather than rate limited", async () => {
    const client = instantClient(async () => response({ error: "upstream" }, 503));
    await expect(client.getSnapshot({ refresh: true })).rejects.toMatchObject({ kind: "network", statusCode: 503 });
    expect(client.status()).toMatchObject({ available: false, status: "unavailable" });
    expect(client.status()).not.toMatchObject({ status: "rate_limited" });
  });

  it("retains all requests from a source_changed restart in final refresh accounting", async () => {
    let calls = 0;
    const client = testClient({
      apiKey: "secret",
      fetch: async (url) => {
        calls++;
        if (calls === 2) return response({ code: "source_changed" }, 409);
        if (url.includes("sales-by-item") && !url.includes("cursor=next")) {
          return response({ coverage, rows: [salesRow], next_cursor: "next" });
        }
        if (url.includes("cursor=next")) return response({ coverage, rows: [salesRow] });
        return response({ coverage, rows: [marginRow] });
      },
    });
    const snapshot = await client.getSnapshot({ refresh: true });
    // First sales page + source_changed, then two sales pages + margin.
    expect(calls).toBe(5);
    expect(snapshot.requestMetrics).toMatchObject({ requestsMade: 5, completedPages: 4 });
    expect(client.componentStatus("sales")).toMatchObject({ requestsMade: 4, completedPages: 3 });
    expect(client.componentStatus("margin")).toMatchObject({ requestsMade: 1, completedPages: 1 });
  });

  it("reports total sales plus margin attempts while margin is rate limited", async () => {
    let clock = 1_000_000;
    let release: (() => void) | undefined;
    let limited = true;
    const client = instantClient(async (url) => {
      if (url.includes("margin-by-item") && limited) {
        limited = false;
        return response({ error: "slow down" }, 429, { "retry-after": "9" });
      }
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    }, {
      now: () => clock,
      sleep: async (milliseconds) => {
        if (milliseconds >= 9_000) {
          await new Promise<void>((resolve) => { release = () => { clock += milliseconds; resolve(); }; });
        } else clock += milliseconds;
      },
    });
    const pending = client.getSnapshot({ refresh: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.status()).toMatchObject({
      status: "rate_limited", requestsMade: 2, completedPages: 1, retryAfterSeconds: 9,
    });
    release!();
    const snapshot = await pending;
    expect(snapshot.requestMetrics).toMatchObject({ requestsMade: 3, completedPages: 2 });
  });

  it("honors long Retry-After and terminally retains the cached snapshot", async () => {
    let limited = false;
    const client = testClient({
      apiKey: "secret",
      fetch: async (url) => {
        if (limited) return response({ error: "slow down" }, 429, { "retry-after": "3600" });
        return url.includes("sales-by-item")
          ? response({ coverage, rows: [salesRow] })
          : response({ coverage, rows: [marginRow] });
      },
    });
    const cached = await client.getSnapshot();
    limited = true;
    await expect(client.getSnapshot({ refresh: true })).rejects.toMatchObject({ kind: "rate_limited", statusCode: 429 });
    expect(client.cachedSnapshot()).toBe(cached);
    expect(client.status()).toMatchObject({ status: "rate_limited", retryAfterSeconds: 3600 });
    expect(client.status()).not.toMatchObject({ status: "unavailable" });
  });

  it("uses a one-second fallback for zero and past Retry-After values", async () => {
    let clock = 1_000_000;
    let attempt = 0;
    const waits: number[] = [];
    const client = instantClient(async (url) => {
      if (url.includes("sales-by-item") && attempt === 0) {
        attempt++;
        return response({ error: "slow down" }, 429, { "retry-after": "0" });
      }
      if (url.includes("sales-by-item") && attempt === 1) {
        attempt++;
        return response({ error: "slow down" }, 429, { "retry-after": "Thu, 01 Jan 1970 00:00:00 GMT" });
      }
      return url.includes("sales-by-item")
        ? response({ coverage, rows: [salesRow] })
        : response({ coverage, rows: [marginRow] });
    }, { now: () => clock, sleep: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; } });
    await client.getSnapshot({ refresh: true });
    expect(waits).toEqual(expect.arrayContaining([1_000]));
  });

  it("inserts limiter pacing with a fixed clock and keeps history across restart", async () => {
    let clock = 10_000;
    const starts: number[] = [];
    let calls = 0;
    const client = instantClient(async (url) => {
      starts.push(clock);
      calls++;
      if (calls === 1) return response({ code: "source_changed" }, 409);
      if (url.includes("sales-by-item")) return response({ coverage, rows: [salesRow] });
      return response({ coverage, rows: [marginRow] });
    }, { now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } });
    await client.getSnapshot({ refresh: true });
    expect(starts).toHaveLength(3);
    expect(starts.slice(1).every((start, index) => start - starts[index]! >= 1_100)).toBe(true);
  });

  it("restarts a sales-only source_changed traversal with cooldown and scoped totals", async () => {
    let clock = 10_000;
    let calls = 0;
    const starts: number[] = [];
    const client = instantClient(async () => {
      starts.push(clock);
      calls++;
      return calls === 1
        ? response({ code: "source_changed" }, 409)
        : response({ coverage, rows: [salesRow] });
    }, { now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } });
    const snapshot = await client.getOptionSnapshot({ sales: true, refresh: true });
    expect(calls).toBe(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1_500);
    expect(snapshot.requestMetrics).toMatchObject({ requestsMade: 2, completedPages: 1 });
    expect(client.componentStatus("sales")).toMatchObject({ requestsMade: 2, completedPages: 1 });
  });

  it("restarts a margin-only source_changed traversal with cooldown and scoped totals", async () => {
    let clock = 10_000;
    let calls = 0;
    const starts: number[] = [];
    const client = instantClient(async () => {
      starts.push(clock);
      calls++;
      return calls === 1
        ? response({ code: "source_changed" }, 409)
        : response({ coverage, rows: [marginRow] });
    }, { now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } });
    const snapshot = await client.getOptionSnapshot({ margin: true, refresh: true });
    expect(calls).toBe(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1_500);
    expect(snapshot.requestMetrics).toMatchObject({ requestsMade: 2, completedPages: 1 });
    expect(client.componentStatus("margin")).toMatchObject({ requestsMade: 2, completedPages: 1 });
  });

  it("restarts only the affected traversal for a paired option refresh", async () => {
    let clock = 10_000;
    let salesCalls = 0;
    const starts: number[] = [];
    const client = instantClient(async (url) => {
      starts.push(clock);
      if (url.includes("sales-by-item")) {
        salesCalls++;
        return salesCalls === 1
          ? response({ code: "source_changed" }, 409)
          : response({ coverage, rows: [salesRow] });
      }
      return response({ coverage, rows: [marginRow] });
    }, { now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } });
    const snapshot = await client.getOptionSnapshot({ sales: true, margin: true, refresh: true });
    expect(starts).toHaveLength(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1_500);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1_100);
    expect(snapshot.requestMetrics).toMatchObject({ requestsMade: 3, completedPages: 2 });
    expect(client.componentStatus("sales")).toMatchObject({ requestsMade: 2, completedPages: 1 });
    expect(client.componentStatus("margin")).toMatchObject({ requestsMade: 1, completedPages: 1 });
  });

  it("classifies bounded option source_changed exhaustion as unavailable", async () => {
    let clock = 10_000;
    let calls = 0;
    const waits: number[] = [];
    const client = instantClient(async () => {
      calls++;
      return response({ code: "source_changed" }, 409);
    }, { now: () => clock, sleep: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; } });
    await expect(client.getOptionSnapshot({ sales: true, refresh: true })).rejects.toMatchObject({
      kind: "source_changed", statusCode: 409,
    });
    expect(calls).toBe(3);
    expect(waits).toEqual([1_500, 3_000]);
    expect(client.componentStatus("sales")).toMatchObject({ available: false, status: "unavailable", upstreamStatus: 409 });
  });

  it("paces 61 starts across the rolling boundary without exceeding the target", async () => {
    let clock = 100_000;
    const starts: number[] = [];
    let page = 0;
    const client = instantClient(async () => {
      starts.push(clock);
      page++;
      return response({ coverage, rows: [salesRow], ...(page < 61 ? { next_cursor: String(page) } : {}) });
    }, { now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; } });
    await client.getOptionSnapshot({ sales: true, refresh: true });
    expect(starts).toHaveLength(61);
    expect(starts.slice(1).every((start, index) => start - starts[index]! >= 1_100)).toBe(true);
    for (const start of starts) {
      expect(starts.filter((value) => value >= start - 60_000 && value <= start).length).toBeLessThanOrEqual(55);
    }
  });
});