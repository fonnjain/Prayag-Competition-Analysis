/**
 * Server-only client for the Sales source used by the MRP generator.
 *
 * This module intentionally has no logging and never includes the credential
 * in an error.  A complete paired snapshot is cached only after both source
 * traversals have succeeded.
 */

export type SalesRow = {
  code: string;
  monthLabel: string;
  fy: string;
  qty: number | null;
  amountTaxable: number;
  rowCount: number;
  catalogueStatus: "matched" | "present_unpriced" | "absent";
  qtyLtr?: number | null;
  qtyUnresolved?: boolean;
  matchRule?: unknown;
};

export type MarginRow = {
  itemCode: string;
  monthLabel: string;
  fy: string;
  segment: string;
  qty: number | null;
  saleValue: number;
  bomValue: number;
  grossMarginPct: number;
  mrp: number | null;
  avgSale: number | null;
  discountFrac: number | null;
};

export type SalesCoverage = {
  requested: string[];
  returned: string[];
  held: string[];
  unavailable: string[];
  provisional: string[];
  read_at: string | null;
  reconciliation: Record<string, string | number | null>;
  dataSource: string | null;
  last_modified: string | null;
};

export type SalesAggregate = {
  itemCode: string;
  salesAmount: number;
  qty: number | null;
  qtyUnknown: boolean;
  rowCount: number;
  catalogueStatus: "matched" | "present_unpriced";
};

export type MarginAggregate = {
  itemCode: string;
  qty: number;
  qtyUnknown: boolean;
  saleValue: number;
  bomValue: number;
  unitBomValue: number | null;
  grossMarginPct: number;
  latestMonth: string;
  mrp: number | null;
  avgSale: number | null;
  discountFrac: number | null;
  held: boolean;
  warnings: string[];
};

export type SalesSnapshot = {
  fetchedAt: string;
  period: string;
  dataSource: string;
  salesRows: SalesRow[];
  marginRows: MarginRow[];
  salesByCode: Record<string, SalesAggregate>;
  marginByCode: Record<string, MarginAggregate>;
  coverage: {
    sales: SalesCoverage;
    margin: SalesCoverage;
  };
  availability: {
    available: true;
    status: "authenticated";
    dataSource: string;
  };
  /** Safe upstream request accounting for the completed paired refresh. */
  requestMetrics: SalesRequestMetrics;
  awaitingConfirmationByCode: Record<string, SalesAggregate>;
  /** Compatibility alias for the temporary server probe. */
  awaitingByCode: Record<string, SalesAggregate>;
};

export function hasHeldMarginCoverage(coverage: { held: string[] }, division?: string | null): boolean {
  const held = coverage.held.join(" ").toLowerCase();
  return Boolean(held && division && /ptmt/.test(division.toLowerCase()) &&
    /ptmt/.test(held));
}

export type SalesApiStatus =
  | { available: false; status: "missing_credential"; reason: string }
  | { available: false; status: "auth_failed"; reason: string }
  | { available: false; status: "unavailable"; reason: string }
  | ({ available: false; status: "rate_limited"; reason: string } & SalesRateLimitMetadata)
  | {
    available: true; status: "authenticated"; dataSource: string; requestMetrics?: SalesRequestMetrics;
    pageSize?: number; requestsMade?: number; completedPages?: number;
    requestLimit?: number; requestWindowSeconds?: number;
  };

export type SalesRequestMetrics = {
  pageSize: number;
  requestsMade: number;
  completedPages: number;
  requestLimit: number;
  requestWindowSeconds: number;
  /** Only present when the source explicitly supplied a safe page count. */
  expectedPages?: number;
  countLabel: "actual";
};

export type SalesRateLimitMetadata = {
  retryAt: string;
  retryAfterSeconds: number;
  pageSize: number;
  requestsMade: number;
  completedPages: number;
  requestLimit: number;
  requestWindowSeconds: number;
};

export type SalesComponentStatus = {
  available: boolean;
  status: "missing_credential" | "auth_failed" | "unavailable" | "rate_limited" | "authenticated";
  reason?: string;
  dataSource?: string;
  endpoint?: string;
  upstreamStatus?: number;
  lastAttemptAt?: string | null;
  coverage?: SalesCoverage | null;
  requestMetrics?: SalesRequestMetrics;
  retryAt?: string;
  retryAfterSeconds?: number;
  pageSize?: number;
  requestsMade?: number;
  completedPages?: number;
  requestLimit?: number;
  requestWindowSeconds?: number;
};

export class SalesApiError extends Error {
  readonly kind: "missing_credential" | "auth" | "network" | "schema" | "source_changed" | "rate_limited";
  readonly statusCode?: number;
  readonly httpStatus?: number;
  constructor(
    kind: SalesApiError["kind"],
    message: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = "SalesApiError";
    this.kind = kind;
    this.statusCode = statusCode;
    this.httpStatus = statusCode;
  }
}

