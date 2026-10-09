import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import XLSX from "xlsx";
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

const PRICE_FINDER_COMPETITORS = ["Sparsh Pearl", "Ashirvad", "Prince", "Vectus"] as const;
type PriceFinderCompetitor = (typeof PRICE_FINDER_COMPETITORS)[number];

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
function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s\-_.]/g, "");
}

const SPOKEN_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function normaliseSpokenQuery(value: string): string {
  let text = value
    .toLowerCase()
    .replace(/\b(?:dash|hyphen)\b/g, "-")
    .replace(/\bone and a half inch(?:es)?\b/g, '1.5"');
  const tokens = text.split(/\s+/).filter(Boolean);
  const output: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    if (!(tokens[i] in SPOKEN_NUMBERS) && tokens[i] !== "hundred") {
      output.push(tokens[i]);
      i++;
      continue;
    }

    const phrase: string[] = [];
    while (
      i < tokens.length &&
      (tokens[i] in SPOKEN_NUMBERS ||
        tokens[i] === "hundred" ||
        tokens[i] === "and")
    ) {
      if (tokens[i] !== "and") phrase.push(tokens[i]);
      i++;
    }
    if (phrase.length === 0) continue;

    const values = phrase.map((token) =>
      token === "hundred" ? 100 : SPOKEN_NUMBERS[token],
    );
    let number = 0;
    if (
      values.length === 3 &&
      values[0] < 10 &&
      values[1] >= 20 &&
      values[2] < 10
    ) {
      // The common spoken-code form: "one twenty one" → 121.
      number = values[0] * 100 + values[1] + values[2];
    } else {
      let current = 0;
      for (const part of values) {
        if (part === 100) {
          current = (current || 1) * 100;
          number += current;
          current = 0;
        } else if (part >= 20) {
          current += part;
        } else {
          current += part;
        }
      }
      number += current;
    }
    output.push(String(number));
  }

  return output.join(" ");
}

