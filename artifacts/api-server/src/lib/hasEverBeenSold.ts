/**
 * Fail-closed Sales register adapter for the product deletion gate.
 *
 * Sales has no authoritative fiscal-year inventory today. Until it supplies
 * one, a negative answer is never possible. A verified year inventory can be
 * injected without changing callers or allowing a guessed year range.
 */
export type SoldStatus = "sold" | "never_sold" | "unknown";
export type SoldEvidence = {
  status: SoldStatus;
  reason: string;
  periods: Array<{ fy: string; month: string; value: number | null }>;
  catalogueStatus: string | null; // context only; never a deletion criterion
};
export type FiscalYearInventory = {
  years: string[];
  complete: true;
  source: "sales-register";
};
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type SoldCheckOptions = {
  getFiscalYears?: () => Promise<FiscalYearInventory | null>;
  fetch?: FetchLike;
  apiKey?: string;
  baseUrl?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

const UNKNOWN_YEARS = "Sales register fiscal years cannot be authoritatively enumerated; all-time sales coverage is unknown.";
const PAGE_SIZE = 500;
const MAX_PAGES_PER_YEAR = 200;
const MAX_SOURCE_RESTARTS = 2;
const YEAR = /^(20\d{2})-(\d{2})$/;
const normalise = (code: string) => code.trim().toUpperCase();
const obj = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function fiscalMonths(fy: string): string[] | null {
  const match = YEAR.exec(fy);
  if (!match || Number(match[2]) !== (Number(match[1]) + 1) % 100) return null;
  const start = Number(match[1]);
  return Array.from({ length: 12 }, (_, index) =>
    `${index < 9 ? start : start + 1}-${String((index + 3) % 12 + 1).padStart(2, "0")}`);
}

function verifiedYears(value: FiscalYearInventory | null): string[] | null {
  if (!value || value.complete !== true || value.source !== "sales-register" ||
    !Array.isArray(value.years) || !value.years.length ||
    value.years.some((fy) => typeof fy !== "string" || !fiscalMonths(fy)) ||
    new Set(value.years).size !== value.years.length) return null;
  const sorted = [...value.years].sort();
  if (sorted.some((fy, index) => index > 0 && Number(fy.slice(0, 4)) !== Number(sorted[index - 1]!.slice(0, 4)) + 1)) return null;
  return sorted;
}

function unknown(cause: string): SoldEvidence {
  return { status: "unknown", reason: cause, periods: [], catalogueStatus: null };
}

function coveredMonths(payload: Record<string, unknown>, fy: string): string | null {
  const coverage = obj(payload.coverage);
  const expected = fiscalMonths(fy)!;
  if (!coverage) return `Sales coverage is missing for ${fy}.`;
  const returned = coverage.returned;
  const requested = coverage.requested_periods ?? coverage.requested;
  if (!Array.isArray(returned) || !Array.isArray(requested) ||
    returned.some((month) => typeof month !== "string") ||
    requested.some((month) => typeof month !== "string")) return `Sales coverage periods are invalid for ${fy}.`;
  const missing = ["held", "unavailable"].flatMap((name) => {
    const entries = coverage[name];
    if (!Array.isArray(entries)) return entries == null ? [] : [name];
    return entries.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      const months = obj(entry)?.months;
      return Array.isArray(months) ? months.filter((month): month is string => typeof month === "string") : [name];
    });
  });
  if (missing.length) return `Sales cannot answer ${fy}: held or unavailable months (${missing.join(", ")}).`;
  const expectedKey = [...expected].sort().join(",");
  if ([...new Set(returned)].sort().join(",") !== expectedKey ||
      [...new Set(requested)].sort().join(",") !== expectedKey) {
    return `Sales did not return all 12 months in ${fy}; coverage is incomplete.`;
  }
  return null;
}

class SoldCheckClient {
  private readonly fetcher: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly starts: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly key: string | undefined;
  private readonly baseUrl: string;

  constructor(private readonly options: SoldCheckOptions = {}) {
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
    this.key = options.apiKey ?? process.env.SALES_API_KEY;
    this.baseUrl = (options.baseUrl ?? process.env.SALES_API_BASE_URL ?? "https://prayag-sales.com").replace(/\/+$/, "");
  }

  private async pacedFetch(url: string): Promise<Response> {
    let now = this.now();
    const prune = () => {
      while (this.starts.length && now - this.starts[0]! >= 60_000) this.starts.shift();
    };
    prune();
    // Leave headroom for other Sales consumers using the same key.
    if (this.starts.length >= 40) {
      await this.sleep(Math.max(0, 60_000 - (now - this.starts[0]!) + 100));
      now = this.now();
      prune();
    }
    if (this.starts.length && now - this.starts.at(-1)! < 1_100) {
      await this.sleep(1_100 - (now - this.starts.at(-1)!));
      now = this.now();
    }
    this.starts.push(now);
    return this.fetcher(url, {
      headers: { "X-API-Key": this.key! },
      signal: AbortSignal.timeout(12_000),
    });
  }

