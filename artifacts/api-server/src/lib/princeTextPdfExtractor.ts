import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

export type PrincePdfWord = {
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export type PrincePdfItem = {
  cat_no: string;
  variant: string | null;
  mrp: number;
  product_name: string;
  page: number;
  unit: "piece" | "per_metre";
  lengthMeters: number | null;
  /** The printed rate before length normalization (multi-length tables). */
  ratePerMetre: number | null;
  /** The price used for comparison after applying lengthMeters. */
  piecePrice: number;
  /** False when the PDF prints a dash/no rate for this code occurrence. */
  priced: boolean;
  /** British spelling retained for PDF audit consumers. */
  lengthMetres: number | null;
  sourceTokens: string[];
  xMin: number;
};

export type PrincePdfReconciliation = {
  found: number;
  matched: number;
  newCodes: string[];
  missingCodes: string[];
  /** Known codes present only as explicit dash/unpriced evidence. */
  unpricedCodes: string[];
  comparisons: Array<{
    code: string;
    workbook: number;
    extracted: number | null;
    basis: string;
    category: string;
    page: number | null;
    family: string;
    variant: string | null;
    xMin: number | null;
    status: "match" | "difference" | "missing";
  }>;
  differences: Array<{
    code: string;
    workbook: number;
    extracted: number;
    basis: string;
    category: string;
    page: number;
    family: string;
    variant: string | null;
    xMin: number;
  }>;
};

export type PrincePdfExpectedRow = {
  princeCode: string;
  price: number;
  princePriceBasis?: "piece";
  lengthMeters?: number | null;
  category?: string;
  sheet?: string;
};

const CODE = /^(?:SIM|IT|IP)\d{6}$/i;
const clean = (v: string) => v.replace(/\u00a0/g, " ").trim();
const numberValue = (v: string): number | null => {
  const n = Number(v.replace(/,/g, "").replace(/[₹$]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const roundCurrency = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const normCode = (v: string) => clean(v).toUpperCase().replace(/\s+/g, "");

export function parsePrinceBboxWords(bbox: string): Map<number, PrincePdfWord[]> {
  const pages = new Map<number, PrincePdfWord[]>();
  let page = 0;
  for (const line of bbox.split(/\r?\n/)) {
    const pageMatch = line.match(/<page\b[^>]*>/);
    if (pageMatch) {
      page += 1;
      pages.set(page, []);
    }
    if (page === 0) continue;
    const wordPattern =
      /<word\b[^>]*xMin="([\d.]+)"[^>]*yMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*yMax="([\d.]+)"[^>]*>(.*?)<\/word>/g;
    for (const match of line.matchAll(wordPattern)) {
      pages.get(page)!.push({
        xMin: Number(match[1]), yMin: Number(match[2]),
        xMax: Number(match[3]), yMax: Number(match[4]),
        text: clean(match[5]!.replace(/<[^>]+>/g, "")),
      });
    }
  }
  return pages;
}

function rowsForPage(words: PrincePdfWord[]): PrincePdfWord[][] {
  const rows: PrincePdfWord[][] = [];
  for (const word of [...words].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)) {
    const row = rows.find((candidate) => Math.abs(candidate[0]!.yMin - word.yMin) <= 1.5);
    if (row) row.push(word);
    else rows.push([word]);
  }
  return rows.map((row) => row.sort((a, b) => a.xMin - b.xMin));
}

function lengthFromText(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:mtr|met(?:re|er)s?|m)\b/i);
  return match ? Number(match[1]) : null;
}

function lengthAtX(words: PrincePdfWord[], x: number, targetY = Number.POSITIVE_INFINITY): number | null {
  const headings = words
    .filter((word) => targetY === Number.POSITIVE_INFINITY || (word.yMin <= targetY + 5 && targetY - word.yMin <= 120))
    .map((word) => ({ x: word.xMin, length: lengthFromText(word.text) }))
    .filter((entry): entry is { x: number; length: number } => entry.length != null);
  const explicit = [...headings].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
  if (explicit) return explicit.length;
  const metreHeadings = words.filter((word) =>
    /^(?:mtr\.?\)?|meter|metre|metres|meters)$/i.test(word.text),
  );
  const paired = [...metreHeadings]
    .sort((a, b) => Math.abs(a.xMin - x) - Math.abs(b.xMin - x))
    .map((heading) => words
      .filter((word) => /^\d+(?:\.\d+)?$/.test(word.text))
      .filter((word) => Number(word.text) <= 20)
      .filter((word) => Math.abs(word.xMin - heading.xMin) < 50 &&
        word.yMin >= heading.yMin &&
        word.yMin <= heading.yMin + 45 &&
        (targetY === Number.POSITIVE_INFINITY || word.yMin <= targetY + 5))
      .sort((a, b) => Math.abs(a.xMin - heading.xMin) - Math.abs(b.xMin - heading.xMin))[0])
    .find((word): word is PrincePdfWord => !!word);
  return paired ? Number(paired.text) : null;
}

