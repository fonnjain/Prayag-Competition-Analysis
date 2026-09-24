import { describe, expect, it } from "vitest";
import {
  checkEverSoldForCodes, hasEverBeenSold, type FiscalYearInventory, type SoldCheckOptions,
} from "./hasEverBeenSold";

const months = (year: number) => Array.from({ length: 12 }, (_, i) =>
  `${i < 9 ? year : year + 1}-${String((i + 3) % 12 + 1).padStart(2, "0")}`);
const inventory = (...years: string[]): FiscalYearInventory =>
  ({ years, complete: true, source: "sales-register" });
const body = (fy: string, rows: unknown[] = [], extraCoverage: Record<string, unknown> = {}, nextCursor?: string) => ({
  rows, coverage: {
    requested: months(Number(fy.slice(0, 4))),
    returned: months(Number(fy.slice(0, 4))), held: [], unavailable: [], ...extraCoverage,
  },
  ...(nextCursor ? { next_cursor: nextCursor } : {}),
});
const response = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
const options = (fetch: NonNullable<SoldCheckOptions["fetch"]>, ...years: string[]): SoldCheckOptions => ({
  fetch, apiKey: "test-key", getFiscalYears: async () => inventory(...years),
  sleep: async () => undefined, now: (() => { let t = 0; return () => (t += 1_100); })(),
});

describe("P044 all-time sold check", () => {
  it("refuses to guess the year inventory when Sales has not supplied one", async () => {
    let calls = 0;
    const result = await checkEverSoldForCodes([" A-1 "], {
      apiKey: "test-key", fetch: async () => { calls++; throw new Error("should not be called"); },
    });
    expect(result.get("A-1")).toMatchObject({ status: "unknown", reason: expect.stringContaining("cannot be authoritatively enumerated") });
    expect(calls).toBe(0);
  });

  it("reports sold from any year even if the catalogue snapshot says absent", async () => {
    const fetch = async (url: string) => {
      const fy = new URL(url).searchParams.get("fy")!;
      return response(body(fy, fy === "2025-26" ? [{
        code: " a-1 ", month_label: "2025-04", amount_taxable: 0, catalogue_status: "absent",
      }] : []));
    };
    const result = await checkEverSoldForCodes(["a-1"], options(fetch, "2024-25", "2025-26"));
    expect(result.get("A-1")).toMatchObject({
      status: "sold", catalogueStatus: "absent", periods: [{ fy: "2025-26", month: "2025-04", value: 0 }],
    });
    expect(await hasEverBeenSold("a-1", options(fetch, "2024-25", "2025-26"))).toBe("sold");
  });

  it("reports never_sold only with a complete Sales year inventory and fully returned months", async () => {
    const result = await checkEverSoldForCodes(["a-1"], options(
      async (url) => response(body(new URL(url).searchParams.get("fy")!)), "2024-25", "2025-26",
    ));
    expect(result.get("A-1")).toMatchObject({ status: "never_sold", periods: [] });
  });

  it("treats FY2024-25's held months as unknown with a coverage refusal", async () => {
    const result = await checkEverSoldForCodes(["a-1"], options(
      async (url) => {
        const fy = new URL(url).searchParams.get("fy")!;
        return response(body(fy, [], fy === "2024-25" ? { held: ["2024-04"] } : {}));
      }, "2024-25", "2025-26",
    ));
    expect(result.get("A-1")).toMatchObject({ status: "unknown", reason: expect.stringContaining("2024-04") });
  });

  it.each([401, 403, 429, 503])("maps HTTP %i to unknown, never a deletion pass", async (status) => {
    const result = await checkEverSoldForCodes(["a-1"], options(
      async () => response({ error: "no access" }, status), "2024-25",
    ));
    expect(result.get("A-1")).toMatchObject({
      status: "unknown", reason: expect.stringContaining(`HTTP ${status}`),
    });
  });

  it("restarts the fiscal-year paging after source_changed and discards partial rows", async () => {
    const calls: string[] = [];
    const result = await checkEverSoldForCodes(["a-1"], options(async (url) => {
      const cursor = new URL(url).searchParams.get("cursor");
      calls.push(cursor ?? "first");
      if (calls.length === 2) return response({ code: "source_changed" }, 409);
      if (!cursor && calls.length === 1) return response(body("2024-25", [{ code: "a-1" }], {}, "next"));
      return response(body("2024-25", []));
    }, "2024-25"));
    expect(calls).toEqual(["first", "next", "first"]);
    expect(result.get("A-1")?.status).toBe("never_sold");
  });

  it("does not use partial positive rows when a later fiscal year fails", async () => {
    const result = await checkEverSoldForCodes(["a-1"], options(async (url) => {
      const fy = new URL(url).searchParams.get("fy")!;
      return fy === "2024-25" ? response(body(fy, [{ code: "a-1" }])) : response({}, 503);
    }, "2024-25", "2025-26"));
    expect(result.get("A-1")?.status).toBe("unknown");
  });

  it("batches thirty codes by fiscal year instead of making ninety requests", async () => {
    const urls: string[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect(init?.headers).toMatchObject({ "X-API-Key": "test-key" });
      expect(url).not.toContain("codes=");
      return response(body(new URL(url).searchParams.get("fy")!));
    };
    const codes = Array.from({ length: 30 }, (_, i) => `A-${i}`);
    const results = await checkEverSoldForCodes(codes, options(fetch, "2024-25", "2025-26", "2026-27"));
    expect(urls).toHaveLength(3);
    expect([...results.values()].every((result) => result.status === "never_sold")).toBe(true);
    expect(urls.every((url) => new URL(url).searchParams.get("limit") === "500")).toBe(true);
  });

  it("rejects 201 codes before any upstream call", async () => {
    let calls = 0;
    await expect(checkEverSoldForCodes(Array.from({ length: 201 }, (_, i) => `${i}`), options(
      async () => { calls++; return response({}); }, "2024-25",
    ))).rejects.toThrow("1–200");
    expect(calls).toBe(0);
  });
});