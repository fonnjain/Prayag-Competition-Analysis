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
  | { available: true; status: "authenticated"; dataSource: string };

export type SalesComponentStatus = {
  available: boolean;
  status: "missing_credential" | "auth_failed" | "unavailable" | "authenticated";
  reason?: string;
  dataSource?: string;
  endpoint?: string;
  upstreamStatus?: number;
  lastAttemptAt?: string | null;
  coverage?: SalesCoverage | null;
};

export class SalesApiError extends Error {
  readonly kind: "missing_credential" | "auth" | "network" | "schema" | "source_changed";
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
const MAX_RESTARTS = 2;
export const SUPPORTED_SALES_PERIOD = "2026-27";
const AWAITING_CONFIRMATION = new Set([
  "WCT-3LL-10", "WCT-3LL-05", "WCT-3LL-07", "PSS-5",
  "824XD", "924XD", "824SD", "HD140B", "HD160B", "HD200B",
]);
export const awaitingConfirmationCodes = [...AWAITING_CONFIRMATION].sort();

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
  return value.trim().toUpperCase().replace(/\s+/g, "").replace(/\.0$/, "");
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

export class SalesApiClient {
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;
  private readonly key: string | undefined;
  private cached: SalesSnapshot | null = null;
  private lastFailure: SalesApiError | null = null;
  private salesCache: { rows: SalesRow[]; coverage: SalesCoverage; fetchedAt: string } | null = null;
  private marginCache: { rows: MarginRow[]; coverage: SalesCoverage; fetchedAt: string } | null = null;
  private salesFailure: SalesApiError | null = null;
  private marginFailure: SalesApiError | null = null;
  private salesLastAttemptAt: string | null = null;
  private marginLastAttemptAt: string | null = null;