const NON_FAMILY_HEADINGS = new Set([
  "SIZE", "ITEM", "CODE", "STD", "PKG", "RATE", "PER", "PC", "MM", "INCH",
  "SMALL", "NEW", "AVAILABLE", "HSN", "PRINCE", "PLUMBING", "FITTINGS",
]);
const PER_METRE_PAGE_LENGTHS = new Map<number, number>([
  [58, 6],
  [88, 3],
  [89, 3],
]);

function familyAttribution(words: PrincePdfWord[], code: PrincePdfWord): string {
  const candidates = words
    .filter((word) => word.yMin < code.yMin - 3 && Math.abs(word.xMin - code.xMin) < 125)
    .filter((word) => /[A-Za-z]/.test(word.text) && word.text.length >= 3)
    .filter((word) => !CODE.test(normCode(word.text)))
    .filter((word) => !NON_FAMILY_HEADINGS.has(word.text.toUpperCase().replace(/[():]/g, "")))
    .filter((word) => word.text === word.text.toUpperCase() || /^\([A-Z]/.test(word.text));
  if (!candidates.length) return "";
  const latestY = Math.max(...candidates.map((word) => word.yMin));
  const row = candidates
    .filter((word) => Math.abs(word.yMin - latestY) <= 14)
    .sort((a, b) => a.xMin - b.xMin)
    .map((word) => word.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return row;
}

type PrinceRateColumn = { x: number; y: number; perMetre: boolean };

function rateColumns(words: PrincePdfWord[]): PrinceRateColumn[] {
  return words
    .filter((word) => /^rate$/i.test(word.text))
    .map((word) => ({
      x: word.xMin,
      y: word.yMin,
      // The unit must be the unit printed immediately after this header's
      // "Per". A broad x-radius accidentally borrowed "mtr" from the next
      // table and multiplied ordinary piece prices.
      perMetre: (() => {
        const unit = words
          .filter((candidate) =>
            candidate.yMin >= word.yMin - 2 &&
            candidate.yMin <= word.yMin + 35 &&
            Math.abs(candidate.xMin - word.xMin) < 22 &&
            /^(?:pc|mtr\.?|meter|metre|m|metres|meters)$/i.test(candidate.text),
          )
          .sort((a, b) => Math.abs(a.xMin - word.xMin) - Math.abs(b.xMin - word.xMin))[0];
        return !!unit && !/^pc$/i.test(unit.text);
      })(),
    }))
    .sort((a, b) => a.x - b.x);
}

function rateColumnForCode(
  columns: PrinceRateColumn[],
  code: PrincePdfWord,
): PrinceRateColumn | undefined {
  const headers = columns
    .filter((column) => column.y <= code.yMin + 3 && code.yMin - column.y <= 260)
    .sort((a, b) => Math.abs(a.x - code.xMax) - Math.abs(b.x - code.xMax) || b.y - a.y);
  if (!headers.length) return undefined;
  const right = headers.filter((column) => column.x > code.xMax - 4);
  return [...right]
    .filter((column) => !column.perMetre)
    .sort((a, b) => a.x - code.xMax - (b.x - code.xMax) || b.y - a.y)[0] ??
    [...right].sort((a, b) => a.x - code.xMax - (b.x - code.xMax) || b.y - a.y)[0] ??
    headers[0];
}

function codeGroups(words: PrincePdfWord[]): Array<{
  codes: PrincePdfWord[];
  minX: number;
  maxX: number;
  nextMinX: number;
  rateColumn?: PrinceRateColumn;
}> {
  const codes = words
    .filter((word) => CODE.test(normCode(word.text)))
    .sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
  const rows: PrincePdfWord[][] = [];
  for (const code of codes) {
    const row = rows.find((candidate) => Math.abs(candidate[0]!.yMin - code.yMin) <= 1.5);
    if (row) row.push(code);
    else rows.push([code]);
  }
  const groups: PrincePdfWord[][] = [];
  for (const row of rows) {
    const columns = rateColumns(words);
    const withRate = new Map<string, PrincePdfWord[]>();
    const withoutRate: PrincePdfWord[] = [];
    for (const code of row) {
      const column = rateColumnForCode(columns, code);
      if (column) {
        const key = `${column.x}:${column.y}`;
        withRate.set(key, [...(withRate.get(key) ?? []), code]);
      } else {
        withoutRate.push(code);
      }
    }
    for (const bucket of withRate.values()) groups.push(bucket.sort((a, b) => a.xMin - b.xMin));
    if (withoutRate.length) groups.push(withoutRate.sort((a, b) => a.xMin - b.xMin));
    /*
      Grouping by the local header column is more reliable than a fixed x
      threshold: a multi-length AGRI row has code columns separated by dashes,
      while adjacent side-by-side families can have a similar gap.
    */
    continue;
    /*
    for (const code of row.sort((a, b) => a.xMin - b.xMin)) {
      const group = groups[groups.length - 1];
       if (!group || Math.abs(group[0]!.yMin - row[0]!.yMin) > 1.5 || code.xMin - group[group.length - 1]!.xMax > 40) {
        groups.push([code]);
      } else {
        group.push(code);
      }
    }
    */
  }
  return groups.map((group, index) => {
    const next = groups[index + 1];
    const sameRowNext = next && Math.abs(next[0]!.yMin - group[0]!.yMin) <= 1.5
      // A table's rate often sits between the current code column and the
      // next code column (for example CPVC pipe page 4).  The next code's
      // x-position is therefore the boundary; a midpoint would discard the
      // local rate before we ever resolve its header column.
      ? next[0]!.xMin
      : Number.POSITIVE_INFINITY;
    return {
      codes: group,
      minX: Math.min(...group.map((code) => code.xMin)),
      maxX: Math.max(...group.map((code) => code.xMax)),
      nextMinX: sameRowNext,
      rateColumn: rateColumnForCode(rateColumns(words), group[0]!),
    };
  });
}

/**
 * Deterministic positional parser for Prince's text-native catalogue. It
 * preserves x/y evidence and emits one item per code. A row containing several
 * length columns intentionally shares the final Rate/Mtr value; dash tokens are
 * never converted into zero-priced items.
 */
export function parsePrinceBboxCatalogue(
  bbox: string,
  options: { perMetrePages?: Set<number> } = {},
): PrincePdfItem[] {
  const items: PrincePdfItem[] = [];
  for (const [page, words] of parsePrinceBboxWords(bbox)) {
    const pageText = words.map((word) => word.text).join(" ");
    const pageLength = lengthFromText(pageText);
    const rateXs = rateColumns(words);
    for (const group of codeGroups(words)) {
      const groupWords = words.filter((word) =>
        word.xMin >= group.minX - 8 &&
         word.xMin < Math.min(
           group.nextMinX,
           group.rateColumn ? group.rateColumn.x + 35 : Number.POSITIVE_INFINITY,
         ) &&
        group.codes.some((code) => Math.abs(word.yMin - code.yMin) <= 1.5),
      );
      const numeric = groupWords
        .filter((word) => !CODE.test(normCode(word.text)))
        .map((word) => ({ word, value: numberValue(word.text) }))
        .filter((entry): entry is { word: PrincePdfWord; value: number } => entry.value != null && entry.value > 0);
      for (const codeWord of group.codes) {
        const localWords = groupWords.filter((word) => Math.abs(word.yMin - codeWord.yMin) <= 1.5);
        const localNumeric = localWords
          .filter((word) => !CODE.test(normCode(word.text)))
          .map((word) => ({ word, value: numberValue(word.text) }))
          .filter((entry): entry is { word: PrincePdfWord; value: number } => entry.value != null && entry.value > 0);
        let right = localNumeric.filter((entry) => entry.word.xMin > group.maxX);
        if (!right.length) {
          // Some wide tables print one shared rate column at the far right of
          // the row. If the local x-column has no value, retain that row's
          // rightmost numeric candidate rather than dropping the code.
          right = words
             .filter((word) => Math.abs(word.yMin - codeWord.yMin) <= 1.5 && word.xMin > group.maxX)
            .map((word) => ({ word, value: numberValue(word.text) }))
            .filter((entry): entry is { word: PrincePdfWord; value: number } => entry.value != null && entry.value > 0);
        }
         if (!right.length) {
           // Preserve an explicit dash as evidence.  A missing numeric rate is
           // not a zero price and must never be selected for reconciliation.
           const sourceTokenWords = groupWords
             .filter((word) => Math.abs(word.yMin - codeWord.yMin) <= 1.5)
             .sort((a, b) => a.xMin - b.xMin);
           const sourceTokens = (sourceTokenWords.length ? sourceTokenWords : [codeWord])
             .map((word) => word.text);
           items.push({
             cat_no: normCode(codeWord.text),
             variant: null,
             mrp: 0,
             product_name: familyAttribution(words, codeWord),
             page,
             unit: "piece",
             lengthMeters: null,
             ratePerMetre: null,
             piecePrice: 0,
             priced: false,
             lengthMetres: null,
             sourceTokens,
             xMin: codeWord.xMin,
           });
           continue;
         }
         const rateColumn = group.rateColumn ??
           rateXs.find((entry) => entry.x > group.maxX && !entry.perMetre) ??
           rateXs.find((entry) => entry.x > group.maxX) ??
           rateXs[rateXs.length - 1];
         const perMetre = options.perMetrePages?.has(page) ||
           page === 58 ||
           page === 22 ||
           page === 88 ||
           page === 89 ||
           Boolean(rateColumn?.perMetre) ||
           (!rateColumn && PER_METRE_PAGE_LENGTHS.has(page));
        if (perMetre && (rateXs.length === 1 || page === 22) && rateColumn) {
          const shared = words
             .filter((word) => Math.abs(word.yMin - codeWord.yMin) <= 1.5 && word.xMin > rateColumn.x)
            .map((word) => ({ word, value: numberValue(word.text) }))
            .filter((entry): entry is { word: PrincePdfWord; value: number } => entry.value != null && entry.value > 0);
          if (shared.length) right = shared;
        }
         const columnValues = rateColumn
           ? right.filter((entry) => Math.abs(entry.word.xMin - rateColumn.x) <= 20)
           : right;
         const rateValues = columnValues.length ? columnValues : right;
         const decimalRates = rateValues.filter((entry) => /\./.test(entry.word.text));
         const rate = [...decimalRates].sort((a, b) => a.word.xMin - b.word.xMin).at(-1) ??
           [...rateValues].sort((a, b) => a.word.xMin - b.word.xMin).at(-1)!;
        const selected = rate.value;
         const localLength = perMetre
           ? PER_METRE_PAGE_LENGTHS.get(page) ??
             lengthAtX(groupWords, codeWord.xMin, codeWord.yMin) ??
            lengthAtX(words, codeWord.xMin, codeWord.yMin) ??
            PER_METRE_PAGE_LENGTHS.get(page) ??
            pageLength
          : null;
        const sourceTokenWords = groupWords
           .filter((word) => Math.abs(word.yMin - codeWord.yMin) <= 1.5)
          .sort((a, b) => a.xMin - b.xMin);
        const sourceTokens = (sourceTokenWords.length ? sourceTokenWords : [codeWord])
          .map((word) => word.text);
         const piecePrice = roundCurrency(perMetre && localLength ? selected * localLength : selected);
        items.push({
          cat_no: normCode(codeWord.text),
          variant: localLength ? `${localLength} m` : null,
          mrp: piecePrice,
          product_name: familyAttribution(words, codeWord),
          page,
          unit: perMetre ? "per_metre" : "piece",
          lengthMeters: localLength,
          ratePerMetre: perMetre ? selected : null,
          piecePrice,
          priced: true,
          lengthMetres: localLength,
          sourceTokens,
          xMin: codeWord.xMin,
        });
      }
    }
    /*
      const codeWords = row.filter((word) => CODE.test(normCode(word.text)));
      if (!codeWords.length) continue;
      const numeric = row
        .filter((word) => !CODE.test(normCode(word.text)))
        .map((word) => ({ word, value: numberValue(word.text) }))
        .filter((entry): entry is { word: PrincePdfWord; value: number } => entry.value != null && entry.value > 0);
      if (!numeric.length) continue;
      // The final numeric token is Rate Per Mtr in multi-length rows and the
      // item price in ordinary rows. For a side-by-side page, use the closest
      // numeric token to the right of each code, falling back to the row rate.
      for (let index = 0; index < codeWords.length; index += 1) {
        const codeWord = codeWords[index]!;
        const nextDistinctCode = codeWords.slice(index + 1).find((candidate) =>
          candidate.xMin - codeWord.xMin > 70,
        );
        const nextCodeX = nextDistinctCode?.xMin ?? Number.POSITIVE_INFINITY;
        const right = numeric.filter((entry) => entry.word.xMin > codeWord.xMax && entry.word.xMin < nextCodeX);
        const selectedRate = (() => {
          // When a table prints both Rate Per Mtr and Rate Per PC, the
          // workbook contract uses the piece value. Prefer the nearest
          // non-metre rate column; only use per-metre when no piece column is
          // present (for example page 22's triple-layer table).
          const rateColumn =
            rateXs.find((entry) => entry.x > codeWord.xMax && !entry.perMetre) ??
            rateXs.find((entry) => entry.x > codeWord.xMax) ??
            rateXs[rateXs.length - 1];
          const perMetre = options.perMetrePages?.has(page) || Boolean(rateColumn?.perMetre);
          const rate = perMetre
            ? numeric[numeric.length - 1]
            : (rateColumn
              ? (right.filter((entry) => /\./.test(entry.word.text)).sort((a, b) => b.value - a.value)[0] ??
                right.sort((a, b) => b.value - a.value)[0])
              : right[right.length - 1] ?? numeric[numeric.length - 1]);
          return {
            value: rate?.value ?? numeric[numeric.length - 1]!.value,
            perMetre,
          };
        })();
        const perMetre = selectedRate.perMetre;
        const selected = selectedRate.value;
        const trailing = row.filter((word) => word.xMin > codeWord.xMax && word.xMin < nextCodeX).map((word) => word.text);
        const localLength = lengthFromText(trailing.join(" ")) ?? lengthAtX(words, codeWord.xMin) ?? pageLength;
        const piecePrice = perMetre && localLength ? selected * localLength : selected;
        items.push({
          cat_no: normCode(codeWord.text),
          variant: localLength ? `${localLength} m` : null,
          mrp: piecePrice,
          product_name: familyAttribution(words, codeWord),
          page,
          unit: perMetre ? "per_metre" : "piece",
          lengthMeters: localLength,
          ratePerMetre: perMetre ? selected : null,
          piecePrice: piecePrice,
          lengthMetres: localLength,
          sourceTokens: row.map((word) => word.text),
          xMin: codeWord.xMin,
        });
      }*/
  }
  return items;
}

export function reconcilePrincePdf(
  items: PrincePdfItem[],
  known: Map<string, number> | PrincePdfExpectedRow[],
): PrincePdfReconciliation {
  const foundCodes = new Set(items.map((item) => normCode(item.cat_no)));
  const pricedCodes = new Set(items
    .filter((item) => item.priced)
    .map((item) => normCode(item.cat_no)));
  const expectedRows: PrincePdfExpectedRow[] = known instanceof Map
    ? [...known.entries()].map(([princeCode, price]) => ({ princeCode, price }))
    : known as PrincePdfExpectedRow[];
  const comparisons: PrincePdfReconciliation["comparisons"] = [];
  const differences: PrincePdfReconciliation["differences"] = [];
  const byCode = new Map<string, PrincePdfItem[]>();
  const expectedByCode = new Map<string, PrincePdfExpectedRow[]>();
  for (const expected of expectedRows) {
    const code = normCode(expected.princeCode);
    expectedByCode.set(code, [...(expectedByCode.get(code) ?? []), expected]);
  }
  for (const item of items) {
    const code = normCode(item.cat_no);
    byCode.set(code, [...(byCode.get(code) ?? []), item]);
  }
  for (const expected of expectedRows) {
    const code = normCode(expected.princeCode);
    const candidates = (byCode.get(code) ?? []).filter((item) => item.priced);
    const basis = expected.sheet && /(?:casing|ugd)/i.test(expected.sheet)
      ? "piece (PDF rate-per-metre × length)"
      : "piece";
    if (candidates.length === 0) {
      comparisons.push({ code, workbook: expected.price, extracted: null, basis, category: expected.category ?? expected.sheet ?? "", page: null, family: expected.category ?? expected.sheet ?? "", variant: null, xMin: null, status: "missing" });
      continue;
    }
    // Duplicate catalogue codes occur in four workbook pairs. Preserve the
    // PDF occurrence order within the same code: this is the positional
    // occurrence identity (including its page/x/length metadata), never a
    // closest-to-workbook-price choice.
    const occurrenceIndex = (expectedByCode.get(code) ?? []).indexOf(expected);
    const candidate = candidates[occurrenceIndex] ?? [...candidates]
      .sort((a, b) => a.page - b.page || a.xMin - b.xMin)[0]!;
    const extracted = candidate.piecePrice;
    const match = Math.abs(extracted - expected.price) <= 0.01;
    const family = candidate.product_name || expected.category || expected.sheet || "";
    const category = expected.category ?? expected.sheet ?? "";
    comparisons.push({ code, workbook: expected.price, extracted, basis, category, page: candidate.page, family, variant: candidate.variant, xMin: candidate.xMin, status: match ? "match" : "difference" });
    if (!match) differences.push({
      code,
      workbook: expected.price,
      extracted,
      basis,
      category,
      page: candidate.page,
      family,
      variant: candidate.variant,
      xMin: candidate.xMin,
    });
  }
  const expectedCodes = new Set(expectedRows.map((row) => normCode(row.princeCode)));
  const missingCodes = [...expectedCodes].filter((code) => !foundCodes.has(code));
  const unpricedCodes = [...expectedCodes].filter((code) =>
    foundCodes.has(code) && !pricedCodes.has(code),
  );
  const newCodes = [...foundCodes].filter((code) => !expectedCodes.has(code)).sort();
  return {
    found: foundCodes.size,
    matched: [...pricedCodes].filter((code) => expectedCodes.has(code)).length,
    newCodes,
    missingCodes,
    unpricedCodes,
    comparisons,
    differences,
  };
}

export function extractPrinceTextPdf(pdfBuffer: Buffer): { items: PrincePdfItem[]; fileSha256: string } {
  const dir = mkdtempSync(join(tmpdir(), "prince-pdf-"));
  const path = join(dir, "catalogue.pdf");
  try {
    writeFileSync(path, pdfBuffer);
    const bbox = execFileSync("pdftotext", ["-bbox", "-layout", path, "-"], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return {
      items: parsePrinceBboxCatalogue(bbox),
      fileSha256: createHash("sha256").update(pdfBuffer).digest("hex"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}