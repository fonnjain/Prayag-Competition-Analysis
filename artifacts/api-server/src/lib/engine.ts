import { db } from "@workspace/db";
import {
  productsTable,
  competitorsTable,
  comparisonsTable,
  settingsTable,
  type Product,
  type Competitor as CompetitorRow,
  type Comparison,
} from "@workspace/db";

export type Basis = "net" | "mrp";
export type Status =
  | "leader"
  | "competitive"
  | "above_market"
  | "overpriced"
  | "no_data";

export interface CompetitorCell {
  competitor: string;
  basis: Basis;
  price: number | null;
  diffPct: number | null;
  isCheapest: boolean;
}

export interface ProductRow {
  itemCode: string;
  category: string;
  size: string | null;
  prayagMrp: number | null;
  prayagNet: number | null;
  kgCost: number | null;
  basis: Basis;
  shownPrice: number | null;
  competitors: CompetitorCell[];
  cheapestRival: number | null;
  cheapestRivalName: string | null;
  prayagLowest: boolean;
  rivalCount: number;
  status: Status;
  marketMin: number | null;
  marketMedian: number | null;
  marketMax: number | null;
  suggestedPrice: number | null;
  aggressiveTarget: number | null;
  gap: number | null;
  gapPct: number | null;
  marginConstrained: boolean;
  edited: boolean;
}