  constructor(options: { fetch?: FetchLike; apiKey?: string; baseUrl?: string } = {}) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.key = options.apiKey ?? process.env.SALES_API_KEY;
    this.baseUrl = (options.baseUrl ?? process.env.SALES_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  status(): SalesApiStatus {
    if (!this.key?.trim()) return { available: false, status: "missing_credential", reason: "Sales API credential is not configured." };
    if (this.lastFailure?.kind === "auth") {
      const reason = this.lastFailure.statusCode === 403
        ? "Sales API denied access to the endpoint (HTTP 403)."
        : "Sales API authentication failed (HTTP 401).";
      return { available: false, status: "auth_failed", reason };
    }
    if (this.lastFailure) return { available: false, status: "unavailable", reason: "Sales API snapshot is unavailable." };
    if (this.cached) return this.cached.availability;
    return { available: false, status: "unavailable", reason: "Sales API snapshot has not been authenticated." };
  }

  clearCache(): void {
    this.cached = null; this.lastFailure = null; this.salesCache = null; this.marginCache = null;
    this.salesFailure = null; this.marginFailure = null;
  }
  cachedSnapshot(): SalesSnapshot | null { return this.cached; }

  componentStatus(component: "sales" | "margin"): SalesComponentStatus {
    const endpoint = component === "sales" ? "/api/external/sales-by-item" : "/api/external/margin-by-item";
    const lastAttemptAt = component === "sales" ? this.salesLastAttemptAt : this.marginLastAttemptAt;
    const cache = component === "sales" ? this.salesCache : this.marginCache;
    const failure = component === "sales" ? this.salesFailure : this.marginFailure;
    if (!this.key?.trim()) return { available: false, status: "missing_credential", reason: "Sales API credential is not configured.", endpoint, lastAttemptAt };
    if (failure?.kind === "auth") return { available: false, status: "auth_failed", reason: failure.message, endpoint, upstreamStatus: failure.statusCode, lastAttemptAt };
    if (failure) return { available: false, status: "unavailable", reason: failure.message, endpoint, upstreamStatus: failure.statusCode, lastAttemptAt };
    if (cache) return {
      available: true, status: "authenticated", dataSource: cache.coverage.dataSource ?? this.baseUrl,
      endpoint, lastAttemptAt, coverage: cache.coverage,
    };
    return { available: false, status: "unavailable", reason: "Sales API endpoint has not been authenticated.", endpoint, lastAttemptAt };
  }

  private snapshotFromParts(
    period: string,
    salesRows: SalesRow[],
    salesCoverage: SalesCoverage,
    marginRows: MarginRow[],
    marginCoverage: SalesCoverage,
    fetchedAt = new Date().toISOString(),
  ): SalesSnapshot {
    const dataSource = salesCoverage.dataSource ?? marginCoverage.dataSource ?? this.baseUrl;
    return {
      fetchedAt, period, dataSource, salesRows, marginRows,
      salesByCode: aggregateSales(salesRows),
      awaitingConfirmationByCode: aggregateSales(salesRows.filter((row) => AWAITING_CONFIRMATION.has(row.code)), true),
      awaitingByCode: aggregateSales(salesRows.filter((row) => AWAITING_CONFIRMATION.has(row.code)), true),
      marginByCode: aggregateMargin(marginRows, marginCoverage),
      coverage: { sales: salesCoverage, margin: marginCoverage },
      availability: { available: true, status: "authenticated", dataSource },
    };
  }

  async getOptionSnapshot(options: { sales?: boolean; margin?: boolean; refresh?: boolean; period?: string } = {}): Promise<SalesSnapshot> {
    const period = options.period ?? SUPPORTED_SALES_PERIOD;
    if (period !== SUPPORTED_SALES_PERIOD) throw new SalesApiError("schema", `Sales period ${period} is not supported; only ${SUPPORTED_SALES_PERIOD} is available.`);
    if (!options.sales && !options.margin) return this.getSnapshot({ refresh: options.refresh, period });
    if (!this.key?.trim()) throw new SalesApiError("missing_credential", "Sales API credential is not configured.");
    const emptyCoverage = (): SalesCoverage => ({
      requested: [], returned: [], held: [], unavailable: [], provisional: [], read_at: null,
      reconciliation: {}, dataSource: this.baseUrl, last_modified: null,
    });
    let salesPart = options.sales ? this.salesCache : null;
    let marginPart = options.margin ? this.marginCache : null;
    if (options.sales && (!salesPart || options.refresh)) {
      this.salesLastAttemptAt = new Date().toISOString();
      try {
        const source = await this.traverse("/api/external/sales-by-item?fy=2026-27&from=2026-04&to=2026-08");
        salesPart = { rows: source.rows.map(parseSalesRow), coverage: source.coverage, fetchedAt: new Date().toISOString() };
        this.salesCache = salesPart; this.salesFailure = null;
      } catch (error) {
        this.salesFailure = error instanceof SalesApiError ? error : new SalesApiError("network", "Sales API network request failed.");
        throw this.salesFailure;
      }
    }
    if (options.margin && (!marginPart || options.refresh)) {
      this.marginLastAttemptAt = new Date().toISOString();
      try {
        const source = await this.traverse("/api/external/margin-by-item?fy=2026-27&from=2026-04&to=2026-06");
        marginPart = { rows: source.rows.map(parseMarginRow), coverage: source.coverage, fetchedAt: new Date().toISOString() };
        this.marginCache = marginPart; this.marginFailure = null;
      } catch (error) {
        this.marginFailure = error instanceof SalesApiError ? error : new SalesApiError("network", "Sales API network request failed.");
        throw this.marginFailure;
      }
    }
    const snapshot = this.snapshotFromParts(
      period,
      salesPart?.rows ?? [], salesPart?.coverage ?? emptyCoverage(),
      marginPart?.rows ?? [], marginPart?.coverage ?? emptyCoverage(),
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
    if (this.cached && !this.lastFailure && this.cached.period === period && !options.refresh) return this.cached;
    for (let restart = 0; restart <= MAX_RESTARTS; restart++) {
      try {
        // Coverage is parsed and validated before any row is accepted.
        const sales = await this.traverse("/api/external/sales-by-item?fy=2026-27&from=2026-04&to=2026-08");
        const margin = await this.traverse("/api/external/margin-by-item?fy=2026-27&from=2026-04&to=2026-06");
           const parsedSalesRows = sales.rows.map(parseSalesRow);
           const parsedMarginRows = margin.rows.map(parseMarginRow);
           const snapshot: SalesSnapshot = {
           fetchedAt: new Date().toISOString(),
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
          availability: {
            available: true,
            status: "authenticated",
             dataSource: typeof sales.coverage.dataSource === "string" ? sales.coverage.dataSource :
               typeof margin.coverage.dataSource === "string" ? margin.coverage.dataSource : this.baseUrl,
          },
        };
         this.cached = snapshot;
        this.salesCache = { rows: parsedSalesRows, coverage: sales.coverage, fetchedAt: snapshot.fetchedAt };
        this.marginCache = { rows: parsedMarginRows, coverage: margin.coverage, fetchedAt: snapshot.fetchedAt };
        this.salesFailure = null;
        this.marginFailure = null;
        this.lastFailure = null;
        return snapshot;
      } catch (error) {
        if (!(error instanceof SalesApiError) || error.kind !== "source_changed" || restart >= MAX_RESTARTS) {
           this.lastFailure = error instanceof SalesApiError ? error : new SalesApiError("network", "Sales API snapshot is unavailable.");
           if (this.lastFailure.kind === "auth") this.cached = null;
          throw error;
        }
      }
    }
    throw new SalesApiError("source_changed", "Sales source changed while reading; retry limit exceeded.");
  }

  private async traverse(path: string): Promise<{ rows: unknown[]; coverage: SalesCoverage }> {
    const rows: unknown[] = [];
    let cursor: string | null = null;
    let coverage: SalesCoverage | null = null;
    do {
      const separator = path.includes("?") ? "&" : "?";
      const url = `${this.baseUrl}${path}${separator}limit=${PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      let response: Response;
      try {
        response = await this.fetcher(url, { method: "GET", headers: { "X-API-Key": this.key! } });
        if (response.status === 401 || response.status === 403) {
          // The upstream contract accepts either header style.  Keep the API
          // key attempt first, and only spend one bounded retry on Bearer.
          response = await this.fetcher(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${this.key!}` },
          });
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
      if (!response.ok) throw new SalesApiError("network", `Sales API returned HTTP ${response.status}.`, response.status);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new SalesApiError("schema", "Sales API returned invalid JSON."); }
      if (!coverage) coverage = extractCoverage(payload);
      rows.push(...extractRows(payload));
      cursor = nextCursor(payload);
    } while (cursor);
    if (!coverage) throw new SalesApiError("schema", "Sales API coverage was not returned.");
    return { rows, coverage };
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