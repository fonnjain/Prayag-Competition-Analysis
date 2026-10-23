import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import XLSX from "xlsx";
import { finderAsOf, finderScope, exactQueryCodes, scopedFinderCompetitors } from "../lib/priceFinderCompetitors";
import { readFinderEvidence } from "../lib/priceFinderEvidence";
import priceCalculatorRouter from "./priceCalculator";
import { rankProductSearchRows } from "@workspace/formatting";
import { productSearchCondition } from "../lib/productSearchCondition";
import { bucketCodeAllowed, bucketCompetitorAllowed, bucketCompetitorSql, bucketSql, bucketExportRows } from "../lib/bucketFilter";
import {
  priceChangePct,
  validToFromNextDate,
  validToFromNextDateOrDiscontinuation,
} from "../lib/priceWindow.js";
import {
  marketGapPct,
  resolveUpcomingCompetitiveGap,
} from "../lib/analysis.js";

const router: IRouter = Router();
router.use(priceCalculatorRouter);

type PriceFinderCompetitor = string;

router.get("/price-finder/competitors", async (req, res) => {
  try {
    res.json(await scopedFinderCompetitors(finderScope(req.query), finderAsOf(req.query.asOf)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Competitor scope could not be loaded." });
  }
});

async function comparisonScope(query: Record<string, unknown>) {
  const codes = exactQueryCodes(query.code ?? query.codes);
  if (!codes.length) throw new Error("Select between 1 and 50 products.");
  const asOf = finderAsOf(query.asOf);
  const coverage = await scopedFinderCompetitors({ itemCodes: codes, division: null, category: null }, asOf);
  const available = coverage.competitors.map(c => c.competitor);
  const requested = queryArray(query.competitor);
  return { codes, asOf, competitors: requested.length ? requested.filter(c => available.includes(c)) : available };
}

function queryArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function comparisonAsOf(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return new Date().toISOString().slice(0, 10);
  }
  const asOf = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("asOf must be a valid date in YYYY-MM-DD format.");
  }
  const parsed = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== asOf) {
    throw new Error("asOf must be a valid date in YYYY-MM-DD format.");
  }
  return asOf;
}