export interface CompetitorSummary {
  name: string;
  basis: string;
  productsCompared: number;
  prayagCheaper: number;
  prayagCheaperPct: number | null;
  avgSavingPct: number | null;
  hidden: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

export interface EngineData {
  products: Product[];
  competitors: CompetitorRow[];
  comparisons: Comparison[];
  minimumMarginPct: number;
}

export async function loadEngineData(): Promise<EngineData> {
  const [products, competitors, comparisons, settingsRows] = await Promise.all([
    db.select().from(productsTable),
    db.select().from(competitorsTable),
    db.select().from(comparisonsTable),
    db.select().from(settingsTable),
  ]);
  const minimumMarginPct = settingsRows[0]?.minimumMarginPct ?? 15;
  return { products, competitors, comparisons, minimumMarginPct };
}

// Aggregate competitor price points: one price + basis per competitor per item.
interface AggCell {
  competitor: string;
  basis: Basis;
  price: number;
}

function aggregateForItem(
  itemCode: string,
  comparisons: Comparison[],
  visibleSet: Set<string>,
): AggCell[] {
  const byComp = new Map<string, Comparison[]>();
  for (const c of comparisons) {
    if (c.itemCode !== itemCode) continue;
    if (!visibleSet.has(c.competitor)) continue;
    if (c.compPrice == null) continue;
    const arr = byComp.get(c.competitor) ?? [];
    arr.push(c);
    byComp.set(c.competitor, arr);
  }
  const cells: AggCell[] = [];
  for (const [competitor, rows] of byComp) {
    const basis = (mode(rows.map((r) => r.basis)) ?? "net") as Basis;
    const prices = rows
      .filter((r) => r.basis === basis && r.compPrice != null)
      .map((r) => r.compPrice as number);
    const price = median(prices);
    if (price == null) continue;
    cells.push({ competitor, basis, price });
  }
  return cells;
}

export function computeRow(
  product: Product,
  comparisons: Comparison[],
  visibleCompetitors: string[],
  minimumMarginPct: number,
): ProductRow {
  const visibleSet = new Set(visibleCompetitors);
  const agg = aggregateForItem(product.itemCode, comparisons, visibleSet);
  const aggByName = new Map(agg.map((a) => [a.competitor, a]));

  const prayagNet = product.prayagNet;
  const prayagMrp = product.prayagMrp;

  const netCells = agg.filter((a) => a.basis === "net");
  const mrpCells = agg.filter((a) => a.basis === "mrp");

  const canNet = netCells.length > 0 && prayagNet != null;
  const canMrp = mrpCells.length > 0 && prayagMrp != null;
  const basis: Basis = canNet ? "net" : canMrp ? "mrp" : "net";
  const shownPrice = basis === "net" ? prayagNet : prayagMrp;

  // Market over chosen-basis cells.
  const basisCells = agg.filter((a) => a.basis === basis);
  const basisPrices = basisCells.map((a) => a.price);
  const marketMin = basisPrices.length ? Math.min(...basisPrices) : null;
  const marketMax = basisPrices.length ? Math.max(...basisPrices) : null;
  const marketMedian = median(basisPrices);

  // Build display cells, one per visible competitor in column order.
  const cheapestName =
    marketMin != null
      ? (basisCells.find((a) => a.price === marketMin)?.competitor ?? null)
      : null;

  const competitors: CompetitorCell[] = visibleCompetitors.map((name) => {
    const cell = aggByName.get(name);
    if (!cell) {
      return {
        competitor: name,
        basis,
        price: null,
        diffPct: null,
        isCheapest: false,
      };
    }
    const prayagForBasis = cell.basis === "net" ? prayagNet : prayagMrp;
    const diffPct =
      prayagForBasis != null && prayagForBasis !== 0
        ? (cell.price - prayagForBasis) / prayagForBasis
        : null;
    return {
      competitor: name,
      basis: cell.basis,
      price: cell.price,
      diffPct,
      isCheapest: cell.basis === basis && cell.price === marketMin,
    };
  });

  const hasMarket = basisPrices.length > 0 && shownPrice != null;

  let status: Status = "no_data";
  if (hasMarket && shownPrice != null && marketMin != null && marketMax != null && marketMedian != null) {
    if (shownPrice <= marketMin) status = "leader";
    else if (shownPrice <= marketMedian) status = "competitive";
    else if (shownPrice <= marketMax) status = "above_market";
    else status = "overpriced";
  }

  // Recommendation
  const floor =
    product.kgCost != null
      ? product.kgCost * (1 + minimumMarginPct / 100)
      : null;
  let suggestedPrice: number | null = null;
  let aggressiveTarget: number | null = null;
  let marginConstrained = false;
  if (hasMarket && marketMedian != null) {
    suggestedPrice = marketMedian * 0.98;
    if (marketMin != null) aggressiveTarget = marketMin * 0.98;
    if (floor != null && suggestedPrice < floor) {
      suggestedPrice = floor;
      marginConstrained = true;
    }
    if (floor != null && aggressiveTarget != null && aggressiveTarget < floor) {
      aggressiveTarget = floor;
    }
  }

  const gap =
    suggestedPrice != null && shownPrice != null
      ? suggestedPrice - shownPrice
      : null;
  const gapPct =
    gap != null && shownPrice != null && shownPrice !== 0
      ? gap / shownPrice
      : null;

  return {
    itemCode: product.itemCode,
    category: product.category,
    size: product.size,
    prayagMrp,
    prayagNet,
    kgCost: product.kgCost,
    basis,
    shownPrice,
    competitors,
    cheapestRival: marketMin,
    cheapestRivalName: cheapestName,
    prayagLowest: status === "leader",
    rivalCount: basisPrices.length,
    status,
    marketMin,
    marketMedian,
    marketMax,
    suggestedPrice,
    aggressiveTarget,
    gap,
    gapPct,
    marginConstrained,
    edited: product.edited,
  };
}

export function visibleCompetitorOrder(data: EngineData): string[] {
  const counts = new Map<string, number>();
  for (const c of data.comparisons) {
    if (c.compPrice == null) continue;
    counts.set(c.competitor, (counts.get(c.competitor) ?? 0) + 1);
  }
  return data.competitors
    .filter((c) => !c.hidden)
    .sort((a, b) => {
      const d = (counts.get(b.name) ?? 0) - (counts.get(a.name) ?? 0);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    })
    .map((c) => c.name);
}

export function computeAllRows(data: EngineData): {
  rows: ProductRow[];
  visibleCompetitors: string[];
} {
  const visibleCompetitors = visibleCompetitorOrder(data);
  const rows = data.products
    .map((p) =>
      computeRow(p, data.comparisons, visibleCompetitors, data.minimumMarginPct),
    )
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  return { rows, visibleCompetitors };
}

// Per-competitor summary stats (includes hidden competitors so the user sees data).
export function competitorSummaries(data: EngineData): CompetitorSummary[] {
  const allNames = data.competitors.map((c) => c.name);
  const visibleAll = allNames; // compute stats regardless of hidden
  const stats = new Map<
    string,
    { compared: number; cheaper: number; savings: number[] }
  >();
  for (const name of allNames)
    stats.set(name, { compared: 0, cheaper: 0, savings: [] });

  for (const product of data.products) {
    const agg = aggregateForItem(
      product.itemCode,
      data.comparisons,
      new Set(visibleAll),
    );
    for (const cell of agg) {
      const prayag = cell.basis === "net" ? product.prayagNet : product.prayagMrp;
      if (prayag == null || prayag === 0) continue;
      const diffPct = (cell.price - prayag) / prayag;
      const s = stats.get(cell.competitor)!;
      s.compared += 1;
      if (diffPct > 0) s.cheaper += 1;
      s.savings.push(diffPct);
    }
  }

  return data.competitors.map((c) => {
    const s = stats.get(c.name)!;
    const avg =
      s.savings.length > 0
        ? s.savings.reduce((a, b) => a + b, 0) / s.savings.length
        : null;
    return {
      name: c.name,
      basis: c.basis,
      productsCompared: s.compared,
      prayagCheaper: s.cheaper,
      prayagCheaperPct: s.compared > 0 ? s.cheaper / s.compared : null,
      avgSavingPct: avg,
      hidden: c.hidden,
    };
  });
}