  private async readYear(fy: string): Promise<{ rows: unknown[]; problem: string | null }> {
    const months = fiscalMonths(fy)!;
    for (let restart = 0; restart <= MAX_SOURCE_RESTARTS; restart++) {
      const rows: unknown[] = [];
      const visited = new Set<string>();
      let cursor: string | null = null;
      let conflict = false;
      for (let page = 0; page < MAX_PAGES_PER_YEAR; page++) {
        const params = new URLSearchParams({
          fy, from: months[0]!, to: months.at(-1)!, limit: String(PAGE_SIZE),
        });
        if (cursor) params.set("cursor", cursor);
        let response: Response;
        try {
          response = await this.pacedFetch(`${this.baseUrl}/api/external/sales-by-item?${params}`);
        } catch {
          return { rows: [], problem: `Sales request for ${fy} failed or timed out.` };
        }
        if (response.status === 409) {
          let code: unknown;
          try {
            const body = obj(await response.json());
            code = body?.code ?? obj(body?.error)?.code ?? body?.error;
          } catch { /* invalid conflict response stays unknown */ }
          if (code !== "source_changed") return { rows: [], problem: `Sales request for ${fy} returned HTTP 409.` };
          conflict = true;
          break;
        }
        if (!response.ok) return { rows: [], problem: `Sales request for ${fy} returned HTTP ${response.status}.` };
        let payload: Record<string, unknown> | null;
        try { payload = obj(await response.json()); } catch { payload = null; }
        if (!payload) return { rows: [], problem: `Sales response for ${fy} is invalid.` };
        const gap = coveredMonths(payload, fy);
        if (gap) return { rows: [], problem: gap };
        const pageRows = payload.rows ?? payload.data;
        if (!Array.isArray(pageRows) || pageRows.some((row) => {
          const value = obj(row);
          const code = value?.code ?? value?.item_code ?? value?.itemCode;
          return typeof code !== "string" || !code.trim();
        })) return { rows: [], problem: `Sales rows for ${fy} are missing or malformed.` };
        rows.push(...pageRows);
        const pagination = obj(payload.pagination) ?? obj(payload.meta);
        const next = payload.next_cursor ?? pagination?.next_cursor;
        if (next == null || next === "") {
          if (pagination?.has_more === true ||
            typeof pagination?.total_pages === "number" && page + 1 < pagination.total_pages) {
            return { rows: [], problem: `Sales paging for ${fy} is incomplete.` };
          }
          return { rows, problem: null };
        }
        if (typeof next !== "string" || !next || visited.has(next)) {
          return { rows: [], problem: `Sales paging for ${fy} is incomplete.` };
        }
        visited.add(next);
        cursor = next;
      }
      if (!conflict) return { rows: [], problem: `Sales paging for ${fy} exceeded the safe page limit.` };
    }
    return { rows: [], problem: `Sales source changed during paging for ${fy}; restart the entire check.` };
  }

  checkCodes(codes: string[]): Promise<Map<string, SoldEvidence>> {
    const task = this.queue.then(() => this.checkCodesInternal(codes));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async checkCodesInternal(codes: string[]): Promise<Map<string, SoldEvidence>> {
    const requested = [...new Set(codes.map(normalise).filter(Boolean))];
    if (!requested.length || requested.length > 200) throw new Error("Provide 1–200 item codes.");
    let years: string[] | null;
    try { years = verifiedYears(await (this.options.getFiscalYears?.() ?? Promise.resolve(null))); }
    catch { years = null; }
    if (!years) return new Map(requested.map((code) => [code, unknown(UNKNOWN_YEARS)]));
    if (!this.key?.trim()) return new Map(requested.map((code) => [code, unknown("Sales API credential is unavailable.")]));

    const observations = new Map(requested.map((code) => [code, [] as SoldEvidence["periods"]]));
    const catalogue = new Map<string, string>();
    let failure: string | null = null;
    for (const fy of years) {
      const result = await this.readYear(fy);
      if (result.problem) { failure = result.problem; break; }
      for (const value of result.rows) {
        const row = obj(value);
        const rawCode = row?.code ?? row?.item_code ?? row?.itemCode;
        const code = typeof rawCode === "string" ? normalise(rawCode) : "";
        const periods = observations.get(code);
        if (!periods) continue;
        const month = typeof row?.month_label === "string" ? row.month_label : "period unknown";
        const rawAmount = row?.amount_taxable ?? row?.amount;
        const amount = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? rawAmount : null;
        periods.push({ fy, month, value: amount });
        if (typeof row?.catalogue_status === "string") catalogue.set(code, row.catalogue_status);
      }
    }
    return new Map(requested.map((code) => {
      const periods = observations.get(code)!;
      const status: SoldStatus = failure ? "unknown" : periods.length ? "sold" : "never_sold";
      return [code, {
        status, periods, catalogueStatus: catalogue.get(code) ?? null,
        reason: status === "sold" ? "Sales register contains this item; retire it instead of deleting."
          : status === "unknown" ? `Delete blocked: ${failure}`
            : "No sales found in every fiscal year of the authoritative register inventory.",
      }];
    }));
  }
}

/** One-item interface used by P042; use checkEverSoldForCodes for bulk previews. */
export async function hasEverBeenSold(code: string, options?: SoldCheckOptions): Promise<SoldStatus> {
  return (await checkEverSoldForCodes([code], options)).get(normalise(code))!.status;
}

let runtimeClient: SoldCheckClient | null = null;
export async function checkEverSoldForCodes(codes: string[], options?: SoldCheckOptions): Promise<Map<string, SoldEvidence>> {
  return (options ? new SoldCheckClient(options) : runtimeClient ??= new SoldCheckClient()).checkCodes(codes);
}