const FILTER_FILLER = /\b(?:show me|find|what is the price of|what's the price of|ka price|wala)\b/gi;

function filterVariants(value: string): string[] {
  const raw = value.trim().toLowerCase();
  const cleaned = raw.replace(FILTER_FILLER, " ").replace(/\s+/g, " ").trim();
  const spoken = normaliseSpokenQuery(cleaned);
  const variants = [raw, cleaned, spoken];

  if (cleaned.includes("half inch")) {
    variants.push(cleaned.replace(/\bhalf inch\b/g, '½"'));
    variants.push(cleaned.replace(/\bhalf inch\b/g, '0.5 inch'));
  }
  if (cleaned.includes("three quarter")) {
    variants.push(cleaned.replace(/\bthree quarter\b/g, '¾"'));
    variants.push(cleaned.replace(/\bthree quarter\b/g, '0.75 inch'));
  }

  const synonymVariants = [...variants];
  for (const variant of variants) {
    if (/\btap\b/.test(variant)) synonymVariants.push(variant.replace(/\btap\b/g, "cock"));
    if (/\bptmt\b/.test(variant)) {
      synonymVariants.push(variant.replace(/\bptmt\b/g, "ptmt & plastic fittings"));
    }
    if (/\bss\b/.test(variant)) synonymVariants.push(variant.replace(/\bss\b/g, "stainless steel"));
  }

  return synonymVariants.filter(
    (candidate, index, all) => candidate && all.indexOf(candidate) === index,
  );
}

function filterCondition(term: string) {
  const conditions = filterVariants(term).flatMap((variant) => {
    const like = `%${variant}%`;
    const normalizedLike = `%${normalise(variant)}%`;
    return [
      sql`lower(p.item_code) LIKE ${like}`,
      sql`lower(coalesce(p.product_name, '')) LIKE ${like}`,
      sql`lower(coalesce(p.division, '')) LIKE ${like}`,
      sql`lower(coalesce(p.category, '')) LIKE ${like}`,
      sql`lower(coalesce(p.size, '')) LIKE ${like}`,
      sql`regexp_replace(lower(p.item_code), '[^a-z0-9]', '', 'g') LIKE ${normalizedLike}`,
      sql`regexp_replace(lower(coalesce(p.product_name, '')), '[^a-z0-9]', '', 'g') LIKE ${normalizedLike}`,
      sql`regexp_replace(lower(coalesce(p.division, '')), '[^a-z0-9]', '', 'g') LIKE ${normalizedLike}`,
      sql`regexp_replace(lower(coalesce(p.category, '')), '[^a-z0-9]', '', 'g') LIKE ${normalizedLike}`,
      sql`regexp_replace(lower(coalesce(p.size, '')), '[^a-z0-9]', '', 'g') LIKE ${normalizedLike}`,
    ];
  });
  return sql`(${sql.join(conditions, sql` OR `)})`;
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

function searchScore(row: SearchRow, query: string): number {
  const queries = filterVariants(query);
  const code = normalise(row.item_code);
  const name = normalise(row.product_name ?? "");
  const division = normalise(row.division ?? "");
  const category = normalise(row.category ?? "");
  const size = normalise(row.size ?? "");

  return Math.max(
    ...queries.map((candidate) => {
      const q = normalise(candidate);
      if (code === q) return 1000;
      if (code.startsWith(q)) return 900 - Math.min(code.length, 100) / 100;
      if (code.includes(q)) return 800 - Math.min(code.indexOf(q), 100) / 100;
      if (name.startsWith(q)) return 700;
      if (name.includes(q)) return 600 - Math.min(name.indexOf(q), 100) / 100;
      if (division.includes(q)) return 550 - Math.min(division.indexOf(q), 100) / 100;
      if (category.startsWith(q)) return 500;
      if (category.includes(q)) return 400 - Math.min(category.indexOf(q), 100) / 100;
      if (size.includes(q)) return 350 - Math.min(size.indexOf(q), 100) / 100;
      return 0;
    }),
  );
}

async function findSearchRows(filters: string[]): Promise<SearchRow[]> {
  const filterConditions = filters.map(filterCondition);
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
          AND cp.effective_date <= CURRENT_DATE
      ) AS has_competitor_data,
      best_comp.competitor AS best_competitor_brand,
      best_comp.normalized_price AS best_competitor_price,
      (
        SELECT COUNT(DISTINCT h2.variant)::int
        FROM mrp_price_history h2
        WHERE h2.item_code = p.item_code
          AND h2.variant != 'Standard'
          AND h2.mrp IS NOT NULL
          AND h2.effective_date <= CURRENT_DATE
          AND h2.review_status = 'approved'
      ) AS colour_variant_count
    FROM catalog_products p
    JOIN LATERAL (
      SELECT h.mrp, h.effective_date
      FROM mrp_price_history h
      WHERE h.item_code = p.item_code
        AND h.effective_date <= CURRENT_DATE
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
        AND h.effective_date > CURRENT_DATE
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
        AND cp.effective_date <= CURRENT_DATE
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
      AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
      AND ${sql.join(filterConditions, sql` AND `)}
  `);
  return result.rows;
}

router.get("/price-finder/search", async (req, res) => {
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
    const narrowedRows = await findSearchRows([...acceptedFilters, filter]);
    if (narrowedRows.length === 0) {
      unmatchedFilters.push(filter);
      break;
    }
    acceptedFilters.push(filter);
    searchRows = narrowedRows;
  }

  const results = searchRows
    .map((row) => ({
      row,
      score: acceptedFilters.reduce(
        (total, filter) => total + searchScore(row, filter),
        0,
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.row.item_code.localeCompare(b.row.item_code, undefined, {
          numeric: true,
        }),
    )
    .slice(0, limit)
    .map(({ row }) => toSearchResult(row));

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
      AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
      AND EXISTS (
        SELECT 1
        FROM mrp_price_history h
        WHERE h.item_code = p.item_code
          AND h.effective_date <= CURRENT_DATE
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
        AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
        AND EXISTS (
          SELECT 1
          FROM mrp_price_history h
          WHERE h.item_code = p.item_code
            AND h.effective_date <= CURRENT_DATE
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
            AND cp.effective_date <= CURRENT_DATE
        ) AS has_competitor_data,
        best_comp.competitor AS best_competitor_brand,
        best_comp.normalized_price AS best_competitor_price,
        (
          SELECT COUNT(DISTINCT h2.variant)::int
          FROM mrp_price_history h2
          WHERE h2.item_code = p.item_code
            AND h2.variant != 'Standard'
            AND h2.mrp IS NOT NULL
            AND h2.effective_date <= CURRENT_DATE
            AND h2.review_status = 'approved'
        ) AS colour_variant_count
      FROM catalog_products p
      JOIN LATERAL (
        SELECT h.mrp, h.effective_date
        FROM mrp_price_history h
        WHERE h.item_code = p.item_code
          AND h.effective_date <= CURRENT_DATE
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
          AND h.effective_date > CURRENT_DATE
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
          AND cp.effective_date <= CURRENT_DATE
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
        AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
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
        ? req.query.itemCode.trim()
        : typeof req.params.itemCode === "string"
          ? req.params.itemCode.trim()
          : "";
    if (!itemCode) {
      res.status(400).json({ error: "itemCode required" });
      return;
    }
    const products = await db.execute<ProductRow>(sql`
      SELECT
        p.item_code,
        p.product_name,
        p.division,
        p.category,
        p.discontinued_from,
        current_price.mrp AS current_mrp,
        current_price.effective_date AS current_effective_date,
        upcoming_price.mrp AS upcoming_mrp,
        upcoming_price.effective_date AS upcoming_effective_date
      FROM catalog_products p
      JOIN LATERAL (
        SELECT h.mrp, h.effective_date
        FROM mrp_price_history h
        WHERE h.item_code = p.item_code
          AND h.effective_date <= CURRENT_DATE
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
          AND h.effective_date > CURRENT_DATE
          AND h.mrp IS NOT NULL
          AND h.review_status = 'approved'
          AND h.variant = 'Standard'
          AND (p.discontinued_from IS NULL OR h.effective_date < p.discontinued_from)
        ORDER BY h.effective_date ASC, h.id DESC
        LIMIT 1
      ) upcoming_price ON true
      WHERE p.item_code = ${itemCode}
        AND p.is_active IS TRUE
        AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
      LIMIT 1
    `);

    const product = products.rows[0];
    if (!product) {
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
    const variantRows = await db.execute<VariantRow>(sql`
      SELECT
        v.variant,
        cur.mrp AS current_mrp,
        cur.effective_date AS current_effective_date,
        upc.mrp AS upcoming_mrp,
        upc.effective_date AS upcoming_effective_date
      FROM (
        SELECT DISTINCT variant
        FROM mrp_price_history
        WHERE item_code = ${product.item_code}
          AND variant != 'Standard'
          AND mrp IS NOT NULL
          AND review_status = 'approved'
      ) v
      JOIN LATERAL (
        SELECT mrp, effective_date
        FROM mrp_price_history
        WHERE item_code = ${product.item_code}
          AND variant = v.variant
          AND effective_date <= CURRENT_DATE
          AND mrp IS NOT NULL
          AND review_status = 'approved'
        ORDER BY effective_date DESC, id DESC
        LIMIT 1
      ) cur ON true
      LEFT JOIN LATERAL (
        SELECT mrp, effective_date
        FROM mrp_price_history
        WHERE item_code = ${product.item_code}
          AND variant = v.variant
          AND effective_date > CURRENT_DATE
          AND mrp IS NOT NULL
          AND review_status = 'approved'
        ORDER BY effective_date ASC, id DESC
        LIMIT 1
      ) upc ON true
      ORDER BY v.variant
    `);

    const variantItems = variantRows.rows.map((row) => ({
      variant: row.variant,
      currentMrp: row.current_mrp,
      currentEffectiveDate: row.current_effective_date,
      upcomingMrp: row.upcoming_mrp,
      upcomingEffectiveDate: row.upcoming_effective_date,
      upcomingChangePct: priceChangePct(row.current_mrp, row.upcoming_mrp),
    }));

    const competitors = await db.execute<CompetitorRow>(sql`
      SELECT
        brands.competitor,
        CASE
          WHEN lower(coalesce(current_price.price_basis, '')) = 'ex-gst'
            THEN current_price.price * (1 + coalesce(current_price.gst_pct, 18) / 100.0)
          ELSE current_price.price
        END AS price,
        current_price.effective_date,
        current_price.price_basis,
        current_price.gst_pct,
        CASE
          WHEN lower(coalesce(upcoming_price.price_basis, '')) = 'ex-gst'
            THEN upcoming_price.price * (1 + coalesce(upcoming_price.gst_pct, 18) / 100.0)
          ELSE upcoming_price.price
        END AS upcoming_price,
        upcoming_price.effective_date AS upcoming_effective_date
      FROM (
        SELECT DISTINCT cp.competitor
        FROM competitor_prices cp
        WHERE cp.matched_prayag_code = ${product.item_code}
          AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
          AND cp.match_status = 'matched'
          AND cp.price IS NOT NULL
          AND cp.effective_date <= CURRENT_DATE
      ) brands
      JOIN LATERAL (
        SELECT cp.price, cp.effective_date, cp.price_basis, cp.gst_pct
        FROM competitor_prices cp
        WHERE cp.competitor = brands.competitor
          AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
          AND cp.matched_prayag_code = ${product.item_code}
          AND cp.match_status = 'matched'
          AND cp.price IS NOT NULL
          AND cp.effective_date <= CURRENT_DATE
        ORDER BY cp.effective_date DESC, cp.id DESC
        LIMIT 1
      ) current_price ON true
      LEFT JOIN LATERAL (
        SELECT cp.price, cp.effective_date, cp.price_basis, cp.gst_pct
        FROM competitor_prices cp
        WHERE cp.competitor = brands.competitor
          AND ${bucketCompetitorSql(sql`cp.competitor`, sql`cp.matched_prayag_code`)}
          AND cp.matched_prayag_code = ${product.item_code}
          AND cp.match_status = 'matched'
          AND cp.price IS NOT NULL
          AND cp.effective_date > CURRENT_DATE
        ORDER BY cp.effective_date ASC, cp.id DESC
        LIMIT 1
      ) upcoming_price ON true
      ORDER BY brands.competitor
    `);

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
  const codes = [...new Set(queryArray(req.query.code ?? req.query.codes))];
  const requestedCompetitors = [...new Set(queryArray(req.query.competitor))];
  const competitors = (
    requestedCompetitors.length > 0 ? requestedCompetitors : ["Sparsh Pearl"]
  ) as PriceFinderCompetitor[];

  if (codes.length === 0 || codes.length > 50) {
    res.status(400).json({ error: "Select between 1 and 50 products." });
    return;
  }
  if (
    competitors.some(
      (competitor) =>
        !PRICE_FINDER_COMPETITORS.includes(competitor as PriceFinderCompetitor),
    )
  ) {
    res.status(400).json({
      error: `Competitor must be one of: ${PRICE_FINDER_COMPETITORS.join(", ")}.`,
    });
    return;
  }

  try {
    const asOf = comparisonAsOf(req.query.asOf);
    res.json(await buildPriceFinderComparison(codes, competitors, asOf));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Comparison could not be loaded.",
    });
  }
});

router.get("/price-finder/comparison/export", async (req, res) => {
  const codes = [...new Set(queryArray(req.query.code ?? req.query.codes))];
  const requestedCompetitors = [...new Set(queryArray(req.query.competitor))];
  const competitors = (
    requestedCompetitors.length > 0 ? requestedCompetitors : ["Sparsh Pearl"]
  ) as PriceFinderCompetitor[];

  if (codes.length === 0 || codes.length > 50) {
    res.status(400).json({ error: "Select between 1 and 50 products." });
    return;
  }
  if (
    competitors.some(
      (competitor) =>
        !PRICE_FINDER_COMPETITORS.includes(competitor as PriceFinderCompetitor),
    )
  ) {
    res.status(400).json({
      error: `Competitor must be one of: ${PRICE_FINDER_COMPETITORS.join(", ")}.`,
    });
    return;
  }

  try {
    const asOf = comparisonAsOf(req.query.asOf);
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