const DEFAULT_BASE_URL = "https://prayag-sales.com";
const PAGE_LIMIT = 500;
export const SALES_PAGE_SIZE = PAGE_LIMIT;
export const SALES_REQUEST_LIMIT = 60;
export const SALES_REQUEST_WINDOW_SECONDS = 60;
export const SALES_TARGET_REQUEST_INTERVAL_MS = 1_100;
const REQUEST_INTERVAL_MS = SALES_TARGET_REQUEST_INTERVAL_MS;
const RESTART_COOLDOWN_MS = 1_500;
const MAX_RATE_LIMIT_WAIT_MS = 15 * 60_000;
const MAX_RESTARTS = 2;
export const SUPPORTED_SALES_PERIOD = "2026-27";
const AWAITING_CONFIRMATION = new Set([
  "WCT-3LL-10", "WCT-3LL-05", "WCT-3LL-07", "PSS-5",
  "824XD", "924XD", "824SD", "HD140B", "HD160B", "HD200B",
]);
export const awaitingConfirmationCodes = [...AWAITING_CONFIRMATION].sort();

type MetricsAccumulator = {
  requestsMade: number;
  completedPages: number;
  byComponent: Record<"sales" | "margin", { requestsMade: number; completedPages: number }>;
};

const newMetricsAccumulator = (): MetricsAccumulator => ({
  requestsMade: 0,
  completedPages: 0,
  byComponent: {
    sales: { requestsMade: 0, completedPages: 0 },
    margin: { requestsMade: 0, completedPages: 0 },
  },
});

const metricsSnapshot = (
  metrics: MetricsAccumulator,
  component?: "sales" | "margin",
): SalesRequestMetrics => {
  const values = component ? metrics.byComponent[component] : metrics;
  return {
  pageSize: PAGE_LIMIT,
  requestsMade: values.requestsMade,
  completedPages: values.completedPages,
  requestLimit: SALES_REQUEST_LIMIT,
  requestWindowSeconds: SALES_REQUEST_WINDOW_SECONDS,
  countLabel: "actual",
  };
};

function combineMetrics(
  first: SalesRequestMetrics | undefined,
  second: SalesRequestMetrics | undefined,
): SalesRequestMetrics {
  const metrics = first ?? second;
  return {
    pageSize: PAGE_LIMIT,
    requestsMade: (first?.requestsMade ?? 0) + (second?.requestsMade ?? 0),
    completedPages: (first?.completedPages ?? 0) + (second?.completedPages ?? 0),
    requestLimit: SALES_REQUEST_LIMIT,
    requestWindowSeconds: SALES_REQUEST_WINDOW_SECONDS,
    ...(first?.expectedPages != null && second?.expectedPages != null
      ? { expectedPages: first.expectedPages + second.expectedPages }
      : metrics?.expectedPages != null ? { expectedPages: metrics.expectedPages } : {}),
    countLabel: "actual",
  };
}

function pageCount(payload: unknown): number | undefined {
  const body = object(payload);
  const pagination = object(body?.pagination) ?? object(body?.meta);
  const value = pagination?.total_pages ?? pagination?.totalPages ?? body?.total_pages ?? body?.totalPages;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

const optionalNumber = (value: unknown): number | null =>
  value == null || value === "" ? null : (() => {
    const result = Number(value);
    if (!Number.isFinite(result)) throw new SalesApiError("schema", "Sales source returned an invalid numeric field.");
    return result;
  })();

const requiredNumber = (value: unknown, field: string): number => {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new SalesApiError("schema", `Sales source ${field} is invalid.`);
  return result;
};

function pick(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) if (row[name] !== undefined) return row[name];
  return undefined;
}

function canonicalCode(value: string): string {
  return value;
}

function monthKey(value: string): string {
  const text = value.trim().toLowerCase();
  const numeric = text.match(/(20\d\d)[-/](0[1-9]|1[0-2])/);
  if (numeric) return `${numeric[1]}-${numeric[2]}`;
  const month = text.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/)?.[1];
  if (!month) return text;
  const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(month);
  return `2026-${String(index + 1).padStart(2, "0")}`;
}

function coverageStrings(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "boolean") return [];
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(coverageStrings);
  const nested = object(value);
  if (!nested) return [];
  return Object.keys(nested).sort().flatMap((key) =>
    coverageStrings(nested[key]).map((entry) => `${key}: ${entry}`),
  );
}

function nonSecretCoverage(value: unknown): SalesCoverage {
  const source = object(value);
  if (!source) throw new SalesApiError("schema", "Sales source coverage is missing.");
  const strip = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(strip);
    const nested = object(item);
    if (!nested) return item;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(nested)) {
      if (/key|secret|token|authorization|password/i.test(key)) continue;
      result[key] = strip(child);
    }
    return result;
  };
  const sanitized = strip(source) as Record<string, unknown>;
  const stringValue = (key: string): string | null =>
    typeof sanitized[key] === "string" ? sanitized[key] as string : null;
  const reconciliationValue = object(sanitized.reconciliation) ?? {};
  const reconciliation: Record<string, string | number | null> = {};
  for (const key of Object.keys(reconciliationValue).sort()) {
    const item = reconciliationValue[key];
    reconciliation[key] = typeof item === "string" || typeof item === "number" ? item : null;
  }
  return {
    requested: coverageStrings(sanitized.requested),
    returned: coverageStrings(sanitized.returned),
    held: coverageStrings(sanitized.held),
    unavailable: coverageStrings(sanitized.unavailable),
    provisional: coverageStrings(sanitized.provisional),
    read_at: stringValue("read_at"),
    reconciliation,
    dataSource: stringValue("dataSource"),
    last_modified: stringValue("last_modified"),
  };
}