function sqlList(values: string[]) {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

type ComparisonProductRow = {
  item_code: string;
  product_name: string | null;
  division: string | null;
  category: string | null;
  discontinued_from: string | null;
  prayag_mrp: number | null;
  prayag_date: string | null;
  prayag_next_mrp: number | null;
  prayag_next_date: string | null;
};

type ComparisonPriceRow = {
  item_code: string;
  competitor: string;
  current_price: number | null;
  current_date: string | null;
  next_price: number | null;
  next_date: string | null;
};

function normalizeComparisonPrice(price: number | null): number | null {
  return price == null ? null : Number(price);
}

async function buildPriceFinderComparison(
  codes: string[],
  competitors: PriceFinderCompetitor[],
  asOf: string,
) {
  codes = codes.filter(bucketCodeAllowed);
  competitors = competitors.filter(brand => codes.some(code => bucketCompetitorAllowed(brand, code)));
  const codeList = codes.length ? sqlList(codes) : sql`NULL`;
  const productResult = await db.execute<ComparisonProductRow>(sql`
    SELECT
      p.item_code,
      p.product_name,
      p.division,
      p.category,
      p.discontinued_from,
      current_price.mrp AS prayag_mrp,
      current_price.effective_date AS prayag_date,
      upcoming_price.mrp AS prayag_next_mrp,
      upcoming_price.effective_date AS prayag_next_date
    FROM catalog_products p
    LEFT JOIN LATERAL (
      SELECT h.mrp, h.effective_date
      FROM mrp_price_history h
      WHERE h.item_code = p.item_code
        AND h.variant = 'Standard'
        AND h.mrp IS NOT NULL
        AND h.review_status = 'approved'
        AND h.effective_date <= ${asOf}
      ORDER BY h.effective_date DESC, h.id DESC
      LIMIT 1
    ) current_price ON true
    LEFT JOIN LATERAL (
      SELECT h.mrp, h.effective_date
      FROM mrp_price_history h
      WHERE h.item_code = p.item_code
        AND h.variant = 'Standard'
        AND h.mrp IS NOT NULL
        AND h.review_status = 'approved'
        AND h.effective_date > ${asOf}
        AND (p.discontinued_from IS NULL OR h.effective_date < p.discontinued_from)
      ORDER BY h.effective_date ASC, h.id DESC
      LIMIT 1
    ) upcoming_price ON true
    WHERE p.item_code IN (${codeList})
      AND p.is_active IS TRUE
      AND (p.discontinued_from IS NULL OR p.discontinued_from > ${asOf})
  `);

  const productMap = new Map(productResult.rows.map((row) => [row.item_code, row]));
  const unknownCodes = codes.filter((code) => !productMap.has(code));
  if (unknownCodes.length > 0) {
    throw new Error(`Unknown or inactive product code: ${unknownCodes.join(", ")}`);
  }

  const pricesResult = competitors.length ? await db.execute<ComparisonPriceRow>(sql`
    SELECT
      p.item_code,
      brands.competitor,
      current_price.normalized_price AS current_price,
      current_price.effective_date AS current_date,
      upcoming_price.normalized_price AS next_price,
      upcoming_price.effective_date AS next_date
    FROM catalog_products p
    CROSS JOIN (VALUES ${sql.join(
      competitors.map((competitor) => sql`(${competitor})`),
      sql`, `,
    )}) AS brands(competitor)
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN lower(coalesce(cp.price_basis, '')) = 'ex-gst'
            THEN cp.price * (1 + coalesce(cp.gst_pct, 18) / 100.0)
          ELSE cp.price
        END AS normalized_price,
        cp.effective_date
      FROM competitor_prices cp
      WHERE cp.competitor = brands.competitor
        AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
        AND cp.matched_prayag_code = p.item_code
        AND cp.match_status = 'matched'
        AND cp.price IS NOT NULL
        AND cp.effective_date <= ${asOf}
      ORDER BY cp.effective_date DESC, cp.id DESC
      LIMIT 1
    ) current_price ON true
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN lower(coalesce(cp.price_basis, '')) = 'ex-gst'
            THEN cp.price * (1 + coalesce(cp.gst_pct, 18) / 100.0)
          ELSE cp.price
        END AS normalized_price,
        cp.effective_date
      FROM competitor_prices cp
      WHERE cp.competitor = brands.competitor
        AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
        AND cp.matched_prayag_code = p.item_code
        AND cp.match_status = 'matched'
        AND cp.price IS NOT NULL
        AND cp.effective_date > ${asOf}
      ORDER BY cp.effective_date ASC, cp.id DESC
      LIMIT 1
    ) upcoming_price ON true
    WHERE p.item_code IN (${codeList})
      AND p.is_active IS TRUE
      AND (p.discontinued_from IS NULL OR p.discontinued_from > ${asOf})
  `) : { rows: [] as ComparisonPriceRow[] };

  const priceMap = new Map<string, Map<string, ComparisonPriceRow>>();
  for (const row of pricesResult.rows) {
    const byBrand = priceMap.get(row.item_code) ?? new Map<string, ComparisonPriceRow>();
    byBrand.set(row.competitor, row);
    priceMap.set(row.item_code, byBrand);
  }

  const rows = codes.map((itemCode) => {
    const product = productMap.get(itemCode)!;
    const prayagPrice = normalizeComparisonPrice(product.prayag_mrp);
    const prayagNextPrice = normalizeComparisonPrice(product.prayag_next_mrp);
    const byBrand = priceMap.get(itemCode) ?? new Map();
    const competitorRows = competitors.map((competitor) => {
      const priceRow = byBrand.get(competitor);
      const price = normalizeComparisonPrice(priceRow?.current_price ?? null);
      const difference = prayagPrice != null && price != null ? price - prayagPrice : null;
      const differencePct =
        difference != null && prayagPrice && prayagPrice > 0
          ? (difference / prayagPrice) * 100
          : null;
      const upcomingGap = resolveUpcomingCompetitiveGap({
        currentPrayagPrice: prayagPrice,
        currentCompetitorPrice: price,
        currentGapPct: differencePct,
        upcomingPrayagPrice: prayagNextPrice,
        upcomingPrayagEffectiveDate: product.prayag_next_date,
        upcomingCompetitorPrice: normalizeComparisonPrice(
          priceRow?.next_price ?? null,
        ),
        upcomingCompetitorEffectiveDate: priceRow?.next_date ?? null,
      });
      return {
        competitor,
        price,
        effectiveDate: priceRow?.current_date ?? null,
        validTo: validToFromNextDate(priceRow?.next_date ?? null),
        upcomingPrice: normalizeComparisonPrice(priceRow?.next_price ?? null),
        upcomingEffectiveDate: priceRow?.next_date ?? null,
        difference,
        differencePct,
        cheaperSide:
          difference == null ? null : Math.abs(difference) < 0.005 ? "parity" : difference > 0 ? "Prayag" : competitor,
        upcomingGapDate: upcomingGap?.effectiveDate ?? null,
        upcomingGapPrayagPrice: upcomingGap?.prayagPrice ?? null,
        upcomingGapCompetitorPrice: upcomingGap?.competitorPrice ?? null,
        upcomingGapPct: upcomingGap?.gapPct ?? null,
        upcomingGapDirection: upcomingGap?.direction ?? null,
        upcomingGapIsReversal: upcomingGap?.isReversal ?? false,
      };
    });
    return {
      itemCode,
      productName: product.product_name,
      division: product.division,
      category: product.category,
      prayag: {
        price: prayagPrice,
        effectiveDate: product.prayag_date,
        validTo: validToFromNextDateOrDiscontinuation(
          product.prayag_next_date,
          product.discontinued_from,
        ),
        upcomingPrice: prayagNextPrice,
        upcomingEffectiveDate: product.prayag_next_date,
      },
      competitors: competitorRows,
    };
  });

  return { asOfDate: asOf, competitors, rows };
}

type SearchRow = {
  item_code: string;
  product_name: string | null;
  division: string | null;
  category: string | null;
  size: string | null;
  current_mrp: number | null;
  current_effective_date: string | null;
  upcoming_mrp: number | null;
  upcoming_effective_date: string | null;
  has_competitor_data: boolean;
  best_competitor_brand: string | null;
  best_competitor_price: number | null;
  colour_variant_count: number;
  discontinued_from: string | null;
};

function toSearchResult(row: SearchRow) {
  const mrp = row.current_mrp;
  const cp = row.best_competitor_price;
  const gapPct =
    mrp != null && mrp > 0 && cp != null
      ? ((cp - mrp) / mrp) * 100
      : null;
  return {
    itemCode: row.item_code,
    productName: row.product_name,
    division: row.division,
    category: row.category,
    currentMrp: mrp,
    currentEffectiveDate: row.current_effective_date,
    currentValidTo: validToFromNextDateOrDiscontinuation(
      row.upcoming_effective_date,
      row.discontinued_from,
    ),
    upcomingMrp: row.upcoming_mrp,
    upcomingEffectiveDate: row.upcoming_effective_date,
    upcomingChangePct: priceChangePct(mrp, row.upcoming_mrp),
    hasCompetitorData: row.has_competitor_data,
    bestCompetitorBrand: row.best_competitor_brand ?? null,
    bestCompetitorPrice: cp ?? null,
    bestCompetitorGapPct: gapPct,
    colourVariantCount: row.colour_variant_count ?? 0,
    discontinuedFrom: row.discontinued_from,
  };
}
function getFilterTerms(req: Request): string[] {
  const rawFilters = req.query.filters;
  const values = Array.isArray(rawFilters)
    ? rawFilters
    : typeof rawFilters === "string"
      ? [rawFilters]
      : typeof req.query.q === "string"
        ? [req.query.q]
        : [];
  return values.map(String).map((value) => value.trim()).filter(Boolean);
}

async function findSearchRows(filters: string[], asOf = finderAsOf(undefined)): Promise<SearchRow[]> {
  const filterConditions = filters.map(productSearchCondition);
  const result = await db.execute<SearchRow>(sql`
    SELECT
      p.item_code,
      p.product_name,
      p.division,
      p.category,
      p.size,
      p.discontinued_from,
      current_price.mrp AS current_mrp,
      current_price.effective_date AS current_effective_date,
      upcoming_price.mrp AS upcoming_mrp,
      upcoming_price.effective_date AS upcoming_effective_date,
      EXISTS (
        SELECT 1
        FROM competitor_prices cp
        WHERE cp.matched_prayag_code = p.item_code
          AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
          AND cp.price IS NOT NULL
          AND cp.effective_date <= ${asOf}::date
      ) AS has_competitor_data,
      best_comp.competitor AS best_competitor_brand,
      best_comp.normalized_price AS best_competitor_price,
      (
        SELECT COUNT(DISTINCT h2.variant)::int
        FROM mrp_price_history h2
        WHERE h2.item_code = p.item_code
          AND h2.variant != 'Standard'
          AND h2.mrp IS NOT NULL
          AND h2.effective_date <= ${asOf}::date
          AND h2.review_status = 'approved'
      ) AS colour_variant_count
    FROM catalog_products p
    JOIN LATERAL (
      SELECT h.mrp, h.effective_date
      FROM mrp_price_history h
      WHERE h.item_code = p.item_code
        AND h.effective_date <= ${asOf}::date
        AND h.mrp IS NOT NULL
        AND h.review_status = 'approved'
        AND h.variant = 'Standard'
      ORDER BY h.effective_date DESC, h.id DESC
      LIMIT 1
    ) current_price ON true
    LEFT JOIN LATERAL (
      SELECT h.mrp, h.effective_date
      FROM mrp_price_history h
      WHERE h.item_code = p.item_code
        AND h.effective_date > ${asOf}::date
        AND h.mrp IS NOT NULL
        AND h.review_status = 'approved'
        AND h.variant = 'Standard'
        AND (p.discontinued_from IS NULL OR h.effective_date < p.discontinued_from)
      ORDER BY h.effective_date ASC, h.id DESC
      LIMIT 1
    ) upcoming_price ON true
    LEFT JOIN LATERAL (
      SELECT
        cp.competitor,
        CASE
          WHEN lower(coalesce(cp.price_basis, '')) = 'ex-gst'
            THEN cp.price * (1 + coalesce(cp.gst_pct, 18) / 100.0)
          ELSE cp.price
        END AS normalized_price
      FROM competitor_prices cp
      WHERE cp.matched_prayag_code = p.item_code
        AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
        AND cp.price IS NOT NULL
        AND cp.effective_date <= ${asOf}::date
      ORDER BY ABS(
        CASE
          WHEN lower(coalesce(cp.price_basis, '')) = 'ex-gst'
            THEN cp.price * (1 + coalesce(cp.gst_pct, 18) / 100.0)
          ELSE cp.price
        END - current_price.mrp
      ), normalized_price ASC
      LIMIT 1
    ) best_comp ON true
    WHERE p.is_active IS TRUE
      AND ${bucketSql(sql`p.item_code`)}
      AND (p.discontinued_from IS NULL OR p.discontinued_from > ${asOf}::date)
      AND ${sql.join(filterConditions, sql` AND `)}
  `);
  return result.rows;
}

router.get("/price-finder/search", async (req, res) => {
  let asOf: string;
  try { asOf = finderAsOf(req.query.asOf); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Invalid date" }); return; }
  const filters = getFilterTerms(req);
  if (filters.length === 0) {
    res.json({ results: [], totalCount: 0, filterSuggestions: [], unmatchedFilters: [] });
    return;
  }

  const rawLimit = Number(req.query.limit);
  const limit = Math.min(3000, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 3000));
  const acceptedFilters: string[] = [];
  let searchRows: SearchRow[] = [];
  const unmatchedFilters: string[] = [];
  for (const filter of filters) {
    const narrowedRows = await findSearchRows([...acceptedFilters, filter], asOf);
    if (narrowedRows.length === 0) {
      unmatchedFilters.push(filter);
      break;
    }
    acceptedFilters.push(filter);
    searchRows = narrowedRows;
  }

  const results = rankProductSearchRows(searchRows, acceptedFilters)
    .slice(0, limit)
    .map(toSearchResult);

  const suggestionFields = [
    { field: "Category", key: "category" as const },
    { field: "Size", key: "size" as const },
    { field: "Division", key: "division" as const },
  ];
  const filterSuggestions = suggestionFields
    .map(({ field, key }) => {
      const counts = new Map<string, number>();
      for (const row of searchRows) {
        const value = row[key]?.trim();
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const values = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));
      return { field, distinctCount: counts.size, values };
    })
    .filter((suggestion) => suggestion.distinctCount > 1)
    .sort((a, b) => b.distinctCount - a.distinctCount)
    .slice(0, 3);

  res.json({
    results,
    totalCount: searchRows.length,
    filterSuggestions,
    unmatchedFilters,
  });
});

