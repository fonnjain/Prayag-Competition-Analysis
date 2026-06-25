import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Product, Competitor, Comparison } from "@workspace/db";
import type { EngineData } from "../lib/engine";

// These tests exercise the API routes that wrap the pricing engine end-to-end
// (through Express + the real route handlers), with the database swapped out for
// an in-memory fixture. They guard the mapping from engine output to the JSON
// the dashboard, recommendations, products, and competitors screens consume, so
// a route that mis-maps a field or mis-counts a KPI fails here instead of
// silently shipping wrong numbers.

// `@workspace/db` connects to Postgres at import time (and throws without
// DATABASE_URL). The route modules import `db` and the table objects as values,
// so we stub the module. None of the GET routes under test touch `db` directly
// (they go through the mocked `loadEngineData`), so empty stubs are enough.
vi.mock("@workspace/db", () => ({
  db: {},
  productsTable: {},
  competitorsTable: {},
  comparisonsTable: {},
  settingsTable: {},
  competitorPricesTable: {},
  catalogProductsTable: {},
  mrpPriceHistoryTable: {},
  codeConflictsTable: {},
}));

// Hoisted handle so the mocked `loadEngineData` can read whatever dataset the
// current test installs. `vi.mock` is hoisted above module-level declarations,
// so we cannot close over a plain `let`.
const engine = vi.hoisted(() => ({ data: null as EngineData | null }));

vi.mock("../lib/engine", async (importActual) => {
  const actual = await importActual<typeof import("../lib/engine")>();
  return {
    ...actual,
    loadEngineData: async (): Promise<EngineData> => {
      if (!engine.data) throw new Error("test engine data not set");
      return engine.data;
    },
  };
});

let compId = 0;
function mkComparison(
  partial: Pick<Comparison, "competitor" | "itemCode" | "basis"> &
    Partial<Comparison>,
): Comparison {
  return {
    id: ++compId,
    compMrp: null,
    compPrice: null,
    matchMethod: "code",
    sourceFile: null,
    edited: false,
    ...partial,
  };
}

function mkProduct(
  partial: Partial<Product> & Pick<Product, "itemCode">,
): Product {
  return {
    category: "FITTINGS",
    size: null,
    prayagMrp: null,
    prayagNet: null,
    kgCost: null,
    edited: false,
    ...partial,
  };
}

function mkCompetitor(
  partial: Pick<Competitor, "name"> & Partial<Competitor>,
): Competitor {
  return { basis: "net", hidden: false, ...partial };
}

// Three net rivals at {100, 150, 200}: market_min=100, median=150, max=200.
function netMarket(itemCode: string): Comparison[] {
  return [
    mkComparison({ competitor: "A", itemCode, basis: "net", compPrice: 100 }),
    mkComparison({ competitor: "B", itemCode, basis: "net", compPrice: 150 }),
    mkComparison({ competitor: "C", itemCode, basis: "net", compPrice: 200 }),
  ];
}

// A fixture spanning every status against the {100,150,200} market:
//  - L  (net 90)  -> leader       (<= min)        FITTINGS
//  - C1 (net 140) -> competitive  (min<..<=median) FITTINGS
//  - AM (net 180) -> above_market (median<..<=max) PIPES
//  - OP (net 250) -> overpriced   (> max)          PIPES
//  - ND (net 100) -> no_data      (no rivals)      PIPES
function sampleData(): EngineData {
  return {
    products: [
      mkProduct({ itemCode: "L", prayagNet: 90, category: "FITTINGS" }),
      mkProduct({ itemCode: "C1", prayagNet: 140, category: "FITTINGS" }),
      mkProduct({ itemCode: "AM", prayagNet: 180, category: "PIPES" }),
      mkProduct({ itemCode: "OP", prayagNet: 250, category: "PIPES" }),
      mkProduct({ itemCode: "ND", prayagNet: 100, category: "PIPES" }),
    ],
    competitors: [
      mkCompetitor({ name: "A" }),
      mkCompetitor({ name: "B" }),
      mkCompetitor({ name: "C" }),
    ],
    comparisons: [
      ...netMarket("L"),
      ...netMarket("C1"),
      ...netMarket("AM"),
      ...netMarket("OP"),
      // ND deliberately has no comparisons.
    ],
    minimumMarginPct: 15,
  };
}

