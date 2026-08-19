import { Router, type IRouter, type Request } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

type SearchRow = {
  item_code: string;
  product_name: string | null;
  division: string | null;
  category: string | null;
  size: string | null;
  current_mrp: number | null;
  current_effective_date: string | null;
  has_competitor_data: boolean;
};

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
  const queries = [query, normaliseSpokenQuery(query)].filter(
    (candidate, index, all) => candidate && all.indexOf(candidate) === index,
  );
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

router.get("/price-finder/search", async (req, res) => {
  const filters = getFilterTerms(req);
  if (filters.length === 0) {
    res.json({ results: [], totalCount: 0, filterSuggestions: [], unmatchedFilters: [] });
    return;
  }

  const rawLimit = Number(req.query.limit);
  const limit = Math.min(3000, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 3000));
  const filterConditions = filters.map(filterCondition);

  const result = await db.execute<SearchRow>(sql`
    SELECT
      p.item_code,
      p.product_name,
      p.division,
      p.category,
      p.size,
      current_price.mrp AS current_mrp,
      current_price.effective_date AS current_effective_date,
      EXISTS (
        SELECT 1
        FROM competitor_prices cp
        WHERE cp.matched_prayag_code = p.item_code
          AND cp.price IS NOT NULL
          AND cp.effective_date <= CURRENT_DATE
      ) AS has_competitor_data
    FROM catalog_products p
    JOIN LATERAL (
      SELECT h.mrp, h.effective_date
      FROM mrp_price_history h
      WHERE h.item_code = p.item_code
        AND h.effective_date <= CURRENT_DATE
        AND h.mrp IS NOT NULL
      ORDER BY h.effective_date DESC, h.id DESC
      LIMIT 1
    ) current_price ON true
    WHERE p.is_active IS TRUE
      AND ${sql.join(filterConditions, sql` AND `)}
  `);

  const results = result.rows
    .map((row) => ({
      row,
      score: filters.reduce((total, filter) => total + searchScore(row, filter), 0),
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
    .map(({ row }) => ({
      itemCode: row.item_code,
      productName: row.product_name,
      division: row.division,
      category: row.category,
      currentMrp: row.current_mrp,
      currentEffectiveDate: row.current_effective_date,
      hasCompetitorData: row.has_competitor_data,
    }));

  const suggestionFields = [
    { field: "Series", key: "category" as const },
    { field: "Size", key: "size" as const },
    { field: "Division", key: "division" as const },
  ];
  const filterSuggestions = suggestionFields
    .map(({ field, key }) => {
      const counts = new Map<string, number>();
      for (const row of result.rows) {
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
    totalCount: result.rows.length,
    filterSuggestions,
    unmatchedFilters: result.rows.length === 0 ? [filters.at(-1)] : [],
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
      AND EXISTS (
        SELECT 1
        FROM mrp_price_history h
        WHERE h.item_code = p.item_code
          AND h.effective_date <= CURRENT_DATE
          AND h.mrp IS NOT NULL
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
        AND p.is_active IS TRUE
        AND EXISTS (
          SELECT 1
          FROM mrp_price_history h
          WHERE h.item_code = p.item_code
            AND h.effective_date <= CURRENT_DATE
            AND h.mrp IS NOT NULL
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
        current_price.mrp AS current_mrp,
        current_price.effective_date AS current_effective_date,
        EXISTS (
          SELECT 1
          FROM competitor_prices cp
          WHERE cp.matched_prayag_code = p.item_code
            AND cp.price IS NOT NULL
            AND cp.effective_date <= CURRENT_DATE
        ) AS has_competitor_data
      FROM catalog_products p
      JOIN LATERAL (
        SELECT h.mrp, h.effective_date
        FROM mrp_price_history h
        WHERE h.item_code = p.item_code
          AND h.effective_date <= CURRENT_DATE
          AND h.mrp IS NOT NULL
        ORDER BY h.effective_date DESC, h.id DESC
        LIMIT 1
      ) current_price ON true
      WHERE coalesce(nullif(trim(p.division), ''), 'Uncategorised') = ${division}
        AND ${categoryCondition}
        AND p.is_active IS TRUE
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
    products: products.map((row) => ({
      itemCode: row.item_code,
      productName: row.product_name,
      division: row.division,
      category: row.category,
      currentMrp: row.current_mrp,
      currentEffectiveDate: row.current_effective_date,
      hasCompetitorData: row.has_competitor_data,
    })),
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
};

type CompetitorRow = {
  competitor: string;
  price: number;
  effective_date: string | null;
  price_basis: string | null;
  gst_pct: number | null;
};

router.get(
  "/price-finder/product/:itemCode",
  async (req: Request<{ itemCode: string }>, res) => {
    const itemCode = req.params.itemCode;
    const products = await db.execute<ProductRow>(sql`
      SELECT
        p.item_code,
        p.product_name,
        p.division,
        p.category,
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
        ORDER BY h.effective_date DESC, h.id DESC
        LIMIT 1
      ) current_price ON true
      LEFT JOIN LATERAL (
        SELECT h.mrp, h.effective_date
        FROM mrp_price_history h
        WHERE h.item_code = p.item_code
          AND h.effective_date > CURRENT_DATE
        ORDER BY h.effective_date ASC, h.id ASC
        LIMIT 1
      ) upcoming_price ON true
      WHERE p.item_code = ${itemCode}
        AND p.is_active IS TRUE
      LIMIT 1
    `);

    const product = products.rows[0];
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const competitors = await db.execute<CompetitorRow>(sql`
      SELECT DISTINCT ON (cp.competitor)
        cp.competitor,
        CASE
          WHEN lower(coalesce(cp.price_basis, '')) = 'ex-gst'
            THEN cp.price * (1 + coalesce(cp.gst_pct, 18) / 100.0)
          ELSE cp.price
        END AS price,
        cp.effective_date,
        cp.price_basis,
        cp.gst_pct
      FROM competitor_prices cp
      WHERE cp.matched_prayag_code = ${product.item_code}
        AND cp.price IS NOT NULL
        AND cp.effective_date <= CURRENT_DATE
      ORDER BY cp.competitor, cp.effective_date DESC, cp.id DESC
    `);

    const prayagMrp = product.current_mrp;
    const competitorItems = competitors.rows
      .map((row) => {
        const gapPct =
          prayagMrp != null && prayagMrp > 0
            ? ((row.price - prayagMrp) / prayagMrp) * 100
            : null;
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
          priceBasis: row.price_basis,
          gapPct,
          message,
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
        upcomingMrp: product.upcoming_mrp,
        upcomingEffectiveDate: product.upcoming_effective_date,
      },
      competitors: competitorItems,
    });
  },
);

export default router;