router.get("/price-finder/browse", async (req, res) => {
  let asOf: string;
  try { asOf = finderAsOf(req.query.asOf); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Invalid date" }); return; }
  const division =
    typeof req.query.division === "string" && req.query.division.trim()
      ? req.query.division.trim()
      : null;
  const category =
    typeof req.query.category === "string" && req.query.category.trim()
      ? req.query.category.trim()
      : null;
  const rawLimit = Number(req.query.limit);
  const limit = Math.min(300, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 200));

  const divisionRows = await db.execute<{ division: string; count: string | number }>(sql`
    SELECT
      coalesce(nullif(trim(p.division), ''), 'Uncategorised') AS division,
      count(*)::int AS count
    FROM catalog_products p
    WHERE p.is_active IS TRUE
      AND ${bucketSql(sql`p.item_code`)}
      AND (p.discontinued_from IS NULL OR p.discontinued_from > ${asOf}::date)
      AND EXISTS (
        SELECT 1
        FROM mrp_price_history h
        WHERE h.item_code = p.item_code
          AND h.effective_date <= ${asOf}::date
          AND h.mrp IS NOT NULL
          AND h.review_status = 'approved'
      )
    GROUP BY coalesce(nullif(trim(p.division), ''), 'Uncategorised')
    ORDER BY division
  `);

  let categories: Array<{ category: string | null; label: string; count: number }> = [];
  if (division) {
    const categoryRows = await db.execute<{
      category: string | null;
      count: string | number;
    }>(sql`
      SELECT
        nullif(trim(p.category), '') AS category,
        count(*)::int AS count
      FROM catalog_products p
      WHERE coalesce(nullif(trim(p.division), ''), 'Uncategorised') = ${division}
        AND ${bucketSql(sql`p.item_code`)}
        AND p.is_active IS TRUE
        AND (p.discontinued_from IS NULL OR p.discontinued_from > ${asOf}::date)
        AND EXISTS (
          SELECT 1
          FROM mrp_price_history h
          WHERE h.item_code = p.item_code
            AND h.effective_date <= ${asOf}::date
            AND h.mrp IS NOT NULL
            AND h.review_status = 'approved'
        )
      GROUP BY nullif(trim(p.category), '')
      ORDER BY category NULLS LAST
    `);
    categories = categoryRows.rows.map((row) => ({
      category: row.category,
      label: row.category ?? "Uncategorised",
      count: Number(row.count),
    }));
  }

  let products: SearchRow[] = [];
  if (division && category) {
    const categoryCondition =
      category === "__uncategorised__"
        ? sql`(p.category IS NULL OR trim(p.category) = '')`
        : sql`p.category = ${category}`;
    const productRows = await db.execute<SearchRow>(sql`
      SELECT
        p.item_code,
        p.product_name,
        p.division,
        p.category,
        p.size,
        p.discontinued_from,
        current_price.mrp AS current_mrp,
        current_price.effective_date AS current_effective_date,
        upcoming_price.mrp AS upcoming_mrp,
        upcoming_price.effective_date AS upcoming_effective_date,
        EXISTS (
          SELECT 1
          FROM competitor_prices cp
          WHERE cp.matched_prayag_code = p.item_code
            AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
            AND cp.price IS NOT NULL
            AND cp.effective_date <= ${asOf}::date
        ) AS has_competitor_data,
        best_comp.competitor AS best_competitor_brand,
        best_comp.normalized_price AS best_competitor_price,
        (
          SELECT COUNT(DISTINCT h2.variant)::int
          FROM mrp_price_history h2
          WHERE h2.item_code = p.item_code
            AND h2.variant != 'Standard'
            AND h2.mrp IS NOT NULL
            AND h2.effective_date <= ${asOf}::date
            AND h2.review_status = 'approved'
        ) AS colour_variant_count
      FROM catalog_products p
      JOIN LATERAL (
        SELECT h.mrp, h.effective_date
        FROM mrp_price_history h
        WHERE h.item_code = p.item_code
          AND h.effective_date <= ${asOf}::date
          AND h.mrp IS NOT NULL
          AND h.review_status = 'approved'
          AND h.variant = 'Standard'
        ORDER BY h.effective_date DESC, h.id DESC
        LIMIT 1
      ) current_price ON true
      LEFT JOIN LATERAL (
        SELECT h.mrp, h.effective_date
        FROM mrp_price_history h
        WHERE h.item_code = p.item_code
          AND h.effective_date > ${asOf}::date
          AND h.mrp IS NOT NULL
          AND h.review_status = 'approved'
          AND h.variant = 'Standard'
          AND (p.discontinued_from IS NULL OR h.effective_date < p.discontinued_from)
        ORDER BY h.effective_date ASC, h.id DESC
        LIMIT 1
      ) upcoming_price ON true
      LEFT JOIN LATERAL (
        SELECT
          cp.competitor,
          CASE
            WHEN lower(coalesce(cp.price_basis, '')) = 'ex-gst'
              THEN cp.price * (1 + coalesce(cp.gst_pct, 18) / 100.0)
            ELSE cp.price
          END AS normalized_price
        FROM competitor_prices cp
        WHERE cp.matched_prayag_code = p.item_code
          AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
          AND cp.price IS NOT NULL
          AND cp.effective_date <= ${asOf}::date
        ORDER BY ABS(
          CASE
            WHEN lower(coalesce(cp.price_basis, '')) = 'ex-gst'
              THEN cp.price * (1 + coalesce(cp.gst_pct, 18) / 100.0)
            ELSE cp.price
          END - current_price.mrp
        ), normalized_price ASC
        LIMIT 1
      ) best_comp ON true
      WHERE coalesce(nullif(trim(p.division), ''), 'Uncategorised') = ${division}
        AND ${bucketSql(sql`p.item_code`)}
        AND ${categoryCondition}
        AND p.is_active IS TRUE
        AND (p.discontinued_from IS NULL OR p.discontinued_from > ${asOf}::date)
      ORDER BY p.item_code
      LIMIT ${limit}
    `);
    products = productRows.rows;
  }

  res.json({
    divisions: divisionRows.rows.map((row) => ({
      division: row.division,
      count: Number(row.count),
    })),
    categories,
    products: products.map(toSearchResult),
  });
});