function extractCoverage(payload: unknown): SalesCoverage {
  const body = object(payload);
  const candidate = body?.coverage ?? object(body?.meta)?.coverage ?? object(body?.metadata)?.coverage;
  return nonSecretCoverage(candidate);
}

function extractRows(payload: unknown): unknown[] {
  const body = object(payload);
  const candidates = [
    body?.rows, body?.data, body?.items, body?.results,
    object(body?.data)?.rows, object(body?.data)?.items,
  ];
  const rows = candidates.find(Array.isArray);
  if (!rows) throw new SalesApiError("schema", "Sales source rows are missing.");
  return rows;
}

function nextCursor(payload: unknown): string | null {
  const body = object(payload);
  const page = object(body?.pagination) ?? object(body?.meta);
  const value = body?.next_cursor ?? body?.nextCursor ?? page?.next_cursor ?? page?.nextCursor;
  return value == null || value === "" ? null : typeof value === "string" ? value : String(value);
}

function parseSalesRow(raw: unknown): SalesRow {
  const row = object(raw);
  if (!row) throw new SalesApiError("schema", "Sales source returned a malformed sales row.");
  const code = pick(row, "code", "item_code", "itemCode");
  const month = pick(row, "month_label", "monthLabel", "month");
  const fy = pick(row, "fy", "financial_year", "financialYear");
  const status = pick(row, "catalogue_status", "catalogueStatus", "status");
  if (typeof code !== "string" || !code.trim() || typeof month !== "string" || typeof fy !== "string") {
    throw new SalesApiError("schema", "Sales source returned a sales row without code, month, or financial year.");
  }
  if (status !== "matched" && status !== "present_unpriced" && status !== "absent") {
    throw new SalesApiError("schema", `Sales source returned an invalid catalogue status for ${canonicalCode(code)}.`);
  }
  const qty = optionalNumber(pick(row, "qty", "quantity"));
  const amount = requiredNumber(pick(row, "amount_taxable", "amountTaxable", "taxable_amount", "amount"), "taxable amount");
  const rowCount = requiredNumber(pick(row, "row_count", "rowCount", "count") ?? 1, "row count");
  if (rowCount < 0) throw new SalesApiError("schema", "Sales source row count cannot be negative.");
  return {
    code: canonicalCode(code), monthLabel: month, fy, qty, amountTaxable: amount,
    rowCount, catalogueStatus: status,
    ...(pick(row, "qty_ltr", "qtyLtr") !== undefined ? { qtyLtr: optionalNumber(pick(row, "qty_ltr", "qtyLtr")) } : {}),
    ...(pick(row, "qty_unresolved", "qtyUnresolved") !== undefined ? { qtyUnresolved: Boolean(pick(row, "qty_unresolved", "qtyUnresolved")) } : {}),
    ...(pick(row, "match_rule", "matchRule") !== undefined ? { matchRule: pick(row, "match_rule", "matchRule") } : {}),
  };
}

function parseMarginRow(raw: unknown): MarginRow {
  const row = object(raw);
  if (!row) throw new SalesApiError("schema", "Sales source returned a malformed margin row.");
  const item = pick(row, "item_code", "itemCode", "code");
  const month = pick(row, "month_label", "monthLabel", "month");
  const fy = pick(row, "fy", "financial_year", "financialYear");
  const segment = pick(row, "segment", "division");
  if (typeof item !== "string" || !item.trim() || typeof month !== "string" || typeof fy !== "string" || typeof segment !== "string") {
    throw new SalesApiError("schema", "Sales source returned a margin row without item, month, FY, or segment.");
  }
  const sale = requiredNumber(pick(row, "sale_value", "saleValue", "sales_value"), "sale value");
  const bom = requiredNumber(pick(row, "bom_value", "bomValue"), "BOM value");
  const margin = requiredNumber(pick(row, "gross_margin_pct", "grossMarginPct", "gross_margin"), "gross margin");
  if (margin < -1 || margin > 1) throw new SalesApiError("schema", "Sales source gross margin must be a fraction.");
  const rawQty = pick(row, "qty", "quantity");
  const qty = rawQty == null || rawQty === "" ? null : optionalNumber(rawQty);
  const discount = optionalNumber(pick(row, "discount_frac", "discountFrac", "discount_fraction"));
  if (discount != null && (discount <= -1 || discount >= 1)) {
    throw new SalesApiError("schema", "Sales source discount must be a fraction between -1 and 1.");
  }
  return {
    itemCode: canonicalCode(item), monthLabel: month, fy, segment, qty, saleValue: sale,
    bomValue: bom, grossMarginPct: margin,
    mrp: optionalNumber(pick(row, "mrp", "MRP")),
    avgSale: optionalNumber(pick(row, "avg_sale", "avgSale")),
    discountFrac: discount,
  };
}