let server: Server;
let baseUrl: string;

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

beforeAll(async () => {
  // Import after the mocks are registered so the route modules pick up the
  // stubbed db and engine. Mount the real routers on a minimal app.
  const express = (await import("express")).default;
  const dashboardRouter = (await import("./dashboard")).default;
  const recommendationsRouter = (await import("./recommendations")).default;
  const productsRouter = (await import("./products")).default;
  const competitorsRouter = (await import("./competitors")).default;

  const app = express();
  app.use(express.json());
  app.use("/api", dashboardRouter);
  app.use("/api", recommendationsRouter);
  app.use("/api", productsRouter);
  app.use("/api", competitorsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  engine.data = sampleData();
});

describe("GET /api/dashboard", () => {
  it("reports KPI counts and competitive share over compared products", async () => {
    const { status, body } = await get("/api/dashboard");
    expect(status).toBe(200);

    expect(body.totalProducts).toBe(5);
    expect(body.comparedProducts).toBe(4); // ND is no_data, excluded
    expect(body.leaderCount).toBe(1);
    expect(body.competitiveCount).toBe(1);
    expect(body.aboveMarketCount).toBe(1);
    expect(body.overpricedCount).toBe(1);
    // (leader + competitive) / compared = 2 / 4
    expect(body.competitiveShare).toBeCloseTo(0.5, 10);
  });

  it("excludes hidden competitors from win-rate and counts where Prayag is cheaper", async () => {
    const data = sampleData();
    data.competitors.push(mkCompetitor({ name: "Hidden", hidden: true }));
    data.comparisons.push(
      mkComparison({
        competitor: "Hidden",
        itemCode: "L",
        basis: "net",
        compPrice: 999,
      }),
    );
    engine.data = data;

    const { body } = await get("/api/dashboard");
    const names = body.competitorWinRates.map((w: any) => w.competitor);
    expect(names).not.toContain("Hidden");
    expect(names.sort()).toEqual(["A", "B", "C"]);

    // C is priced 200 across L/C1/AM/OP, so it is dearer than Prayag (i.e.
    // Prayag cheaper) on L(90), C1(140) and AM(180) -> 3; B(150) on L,C1 -> 2;
    // A(100) on L -> 1.
    const byName = Object.fromEntries(
      body.competitorWinRates.map((w: any) => [w.competitor, w]),
    );
    expect(byName["A"].productsCompared).toBe(4);
    expect(byName["A"].prayagCheaper).toBe(1);
    expect(byName["B"].prayagCheaper).toBe(2);
    expect(byName["C"].prayagCheaper).toBe(3);
  });

  it("breaks down competitiveness by category", async () => {
    const { body } = await get("/api/dashboard");
    const byCat = Object.fromEntries(
      body.categoryBreakdown.map((c: any) => [c.category, c]),
    );

    expect(byCat["FITTINGS"].total).toBe(2);
    expect(byCat["FITTINGS"].leader).toBe(1);
    expect(byCat["FITTINGS"].competitive).toBe(1);
    expect(byCat["FITTINGS"].competitivePct).toBeCloseTo(1, 10);

    expect(byCat["PIPES"].total).toBe(3); // AM, OP, ND
    expect(byCat["PIPES"].aboveMarket).toBe(1);
    expect(byCat["PIPES"].overpriced).toBe(1);
    // Only AM and OP are compared in PIPES, neither is leader/competitive.
    expect(byCat["PIPES"].competitivePct).toBeCloseTo(0, 10);
  });

  it("returns zeroed KPIs when nothing is comparable", async () => {
    engine.data = {
      products: [mkProduct({ itemCode: "X", prayagNet: 100 })],
      competitors: [],
      comparisons: [],
      minimumMarginPct: 15,
    };
    const { body } = await get("/api/dashboard");
    expect(body.totalProducts).toBe(1);
    expect(body.comparedProducts).toBe(0);
    expect(body.competitiveShare).toBe(0);
    expect(body.competitorWinRates).toEqual([]);
  });
});

describe("GET /api/recommendations", () => {
  it("returns one item per compared product, sorted by gap ascending", async () => {
    const { status, body } = await get("/api/recommendations");
    expect(status).toBe(200);
    expect(body).toHaveLength(4); // ND (no_data) is excluded

    // suggested = median*0.98 = 147 for every product; gap = 147 - shownPrice.
    // OP(-103) < AM(-33) < C1(7) < L(57).
    expect(body.map((r: any) => r.itemCode)).toEqual(["OP", "AM", "C1", "L"]);

    const l = body.find((r: any) => r.itemCode === "L");
    expect(l.currentPrice).toBe(90);
    expect(l.marketMin).toBe(100);
    expect(l.marketMedian).toBe(150);
    expect(l.marketMax).toBe(200);
    expect(l.suggestedPrice).toBeCloseTo(147, 10);
    expect(l.gap).toBeCloseTo(57, 10);
    expect(l.status).toBe("leader");
    expect(l.rivalCount).toBe(3);
  });

  it("filters by status", async () => {
    const { body } = await get("/api/recommendations?status=overpriced");
    expect(body).toHaveLength(1);
    expect(body[0].itemCode).toBe("OP");
  });

  it("filters by category", async () => {
    const { body } = await get("/api/recommendations?category=FITTINGS");
    expect(body.map((r: any) => r.itemCode).sort()).toEqual(["C1", "L"]);
  });

  it("filters by free-text search over code, size and category", async () => {
    const { body } = await get("/api/recommendations?search=pipes");
    // PIPES products that are compared: AM and OP (ND is no_data).
    expect(body.map((r: any) => r.itemCode).sort()).toEqual(["AM", "OP"]);
  });

  it("treats category=all and status=all as no filter", async () => {
    const { body } = await get(
      "/api/recommendations?category=all&status=all",
    );
    expect(body).toHaveLength(4);
  });
});

describe("GET /api/products (comparison matrix)", () => {
  it("returns every product row plus visible competitor columns", async () => {
    const { status, body } = await get("/api/products");
    expect(status).toBe(200);
    expect(body.total).toBe(5);
    expect(body.rows).toHaveLength(5);
    expect(body.competitors.map((c: any) => c.name).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);

    const op = body.rows.find((r: any) => r.itemCode === "OP");
    expect(op.status).toBe("overpriced");
    expect(op.shownPrice).toBe(250);
    expect(op.competitors).toHaveLength(3);
  });

  it("filters to rows where a rival is cheaper than Prayag", async () => {
    const { body } = await get("/api/products?onlyRivalCheaper=true");
    // marketMin (100) < shownPrice holds for C1(140), AM(180), OP(250).
    expect(body.rows.map((r: any) => r.itemCode).sort()).toEqual([
      "AM",
      "C1",
      "OP",
    ]);
  });

  it("filters by status", async () => {
    const { body } = await get("/api/products?status=leader");
    expect(body.rows.map((r: any) => r.itemCode)).toEqual(["L"]);
    expect(body.total).toBe(1);
  });
});

describe("GET /api/competitors", () => {
  it("summarizes each competitor sorted by products compared", async () => {
    const { status, body } = await get("/api/competitors");
    expect(status).toBe(200);
    expect(body.map((c: any) => c.name).sort()).toEqual(["A", "B", "C"]);
    for (const c of body) {
      expect(c.productsCompared).toBe(4);
    }
    const c = body.find((x: any) => x.name === "C");
    expect(c.prayagCheaper).toBe(3);
  });
});