type ProductRow = {
  item_code: string;
  product_name: string | null;
  division: string | null;
  category: string | null;
  current_mrp: number | null;
  current_effective_date: string | null;
  upcoming_mrp: number | null;
  upcoming_effective_date: string | null;
  discontinued_from: string | null;
};

type CompetitorRow = {
  competitor: string;
  price: number;
  effective_date: string | null;
  price_basis: string | null;
  gst_pct: number | null;
  upcoming_price: number | null;
  upcoming_effective_date: string | null;
};

async function getPriceFinderProduct(req: Request, res: Response) {
    const itemCode =
      typeof req.query.itemCode === "string"
        ? req.query.itemCode
        : typeof req.params.itemCode === "string"
          ? req.params.itemCode
          : "";
    if (!itemCode) {
      res.status(400).json({ error: "itemCode required" });
      return;
    }
    const evidence = await readFinderEvidence([itemCode], finderAsOf(undefined));
    const product = evidence.products[0];
    if (!product || product.current_mrp == null) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    type VariantRow = {
      variant: string;
      current_mrp: number | null;
      current_effective_date: string | null;
      upcoming_mrp: number | null;
      upcoming_effective_date: string | null;
    };
    const variantRows = { rows: evidence.variants };

    const variantItems = variantRows.rows.map((row) => ({
      variant: row.variant,
      currentMrp: row.current_mrp,
      currentEffectiveDate: row.current_effective_date,
      upcomingMrp: row.upcoming_mrp,
      upcomingEffectiveDate: row.upcoming_effective_date,
      upcomingChangePct: priceChangePct(row.current_mrp, row.upcoming_mrp),
    }));

    const competitors = { rows: evidence.competitors };

    const prayagMrp = product.current_mrp;
    const competitorItems = competitors.rows
      .map((row) => {
        const gapPct = marketGapPct(prayagMrp, row.price);
        const upcomingGap = resolveUpcomingCompetitiveGap({
          currentPrayagPrice: prayagMrp,
          currentCompetitorPrice: row.price,
          currentGapPct: gapPct,
          upcomingPrayagPrice: product.upcoming_mrp,
          upcomingPrayagEffectiveDate: product.upcoming_effective_date,
          upcomingCompetitorPrice: row.upcoming_price,
          upcomingCompetitorEffectiveDate: row.upcoming_effective_date,
        });
        let message: string | null = null;
        if (gapPct != null) {
          const absGap = Math.abs(gapPct);
          message =
            absGap < 0.05
              ? "Prices are at parity"
              : gapPct > 0
                ? `Prayag is ${absGap.toFixed(1)}% cheaper`
                : `Prayag is ${absGap.toFixed(1)}% costlier`;
        }
        return {
          competitor: row.competitor,
          price: row.price,
          effectiveDate: row.effective_date,
          validTo: validToFromNextDate(row.upcoming_effective_date),
          priceBasis: row.price_basis,
          upcomingPrice: row.upcoming_price,
          upcomingEffectiveDate: row.upcoming_effective_date,
          upcomingChangePct: priceChangePct(row.price, row.upcoming_price),
          gapPct,
          message,
          upcomingGapDate: upcomingGap?.effectiveDate ?? null,
          upcomingGapPrayagPrice: upcomingGap?.prayagPrice ?? null,
          upcomingGapCompetitorPrice: upcomingGap?.competitorPrice ?? null,
          upcomingGapPct: upcomingGap?.gapPct ?? null,
          upcomingGapDirection: upcomingGap?.direction ?? null,
          upcomingGapIsReversal: upcomingGap?.isReversal ?? false,
        };
      })
      .sort((a, b) => (a.gapPct ?? Number.POSITIVE_INFINITY) - (b.gapPct ?? Number.POSITIVE_INFINITY));

    res.json({
      product: {
        itemCode: product.item_code,
        productName: product.product_name,
        division: product.division,
        category: product.category,
        currentMrp: product.current_mrp,
        currentEffectiveDate: product.current_effective_date,
        currentValidTo: validToFromNextDateOrDiscontinuation(
          product.upcoming_effective_date,
          product.discontinued_from,
        ),
        upcomingMrp: product.upcoming_mrp,
        upcomingEffectiveDate: product.upcoming_effective_date,
        upcomingChangePct: priceChangePct(product.current_mrp, product.upcoming_mrp),
        discontinuedFrom: product.discontinued_from,
      },
      competitors: competitorItems,
      variants: variantItems,
    });
}