function aggregateSales(rows: SalesRow[], includeAwaiting = false): Record<string, SalesAggregate> {
  const result = new Map<string, SalesAggregate>();
  for (const row of rows) {
    if (row.catalogueStatus === "absent" || (!includeAwaiting && AWAITING_CONFIRMATION.has(row.code))) continue;
    const existing = result.get(row.code);
    if (!existing) {
      result.set(row.code, {
        itemCode: row.code, salesAmount: row.amountTaxable, qty: row.qty,
        qtyUnknown: row.qty == null || row.qtyUnresolved === true, rowCount: row.rowCount,
        catalogueStatus: row.catalogueStatus,
      });
      continue;
    }
    existing.salesAmount += row.amountTaxable;
    existing.rowCount += row.rowCount;
    if (row.qty == null || row.qtyUnresolved === true) {
      existing.qty = null;
      existing.qtyUnknown = true;
    } else if (existing.qty != null) existing.qty += row.qty;
  }
  return Object.fromEntries([...result.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function aggregateMargin(rows: MarginRow[], coverage: SalesCoverage): Record<string, MarginAggregate> {
  const grouped = new Map<string, MarginRow[]>();
  for (const row of rows) {
    if (row.fy !== "2026-27" || !["2026-04", "2026-05", "2026-06"].includes(monthKey(row.monthLabel))) continue;
    if (row.saleValue <= 0) continue;
    const list = grouped.get(row.itemCode) ?? [];
    list.push(row);
    grouped.set(row.itemCode, list);
  }
  const result = new Map<string, MarginAggregate>();
  for (const [code, list] of grouped) {
    const saleValue = list.reduce((sum, row) => sum + row.saleValue, 0);
    const bomValue = list.reduce((sum, row) => sum + row.bomValue, 0);
    const usableRows = list.filter((row) => row.qty != null && row.qty > 0);
    const qty = usableRows.reduce((sum, row) => sum + row.qty!, 0);
    const qtyUnknown = usableRows.length !== list.length;
    const latest = [...list].sort((a, b) => monthKey(a.monthLabel).localeCompare(monthKey(b.monthLabel))).at(-1)!;
    const weightTotal = list.reduce((sum, row) => sum + (row.qty != null && row.qty > 0 ? row.qty : row.saleValue), 0);
    const discountFrac = weightTotal > 0
      ? list.reduce((sum, row) => sum + (row.discountFrac ?? 0) * (row.qty != null && row.qty > 0 ? row.qty : row.saleValue), 0) / weightTotal
      : null;
    result.set(code, {
      itemCode: code, qty, qtyUnknown, saleValue, bomValue,
      unitBomValue: !qtyUnknown && qty > 0 ? bomValue / qty : null,
      grossMarginPct: (saleValue - bomValue) / saleValue,
      latestMonth: latest.monthLabel, mrp: latest.mrp, avgSale: latest.avgSale,
      discountFrac, held: false, warnings: monthKey(latest.monthLabel) === "2026-06"
        ? ["June margin is usable but recent; review source age."] : [],
    });
  }
  // A source-level H1/PTMT hold is meaningful only for products for which no
  // usable margin made it through.  It must not turn ordinary missing data into
  // a held result.
  return Object.fromEntries([...result.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type SalesApiClientOptions = {
  fetch?: FetchLike;
  apiKey?: string;
  baseUrl?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

export class SalesApiClient {
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;
  private readonly key: string | undefined;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private cached: SalesSnapshot | null = null;
  private lastFailure: SalesApiError | null = null;
  private salesCache: { rows: SalesRow[]; coverage: SalesCoverage; fetchedAt: string; requestMetrics: SalesRequestMetrics } | null = null;
  private marginCache: { rows: MarginRow[]; coverage: SalesCoverage; fetchedAt: string; requestMetrics: SalesRequestMetrics } | null = null;
  private salesFailure: SalesApiError | null = null;
  private marginFailure: SalesApiError | null = null;
  private salesLastAttemptAt: string | null = null;
  private marginLastAttemptAt: string | null = null;
  private salesMetrics: SalesRequestMetrics | undefined;
  private marginMetrics: SalesRequestMetrics | undefined;
  private rateLimit: (SalesRateLimitMetadata & { component: "sales" | "margin" }) | null = null;
  private rateLimitWaitMs = 0;
  private requestStarts: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private fullInFlight: Promise<SalesSnapshot> | null = null;
  private optionInFlight = new Map<string, Promise<SalesSnapshot>>();

  constructor(options: SalesApiClientOptions = {}) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.key = options.apiKey ?? process.env.SALES_API_KEY;
    this.baseUrl = (options.baseUrl ?? process.env.SALES_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => Date.now());
  }

  status(): SalesApiStatus {
    if (!this.key?.trim()) return { available: false, status: "missing_credential", reason: "Sales API credential is not configured." };
    if (this.rateLimit) {
      const { component: _component, ...metadata } = this.rateLimit;
      return {
        available: false,
        status: "rate_limited",
        reason: "Sales API request budget is temporarily rate limited; the last refresh is being retained.",
        ...metadata,
      };
    }
    if (this.lastFailure?.kind === "auth") {
      const reason = this.lastFailure.statusCode === 403
        ? "Sales API denied access to the endpoint (HTTP 403)."
        : "Sales API authentication failed (HTTP 401).";
      return { available: false, status: "auth_failed", reason };
    }
    if (this.lastFailure) return { available: false, status: "unavailable", reason: "Sales API snapshot is unavailable." };
    if (this.cached) return {
      ...this.cached.availability,
      requestMetrics: this.cached.requestMetrics,
      pageSize: this.cached.requestMetrics.pageSize,
      requestsMade: this.cached.requestMetrics.requestsMade,
      completedPages: this.cached.requestMetrics.completedPages,
      requestLimit: this.cached.requestMetrics.requestLimit,
      requestWindowSeconds: this.cached.requestMetrics.requestWindowSeconds,
    };
    return { available: false, status: "unavailable", reason: "Sales API snapshot has not been authenticated." };
  }

  clearCache(): void {
    this.cached = null; this.lastFailure = null; this.salesCache = null; this.marginCache = null;
    this.salesFailure = null; this.marginFailure = null;
    this.salesMetrics = undefined; this.marginMetrics = undefined; this.rateLimit = null; this.rateLimitWaitMs = 0;
  }
  cachedSnapshot(): SalesSnapshot | null { return this.cached; }

  componentStatus(component: "sales" | "margin"): SalesComponentStatus {
    const endpoint = component === "sales" ? "/api/external/sales-by-item" : "/api/external/margin-by-item";
    const lastAttemptAt = component === "sales" ? this.salesLastAttemptAt : this.marginLastAttemptAt;
    const cache = component === "sales" ? this.salesCache : this.marginCache;
    const failure = component === "sales" ? this.salesFailure : this.marginFailure;
    const metrics = component === "sales" ? this.salesMetrics : this.marginMetrics;
    if (!this.key?.trim()) return { available: false, status: "missing_credential", reason: "Sales API credential is not configured.", endpoint, lastAttemptAt };
    if (this.rateLimit?.component === component) {
      const { component: _component, ...metadata } = this.rateLimit;
      return {
        available: false,
        status: "rate_limited",
        reason: "Sales API request budget is temporarily rate limited; the cached component is retained.",
        endpoint, lastAttemptAt, requestMetrics: metrics, ...metadata,
      };
    }
    if (failure?.kind === "auth") return { available: false, status: "auth_failed", reason: failure.message, endpoint, upstreamStatus: failure.statusCode, lastAttemptAt };
    if (failure) return { available: false, status: "unavailable", reason: failure.message, endpoint, upstreamStatus: failure.statusCode, lastAttemptAt };
    if (cache) return {
      available: true, status: "authenticated", dataSource: cache.coverage.dataSource ?? this.baseUrl,
      endpoint, lastAttemptAt, coverage: cache.coverage, requestMetrics: cache.requestMetrics,
      pageSize: cache.requestMetrics.pageSize, requestsMade: cache.requestMetrics.requestsMade,
      completedPages: cache.requestMetrics.completedPages, requestLimit: cache.requestMetrics.requestLimit,
      requestWindowSeconds: cache.requestMetrics.requestWindowSeconds,
    };
    return { available: false, status: "unavailable", reason: "Sales API endpoint has not been authenticated.", endpoint, lastAttemptAt, requestMetrics: metrics };
  }

  private snapshotFromParts(
    period: string,
    salesRows: SalesRow[],
    salesCoverage: SalesCoverage,
    marginRows: MarginRow[],
    marginCoverage: SalesCoverage,
    requestMetrics: SalesRequestMetrics,
    fetchedAt = new Date(this.now()).toISOString(),
  ): SalesSnapshot {
    const dataSource = salesCoverage.dataSource ?? marginCoverage.dataSource ?? this.baseUrl;
    return {
      fetchedAt, period, dataSource, salesRows, marginRows,
      salesByCode: aggregateSales(salesRows),
      awaitingConfirmationByCode: aggregateSales(salesRows.filter((row) => AWAITING_CONFIRMATION.has(row.code)), true),
      awaitingByCode: aggregateSales(salesRows.filter((row) => AWAITING_CONFIRMATION.has(row.code)), true),
      marginByCode: aggregateMargin(marginRows, marginCoverage),
      coverage: { sales: salesCoverage, margin: marginCoverage },
      requestMetrics,
      availability: { available: true, status: "authenticated", dataSource },
    };
  }

  async getOptionSnapshot(options: { sales?: boolean; margin?: boolean; refresh?: boolean; period?: string } = {}): Promise<SalesSnapshot> {
    const period = options.period ?? SUPPORTED_SALES_PERIOD;
    if (period !== SUPPORTED_SALES_PERIOD) throw new SalesApiError("schema", `Sales period ${period} is not supported; only ${SUPPORTED_SALES_PERIOD} is available.`);
    if (!options.sales && !options.margin) return this.getSnapshot({ refresh: options.refresh, period });
    if (!this.key?.trim()) throw new SalesApiError("missing_credential", "Sales API credential is not configured.");
    const key = JSON.stringify({ sales: Boolean(options.sales), margin: Boolean(options.margin), refresh: Boolean(options.refresh), period });
    const existing = this.optionInFlight.get(key);
    if (existing) return existing;
    const promise = this.enqueue(() => this.loadOptionSnapshot(options, period));
    this.optionInFlight.set(key, promise);
    // Do not use finally here: its derived promise would reject when the
    // traversal rejects and become an unhandled rejection.  Both branches of
    // then return void, so the cleanup promise is always observed.
    void promise.then(
      () => { this.optionInFlight.delete(key); },
      () => { this.optionInFlight.delete(key); },
    );
    return promise;
  }

  private async loadOptionSnapshot(
    options: { sales?: boolean; margin?: boolean; refresh?: boolean; period?: string },
    period: string,
  ): Promise<SalesSnapshot> {
    const emptyCoverage = (): SalesCoverage => ({
      requested: [], returned: [], held: [], unavailable: [], provisional: [], read_at: null,
      reconciliation: {}, dataSource: this.baseUrl, last_modified: null,
    });
    let salesPart = options.sales ? this.salesCache : null;
    let marginPart = options.margin ? this.marginCache : null;
    const metrics = newMetricsAccumulator();
    if (options.sales && (!salesPart || options.refresh)) {
      this.salesLastAttemptAt = new Date(this.now()).toISOString();
      try {
        const source = await this.traverseWithRestarts(
          "/api/external/sales-by-item?fy=2026-27&from=2026-04&to=2026-08", "sales", metrics,
        );
        salesPart = { rows: source.rows.map(parseSalesRow), coverage: source.coverage, fetchedAt: new Date(this.now()).toISOString(), requestMetrics: source.requestMetrics };
        this.salesCache = { ...salesPart, requestMetrics: source.requestMetrics }; this.salesMetrics = source.requestMetrics; this.salesFailure = null;
        this.rateLimit = null; this.rateLimitWaitMs = 0;
      } catch (error) {
        this.salesFailure = error instanceof SalesApiError ? error : new SalesApiError("network", "Sales API network request failed.");
        throw this.salesFailure;
      }
    }
    if (options.margin && (!marginPart || options.refresh)) {
      this.marginLastAttemptAt = new Date(this.now()).toISOString();
      try {
        const source = await this.traverseWithRestarts(
          "/api/external/margin-by-item?fy=2026-27&from=2026-04&to=2026-06", "margin", metrics,
        );
        marginPart = { rows: source.rows.map(parseMarginRow), coverage: source.coverage, fetchedAt: new Date(this.now()).toISOString(), requestMetrics: source.requestMetrics };
        this.marginCache = { ...marginPart, requestMetrics: source.requestMetrics }; this.marginMetrics = source.requestMetrics; this.marginFailure = null;
        this.rateLimit = null; this.rateLimitWaitMs = 0;
      } catch (error) {
        this.marginFailure = error instanceof SalesApiError ? error : new SalesApiError("network", "Sales API network request failed.");
        throw this.marginFailure;
      }
    }
    const snapshot = this.snapshotFromParts(
      period,
      salesPart?.rows ?? [], salesPart?.coverage ?? emptyCoverage(),
      marginPart?.rows ?? [], marginPart?.coverage ?? emptyCoverage(),
      combineMetrics(
        options.sales ? (metrics.byComponent.sales.requestsMade ? metricsSnapshot(metrics, "sales") : salesPart?.requestMetrics) : undefined,
        options.margin ? (metrics.byComponent.margin.requestsMade ? metricsSnapshot(metrics, "margin") : marginPart?.requestMetrics) : undefined,
      ),
      salesPart?.fetchedAt ?? marginPart?.fetchedAt,
    );
    if (options.sales && options.margin) this.cached = snapshot;
    return snapshot;
  }

  async getSnapshot(options: { refresh?: boolean; period?: string } = {}): Promise<SalesSnapshot> {
    const period = options.period ?? SUPPORTED_SALES_PERIOD;
    if (period !== SUPPORTED_SALES_PERIOD) {
      throw new SalesApiError("schema", `Sales period ${period} is not supported; only ${SUPPORTED_SALES_PERIOD} is available.`);
    }
    const state = this.status();
    if (state.status === "missing_credential") throw new SalesApiError("missing_credential", state.reason);
    if (this.cached && state.status === "rate_limited" && !options.refresh) return this.cached;
    if (this.cached && !this.lastFailure && this.cached.period === period && !options.refresh) return this.cached;
    if (this.fullInFlight) return this.fullInFlight;
    const promise = this.enqueue(() => this.loadSnapshot(options, period));
    this.fullInFlight = promise;
    void promise.then(
      () => { this.fullInFlight = null; },
      () => { this.fullInFlight = null; },
    );
    return promise;
  }

  private async loadSnapshot(options: { refresh?: boolean; period?: string }, period: string): Promise<SalesSnapshot> {
    const metrics = newMetricsAccumulator();
    try {
        // Coverage is parsed and validated before any row is accepted.
        // A source_changed restart is part of this same logical refresh:
        // retain the accumulator and limiter history rather than spending a
        // new unaccounted burst.
        const sales = await this.traverseWithRestarts(
          "/api/external/sales-by-item?fy=2026-27&from=2026-04&to=2026-08", "sales", metrics,
        );
        const margin = await this.traverseWithRestarts(
          "/api/external/margin-by-item?fy=2026-27&from=2026-04&to=2026-06", "margin", metrics,
        );
           const parsedSalesRows = sales.rows.map(parseSalesRow);
           const parsedMarginRows = margin.rows.map(parseMarginRow);
           const snapshot: SalesSnapshot = {
            fetchedAt: new Date(this.now()).toISOString(),
           period,
           dataSource: typeof sales.coverage.dataSource === "string" ? sales.coverage.dataSource :
             typeof margin.coverage.dataSource === "string" ? margin.coverage.dataSource : this.baseUrl,
           salesRows: parsedSalesRows,
           marginRows: parsedMarginRows,
           salesByCode: aggregateSales(parsedSalesRows),
           awaitingConfirmationByCode: aggregateSales(parsedSalesRows.filter((row) => AWAITING_CONFIRMATION.has(row.code)), true),
           awaitingByCode: aggregateSales(parsedSalesRows.filter((row) => AWAITING_CONFIRMATION.has(row.code)), true),
           marginByCode: aggregateMargin(parsedMarginRows, margin.coverage),
          coverage: { sales: sales.coverage, margin: margin.coverage },
             requestMetrics: metricsSnapshot(metrics),
          availability: {
            available: true,
            status: "authenticated",
             dataSource: typeof sales.coverage.dataSource === "string" ? sales.coverage.dataSource :
               typeof margin.coverage.dataSource === "string" ? margin.coverage.dataSource : this.baseUrl,
          },
        };
         this.cached = snapshot;
          this.salesCache = { rows: parsedSalesRows, coverage: sales.coverage, fetchedAt: snapshot.fetchedAt, requestMetrics: metricsSnapshot(metrics, "sales") };
          this.marginCache = { rows: parsedMarginRows, coverage: margin.coverage, fetchedAt: snapshot.fetchedAt, requestMetrics: metricsSnapshot(metrics, "margin") };
          this.salesMetrics = metricsSnapshot(metrics, "sales");
          this.marginMetrics = metricsSnapshot(metrics, "margin");
        this.salesFailure = null;
        this.marginFailure = null;
        this.lastFailure = null;
         this.rateLimit = null;
         this.rateLimitWaitMs = 0;
        return snapshot;
    } catch (error) {
      this.lastFailure = error instanceof SalesApiError ? error : new SalesApiError("network", "Sales API snapshot is unavailable.");
      if (this.lastFailure.kind === "auth") this.cached = null;
      throw error;
    }
  }

  /**
   * A source_changed response restarts only this traversal.  This is safe for
   * independent components and avoids discarding completed rows, while the
   * caller's accumulator and this client's rolling limiter remain shared.
   */
  private async traverseWithRestarts(
    path: string,
    component: "sales" | "margin",
    metrics: MetricsAccumulator,
  ): Promise<{ rows: unknown[]; coverage: SalesCoverage; requestMetrics: SalesRequestMetrics }> {
    for (let restart = 0; restart <= MAX_RESTARTS; restart++) {
      try {
        return await this.traverse(path, component, metrics);
      } catch (error) {
        if (!(error instanceof SalesApiError) || error.kind !== "source_changed" || restart >= MAX_RESTARTS) {
          throw error;
        }
        await this.sleep(RESTART_COOLDOWN_MS * (restart + 1));
      }
    }
    throw new SalesApiError("source_changed", "Sales source changed while reading; retry limit exceeded.");
  }

  private async traverse(
    path: string,
    component: "sales" | "margin",
    metrics: MetricsAccumulator,
  ): Promise<{ rows: unknown[]; coverage: SalesCoverage; requestMetrics: SalesRequestMetrics }> {
    const rows: unknown[] = [];
    let cursor: string | null = null;
    let coverage: SalesCoverage | null = null;
    let completedPages = 0;
    let expectedPages: number | undefined;
    while (true) {
      const separator = path.includes("?") ? "&" : "?";
      const url = `${this.baseUrl}${path}${separator}limit=${PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      let response: Response;
      try {
        response = await this.request(url, { method: "GET", headers: { "X-API-Key": this.key! } }, component);
        metrics.requestsMade++;
        metrics.byComponent[component].requestsMade++;
        if (response.status === 401 || response.status === 403) {
          // The upstream contract accepts either header style.  Keep the API
          // key attempt first, and only spend one bounded retry on Bearer.
          response = await this.request(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${this.key!}` },
          }, component);
          metrics.requestsMade++;
          metrics.byComponent[component].requestsMade++;
        }
      } catch {
        throw new SalesApiError("network", "Sales API network request failed.");
      }
      if (response.status === 401 || response.status === 403) {
        const message = response.status === 403
          ? "Sales API denied access to the endpoint (HTTP 403)."
          : "Sales API authentication failed (HTTP 401).";
        throw new SalesApiError("auth", message, response.status);
      }
      if (response.status === 409) {
        let sourceChanged = false;
        try {
          const conflict = await response.json() as Record<string, unknown>;
          sourceChanged = conflict.code === "source_changed" || conflict.error === "source_changed" ||
            object(conflict.error)?.code === "source_changed";
        } catch { /* status alone is not enough */ }
        if (sourceChanged) throw new SalesApiError("source_changed", "Sales source changed during traversal.", 409);
      }
      if (response.status === 429) {
        const retryAfter = this.retryAfter(response);
        const delay = retryAfter.delayMs;
        // Never shorten an upstream Retry-After.  If it cannot fit inside our
        // generous cumulative wait budget, report the upstream retryAt and
        // stop instead of making an early request.
        if (delay > MAX_RATE_LIMIT_WAIT_MS || this.rateLimitWaitMs + delay > MAX_RATE_LIMIT_WAIT_MS) {
          throw this.rateLimitedError(component, retryAfter.retryAt, metrics);
        }
        this.rateLimitWaitMs += delay;
        const retryAt = retryAfter.retryAt;
        this.rateLimit = {
          component, retryAt, retryAfterSeconds: Math.ceil(delay / 1000),
          pageSize: PAGE_LIMIT, requestsMade: metrics.requestsMade, completedPages: metrics.completedPages,
          requestLimit: SALES_REQUEST_LIMIT, requestWindowSeconds: SALES_REQUEST_WINDOW_SECONDS,
        };
        await this.sleep(delay);
        continue;
      }
      if (!response.ok) throw new SalesApiError("network", `Sales API returned HTTP ${response.status}.`, response.status);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new SalesApiError("schema", "Sales API returned invalid JSON."); }
      if (!coverage) coverage = extractCoverage(payload);
      rows.push(...extractRows(payload));
      completedPages++;
      metrics.completedPages++;
      metrics.byComponent[component].completedPages++;
      expectedPages = expectedPages ?? pageCount(payload);
      cursor = nextCursor(payload);
      if (!cursor) break;
    }
    if (!coverage) throw new SalesApiError("schema", "Sales API coverage was not returned.");
    const requestMetrics: SalesRequestMetrics = {
      pageSize: PAGE_LIMIT, requestsMade: metrics.byComponent[component].requestsMade,
      completedPages: metrics.byComponent[component].completedPages,
      requestLimit: SALES_REQUEST_LIMIT, requestWindowSeconds: SALES_REQUEST_WINDOW_SECONDS,
      ...(expectedPages != null ? { expectedPages } : {}),
      countLabel: "actual",
    };
    return { rows, coverage, requestMetrics };
  }

  private async request(url: string, init: RequestInit, component: "sales" | "margin"): Promise<Response> {
    const now = this.now();
    const recent = this.requestStarts.filter((started) => now - started < SALES_REQUEST_WINDOW_SECONDS * 1000);
    this.requestStarts = recent;
    const previous = this.requestStarts.at(-1);
    const windowDelay = recent.length >= SALES_REQUEST_LIMIT
      ? Math.max(0, SALES_REQUEST_WINDOW_SECONDS * 1000 - (now - recent[0]!))
      : 0;
    const pacingDelay = previous == null ? 0 : Math.max(0, REQUEST_INTERVAL_MS - (now - previous));
    const delay = Math.max(windowDelay, pacingDelay);
    if (delay > 0) await this.sleep(delay);
    this.requestStarts.push(this.now());
    try {
      return await this.fetcher(url, init);
    } catch {
      throw new SalesApiError("network", "Sales API network request failed.");
    }
  }

  private retryAfter(response: Response): { delayMs: number; retryAt: string } {
    const value = response.headers.get("retry-after");
    if (value) {
      const trimmed = value.trim();
      const seconds = Number(trimmed);
      if (Number.isFinite(seconds) && seconds > 0) {
        const delayMs = seconds * 1000;
        return { delayMs, retryAt: new Date(this.now() + delayMs).toISOString() };
      }
      // Numeric zero/negative values are invalid Retry-After values; do not
      // feed them to Date.parse (some runtimes interpret "0" as year 2000).
      const date = Number.isFinite(seconds) ? NaN : Date.parse(value);
      if (Number.isFinite(date) && date > this.now()) {
        return { delayMs: date - this.now(), retryAt: new Date(date).toISOString() };
      }
    }
    const prior = this.rateLimit?.retryAfterSeconds ?? 0;
    const delayMs = Math.max(1_000, prior * 2_000 || 1_000);
    return { delayMs, retryAt: new Date(this.now() + delayMs).toISOString() };
  }

  private rateLimitedError(
    component: "sales" | "margin",
    retryAt: string,
    metrics: MetricsAccumulator,
  ): SalesApiError {
    const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(retryAt) - this.now()) / 1000));
    this.rateLimit = {
      component, retryAt, retryAfterSeconds,
      pageSize: PAGE_LIMIT, requestsMade: metrics.requestsMade, completedPages: metrics.completedPages,
      requestLimit: SALES_REQUEST_LIMIT, requestWindowSeconds: SALES_REQUEST_WINDOW_SECONDS,
    };
    return new SalesApiError("rate_limited", "Sales API remains rate limited after a bounded wait.", 429);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const salesApiClient = new SalesApiClient();
let activeSalesApiClient: SalesApiClient = salesApiClient;
export const setSalesApiClientForTests = (client: SalesApiClient): void => {
  activeSalesApiClient = client;
};
export const resetSalesApiClient = (): void => {
  activeSalesApiClient = salesApiClient;
};
export const getSalesApiStatus = (): SalesApiStatus => activeSalesApiClient.status();
export const getCachedSalesSnapshot = (): SalesSnapshot | null => activeSalesApiClient.cachedSnapshot();
export const getSalesSnapshot = (options?: { refresh?: boolean; period?: string }): Promise<SalesSnapshot> =>
  activeSalesApiClient.getSnapshot(options);
export const getSalesOptionSnapshot = (options?: { sales?: boolean; margin?: boolean; refresh?: boolean; period?: string }): Promise<SalesSnapshot> =>
  activeSalesApiClient.getOptionSnapshot(options);
export const getSalesComponentStatus = (component: "sales" | "margin"): SalesComponentStatus =>
  activeSalesApiClient.componentStatus(component);
export const clearSalesSnapshot = (): void => activeSalesApiClient.clearCache();