router.get("/price-finder/product", getPriceFinderProduct);
router.get("/price-finder/product/:itemCode", getPriceFinderProduct);

router.get("/price-finder/comparison", async (req, res) => {
  try {
    const { codes, competitors, asOf } = await comparisonScope(req.query);
    res.json(await buildPriceFinderComparison(codes, competitors, asOf));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Comparison could not be loaded.",
    });
  }
});

router.get("/price-finder/comparison/export", async (req, res) => {
  try {
    const { codes, competitors, asOf } = await comparisonScope(req.query);
    const comparison = await buildPriceFinderComparison(codes, competitors, asOf);
    const exportRows = comparison.rows.flatMap((row) =>
      row.competitors.map((competitor) => ({
        "Item code": row.itemCode,
        "Product name": row.productName ?? "",
        Division: row.division ?? "",
        Category: row.category ?? "",
        "As of": comparison.asOfDate,
        "Prayag MRP": row.prayag.price,
        "Prayag effective date": row.prayag.effectiveDate ?? "",
        Competitor: competitor.competitor,
        "Competitor price": competitor.price,
        "Competitor effective date": competitor.effectiveDate ?? "",
        Difference: competitor.difference,
        "Difference %": competitor.differencePct,
        "Cheaper side": competitor.cheaperSide ?? "No data",
        "Prayag upcoming price": row.prayag.upcomingPrice,
        "Prayag upcoming effective date": row.prayag.upcomingEffectiveDate ?? "",
        "Competitor upcoming price": competitor.upcomingPrice,
        "Competitor upcoming effective date": competitor.upcomingEffectiveDate ?? "",
      })),
    );
    const workbook = XLSX.utils.book_new();
    const originalSheet = XLSX.utils.json_to_sheet(exportRows);
    const sheet = XLSX.utils.aoa_to_sheet(bucketExportRows(
      XLSX.utils.sheet_to_json<(string | number | null)[]>(originalSheet, { header: 1 }),
    ));
    XLSX.utils.book_append_sheet(workbook, sheet, "Price comparison");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="prayag-price-comparison-${asOf}.xlsx"`,
    );
    res.send(buffer);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Comparison export could not be created.",
    });
  }
});

export default router;
