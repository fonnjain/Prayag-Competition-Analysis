import { planCategorySpellings, assertCategorySpellingPlan, lockCategorySpellings } from "./categorySpellingGuard";
import * as XLSX from "xlsx";
import { masterClassification, supportsCatalogRange } from "@workspace/formatting";
import { and, eq, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";
import {
  recomputeCurrentFlagsInTransaction,
  type DatabaseTransaction,
} from "./catalog";
import {
  AUTHORITATIVE_MASTER_BATCH,
  AUTHORITATIVE_MASTER_SOURCE,
  isIsoDate,
  sha256ForBuffer,
  assertSingleProductDivision,
} from "./mrpProvenance";

export const AUTHORITATIVE_MASTER_SHA256 = AUTHORITATIVE_MASTER_BATCH.fileSha256;
export const AUTHORITATIVE_MASTER_FILE_NAME = AUTHORITATIVE_MASTER_BATCH.fileName;

const EXPECTED_DISCONTINUED_ROWS = 233;
const EXPECTED_EXCLUDED_ROWS = 142;
export const AUTHORITATIVE_MASTER_V2_SHA256 =
  "e4463266dffdb44b5ae0c10ba5150cc786f6ea21e65619fab2dd57846e4fe23e";
export const AUTHORITATIVE_MASTER_V2_FILE_NAME =
  "Prayag_MRP_Authoritative_v2_01Sep2026.xlsx";

interface NamePreservationException {
  itemCode: string;
  preservedName: string;
  allowedCurrentNames?: readonly string[];
}

const V2_NAME_PRESERVATION_EXCEPTIONS: readonly NamePreservationException[] = [
  {
    itemCode: "CH72",
    preservedName:
      "Long Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULAR",
  },
  {
    itemCode: "CH72F",
    preservedName: "Full Turn Concealed Valve 3⁄4 inch TRIANGULAR",
  },
  {
    itemCode: "CH72QS",
    preservedName:
      "Short Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULAR",
  },
  {
    itemCode: "CH82",
    preservedName:
      "Long Concealed Valve (Quarter Turn) 1 inch TRIANGULAR",
  },
  {
    itemCode: "CH82F",
    preservedName: "Full Turn Concealed Valve 1 inch TRIANGULAR",
  },
  {
    itemCode: "UH-72",
    preservedName:
      "Long Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULAR mm",
  },
  {
    itemCode: "UH72-S",
    preservedName:
      "Short Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULAR mm",
  },
  {
    itemCode: "UH82",
    preservedName:
      "Long Concealed Valve (Quarter Turn) 1⁄2 inch TRIANGULAR mm",
  },
  {
    itemCode: "UH82-S",
    preservedName:
      "Short Concealed Valve (Quarter Turn) 1⁄2 inch TRIANGULAR mm",
  },
  {
    itemCode: "UH82-F",
    preservedName: "Full Turn Concealed Valve 1 inch TRIANGULAR",
    allowedCurrentNames: [
      "Full Turn Concealed Valve",
      "Full Turn Concealed Valve 1 inch TRIANGULER",
    ],
  },
  {
    itemCode: "UH82-L",
    preservedName:
      "Long Concealed Valve (Quarter Turn) 1 inch TRIANGULAR",
    allowedCurrentNames: [
      "Long Concealed Valve (Quarter Turn)",
      "Long Concealed Valve (Quarter Turn) 1 inch TRIANGULER",
    ],
  },
] as const;

interface AuthoritativeMasterProfile {
  fileName: string;
  fileSha256: string;
  expectedProductRows: number;
  loadReason: string;
  dataFlag: string;
  namePreservationExceptions: readonly NamePreservationException[];
}

const AUTHORITATIVE_MASTER_PROFILES: readonly AuthoritativeMasterProfile[] = [
  {
    fileName: AUTHORITATIVE_MASTER_FILE_NAME,
    fileSha256: AUTHORITATIVE_MASTER_SHA256,
    expectedProductRows: 6_076,
    loadReason:
      "Authoritative master returned by Prayag, superseding the compiled 01 Sep list.",
    dataFlag: "authoritative_master_2026_09_01",
    namePreservationExceptions: [],
  },
  {
    fileName: AUTHORITATIVE_MASTER_V2_FILE_NAME,
    fileSha256: AUTHORITATIVE_MASTER_V2_SHA256,
    expectedProductRows: 6_106,
    loadReason:
      "Revised authoritative master from Prayag, superseding batch 15.",
    dataFlag: "authoritative_master_v2_2026_09_01",
    namePreservationExceptions: V2_NAME_PRESERVATION_EXCEPTIONS,
  },
] as const;

type Variant = "Standard" | "Ivory" | "White with Jet" | "Pink / Green / Blue";

export interface AuthoritativePriceRow {
  itemCode: string;
  division: string;
  series: string | null;
  category?: string | null;
  productName: string;
  size: string | null;
  mrp: number;
  effectiveDate: string;
  variant: Variant;
}

export interface AuthoritativeDiscontinuedRow {
  itemCode: string;
  discontinuedFrom: string;
  checkedBy: string;
  statusNote: string;
}

export interface ParsedAuthoritativeMaster {
  fileName: string;
  fileSha256: string;
  loadReason: string;
  dataFlag: string;
  productRows: AuthoritativePriceRow[];
  priceRows: AuthoritativePriceRow[];
  discontinuedRows: AuthoritativeDiscontinuedRow[];
  excludedRows: number;
  invalidExcludedCodes: string[];
  periodCounts: Record<string, number>;
  periodDivisionCounts: Record<string, number>;
  variantCounts: Record<Variant, number>;
  preservedNameDisagreements: {
    itemCode: string;
    sourceName: string;
    preservedName: string;
  }[];
}

export interface AuthoritativeTransactionExecutor {
  transaction<T>(
    callback: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T>;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const valueText = text(value);
  return valueText ? valueText : null;
}

function authoritativeCode(value: unknown): string {
  return String(value ?? "");
}

function positiveNumber(value: unknown, label: string): number {
  const numberValue =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return numberValue;
}

function recordsForSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
): Record<string, unknown>[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Required sheet "${sheetName}" is missing.`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
}

function requireHeaders(
  rows: Record<string, unknown>[],
  required: string[],
  sheetName: string,
): void {
  const first = rows[0];
  if (!first) throw new Error(`Sheet "${sheetName}" has no data rows.`);
  const headers = new Set(Object.keys(first));
  const missing = required.filter((header) => !headers.has(header));
  if (missing.length) {
    throw new Error(
      `Sheet "${sheetName}" is missing required columns: ${missing.join(", ")}.`,
    );
  }
}

export function isAuthoritativeMasterBuffer(buffer: Buffer): boolean {
  const hash = sha256ForBuffer(buffer);
  return AUTHORITATIVE_MASTER_PROFILES.some(
    (profile) => profile.fileSha256 === hash,
  );
}

function profileForHash(hash: string): AuthoritativeMasterProfile {
  const profile = AUTHORITATIVE_MASTER_PROFILES.find(
    (candidate) => candidate.fileSha256 === hash,
  );
  if (!profile) {
    throw new Error(
      `Authoritative master checksum mismatch. Supported checksums: ${AUTHORITATIVE_MASTER_PROFILES.map((candidate) => candidate.fileSha256).join(", ")}; received ${hash}.`,
    );
  }
  return profile;
}

export function parseAuthoritativeMasterBuffer(
  buffer: Buffer,
): ParsedAuthoritativeMaster {
  const actualHash = sha256ForBuffer(buffer);
  const profile = profileForHash(actualHash);

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const expectedSheets = [
    "products",
    "discontinued",
    "excluded_do_not_load",
    "notes",
  ];
  if (
    workbook.SheetNames.length !== expectedSheets.length ||
    expectedSheets.some((sheet) => !workbook.SheetNames.includes(sheet))
  ) {
    throw new Error(
      `Authoritative master must contain only: ${expectedSheets.join(", ")}.`,
    );
  }

  const products = recordsForSheet(workbook, "products");
  const discontinued = recordsForSheet(workbook, "discontinued");
  const excluded = recordsForSheet(workbook, "excluded_do_not_load");
  if (products.length !== profile.expectedProductRows) {
    throw new Error(
      `Expected ${profile.expectedProductRows} product rows, found ${products.length}.`,
    );
  }
  if (discontinued.length !== EXPECTED_DISCONTINUED_ROWS) {
    throw new Error(
      `Expected ${EXPECTED_DISCONTINUED_ROWS} discontinued rows, found ${discontinued.length}.`,
    );
  }
  if (excluded.length !== EXPECTED_EXCLUDED_ROWS) {
    throw new Error(
      `Expected ${EXPECTED_EXCLUDED_ROWS} excluded rows, found ${excluded.length}.`,
    );
  }

  requireHeaders(
    products,
    [
      "item_code",
      "division",
      "series",
      "product_name",
      "size",
      "mrp",
      "effective_date",
      "mrp_ivory",
      "mrp_white_with_jet",
      "mrp_pink_green_blue",
    ],
    "products",
  );
  requireHeaders(
    discontinued,
    [
      "item_code",
      "discontinued_from",
      "checked_by",
      "status_note",
    ],
    "discontinued",
  );
  requireHeaders(
    excluded,
    ["item_code", "status_note", "why excluded"],
    "excluded_do_not_load",
  );

  const seenProductCodes = new Set<string>();
  const productRows: AuthoritativePriceRow[] = [];
  const priceRows: AuthoritativePriceRow[] = [];
  const periodCounts: Record<string, number> = {};
  const periodDivisionCounts: Record<string, number> = {};
  const variantCounts: Record<Variant, number> = {
    Standard: 0,
    Ivory: 0,
    "White with Jet": 0,
    "Pink / Green / Blue": 0,
  };

  const variants = [
    ["mrp_ivory", "Ivory"],
    ["mrp_white_with_jet", "White with Jet"],
    ["mrp_pink_green_blue", "Pink / Green / Blue"],
  ] as const;

  products.forEach((row, index) => {
    const rowNumber = index + 2;
    const itemCode = authoritativeCode(row.item_code);
    const division = text(row.division);
    const productName = text(row.product_name);
    const effectiveDate = text(row.effective_date);
    if (!itemCode || !division || !productName || !isIsoDate(effectiveDate)) {
      throw new Error(
        `products row ${rowNumber} has an invalid code, division, product name, or effective date.`,
      );
    }
    if (seenProductCodes.has(itemCode)) {
      throw new Error(`products row ${rowNumber} repeats item code ${itemCode}.`);
    }
    seenProductCodes.add(itemCode);

    const base: AuthoritativePriceRow = {
      itemCode,
      division,
      series: nullableText(row.series),
      category: nullableText(row.category),
      productName,
      size: nullableText(row.size),
      mrp: positiveNumber(row.mrp, `products row ${rowNumber} mrp`),
      effectiveDate,
      variant: "Standard",
    };
    productRows.push(base);
    priceRows.push(base);
    periodCounts[effectiveDate] = (periodCounts[effectiveDate] ?? 0) + 1;
    const periodDivisionKey = `${effectiveDate} — ${division}`;
    periodDivisionCounts[periodDivisionKey] =
      (periodDivisionCounts[periodDivisionKey] ?? 0) + 1;
    variantCounts.Standard += 1;

    variants.forEach(([column, variant]) => {
      if (row[column] == null || text(row[column]) === "") return;
      priceRows.push({
        ...base,
        mrp: positiveNumber(
          row[column],
          `products row ${rowNumber} ${column}`,
        ),
        variant,
      });
      variantCounts[variant] += 1;
    });
  });

  const seenDiscontinued = new Set<string>();
  const discontinuedRows = discontinued.map((row, index) => {
    const rowNumber = index + 2;
    const itemCode = authoritativeCode(row.item_code);
    const discontinuedFrom = text(row.discontinued_from);
    const checkedBy = text(row.checked_by);
    const statusNote = text(row.status_note);
    if (
      !itemCode ||
      !isIsoDate(discontinuedFrom) ||
      !checkedBy ||
      !statusNote
    ) {
      throw new Error(
        `discontinued row ${rowNumber} has an invalid code, date, checked_by, or status_note.`,
      );
    }
    if (seenDiscontinued.has(itemCode)) {
      throw new Error(
        `discontinued row ${rowNumber} repeats item code ${itemCode}.`,
      );
    }
    seenDiscontinued.add(itemCode);
    return { itemCode, discontinuedFrom, checkedBy, statusNote };
  });

  const overlap = [...seenProductCodes].filter((code) =>
    seenDiscontinued.has(code),
  );
  if (overlap.length) {
    throw new Error(
      `Codes cannot be both priced and discontinued: ${overlap.join(", ")}.`,
    );
  }

  const invalidExcludedCodes = excluded
    .filter((row) => /invalid input/i.test(text(row.status_note)))
    .map((row) => authoritativeCode(row.item_code))
    .sort();
  if (
    invalidExcludedCodes.join(",") !== ["20", "25", "32"].join(",")
  ) {
    throw new Error(
      `The excluded invalid-input set changed: ${invalidExcludedCodes.join(", ")}.`,
    );
  }

  const productRowsByCode = new Map(
    productRows.map((row) => [row.itemCode, row] as const),
  );
  const preservedNameDisagreements =
    profile.namePreservationExceptions.flatMap((exception) => {
      const source = productRowsByCode.get(exception.itemCode);
      if (!source) {
        throw new Error(
          `Named product-name preservation exception is missing from the workbook: ${exception.itemCode}.`,
        );
      }
      if (source.productName === exception.preservedName) return [];
      return [
        {
          itemCode: exception.itemCode,
          sourceName: source.productName,
          preservedName: exception.preservedName,
        },
      ];
    });

  return {
    fileName: profile.fileName,
    fileSha256: profile.fileSha256,
    loadReason: profile.loadReason,
    dataFlag: profile.dataFlag,
    productRows,
    priceRows,
    discontinuedRows,
    excludedRows: excluded.length,
    invalidExcludedCodes,
    periodCounts,
    periodDivisionCounts,
    variantCounts,
    preservedNameDisagreements,
  };
}

export interface StoredMasterClassification {
  itemCode: string;
  division: string | null;
  category: string | null;
  seriesRange: string | null;
  isActive?: boolean | null;
}

/** P049 Step 3: classify against the catalogue, never against a guessed alias. */
export function planAuthoritativeClassifications(
  rows: AuthoritativePriceRow[],
  products: StoredMasterClassification[],
) {
  const existing = new Map(products.map(row => [authoritativeCode(row.itemCode), row]));
  const acceptedCodes = new Set<string>();
  const newProducts: Array<{ itemCode: string; division: string; category: string; seriesRange?: string | null }> = [];
  const rejectedRows: Array<{ itemCode: string; row: number; reason: string }> = [];
  const classificationDifferences: Array<{
    itemCode: string; message: string; differingFields: string[];
    stored: { division: string | null; category: string | null; seriesRange: string | null };
    file: { division: string; category: string | null; seriesRange: string | null; categoryProvided: boolean; rangeProvided: boolean };
  }> = [];
  let existingProducts = 0;
  let newNonRangeProducts = 0;
  let refusedNewRangeProducts = 0;
  rows.forEach((row, index) => {
    const code = authoritativeCode(row.itemCode);
    const rangeDivision = supportsCatalogRange(row.division);
    const file = {
      division: row.division,
      category: rangeDivision ? row.category?.trim() || null : row.series?.trim() || null,
      seriesRange: rangeDivision ? row.series : null,
      categoryProvided: !rangeDivision || !!row.category?.trim(),
      rangeProvided: rangeDivision,
    };
    const stored = existing.get(code);
    if (stored) {
      existingProducts++;
      acceptedCodes.add(code);
      const differingFields = [
        ...(stored.division !== file.division ? ["division"] : []),
        ...(file.categoryProvided && stored.category !== file.category ? ["category"] : []),
        ...(file.rangeProvided && stored.seriesRange !== file.seriesRange ? ["series_range"] : []),
      ];
      if (differingFields.length) classificationDifferences.push({
        itemCode: stored.itemCode, message: "classification differs — not changed",
        differingFields, stored: { division: stored.division, category: stored.category, seriesRange: stored.seriesRange }, file,
      });
      return;
    }
    if (rangeDivision && !row.category?.trim()) {
      refusedNewRangeProducts++;
      rejectedRows.push({ itemCode: row.itemCode, row: index + 2,
        reason: "new CP/PTMT product needs a category: create it in the product editor" });
      return;
    }
    if (!rangeDivision && !file.category) {
      rejectedRows.push({ itemCode: row.itemCode, row: index + 2,
        reason: "new product needs a category in the master series column" });
      return;
    }
    const classification = masterClassification({ ...row, category: file.category });
    newProducts.push({ itemCode: row.itemCode, division: row.division, ...classification });
    if (!rangeDivision) newNonRangeProducts++;
    acceptedCodes.add(code);
  });
  const spellingPlan = planCategorySpellings(newProducts as Array<typeof newProducts[number] & { division: string }>, products);
  assertCategorySpellingPlan(spellingPlan);
  return { acceptedCodes, newProducts: spellingPlan.rows.map(({ division: _division, ...row }) => row), rejectedRows, classificationDifferences,
    categorySpellings: spellingPlan.categorySpellings, categorySpellingFingerprint: spellingPlan.categorySpellingFingerprint,
    counts: { existingProducts, newNonRangeProducts, refusedNewRangeProducts } };
}

export async function loadAuthoritativeMaster(input: {
  buffer?: Buffer;
  // Pending MRP batches retain this validated payload.  Supplying it prevents
  // Apply from parsing a possibly different workbook a second time.
  parsed?: ParsedAuthoritativeMaster;
  fileSizeBytes?: number;
  downloadedAt: string;
  loadedBy: string | null;
  transaction?: DatabaseTransaction;
  database?: AuthoritativeTransactionExecutor;
}) {
  if (!isIsoDate(input.downloadedAt)) {
    throw new Error("downloadedAt must be a valid YYYY-MM-DD date.");
  }
  if (!input.buffer && !input.parsed) {
    throw new Error("An authoritative workbook buffer or validated payload is required.");
  }
  const parsed = input.parsed ?? parseAuthoritativeMasterBuffer(input.buffer!);
  const preservedNamesByCode = new Map(
    parsed.preservedNameDisagreements.map((row) => [
      row.itemCode,
      row.preservedName,
    ]),
  );
  const namePreservationNote = parsed.preservedNameDisagreements.length
    ? ` Named product-name exceptions (${parsed.preservedNameDisagreements.length}): ${parsed.preservedNameDisagreements
        .map(
          (row) =>
            `${row.itemCode}: "${row.sourceName}" -> "${row.preservedName}"`,
        )
        .join("; ")}`
    : "";
  const loadNotes = `${parsed.loadReason}${namePreservationNote}`;

  const load = async (tx: DatabaseTransaction) => {
    // Refuse before provenance or price operations. Source-sheet provenance
    // must be resolved to a single business division in the mapping first.
    for (const row of parsed.productRows) assertSingleProductDivision(row.itemCode, row.division);
    await lockCategorySpellings(tx);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(917_901)`);
    // Serialize catalogue membership with concurrent product creation. Existing
    // rows are price-only; a new-code race must never become a classification upsert.
    await tx.execute(sql`LOCK TABLE catalog_products IN SHARE ROW EXCLUSIVE MODE`);
    await tx
      .insert(mrpSourcesTable)
      .values(AUTHORITATIVE_MASTER_SOURCE)
      .onConflictDoNothing({ target: mrpSourcesTable.sheetId });
    const sources = await tx
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .where(
        eq(
          mrpSourcesTable.sheetId,
          AUTHORITATIVE_MASTER_SOURCE.sheetId,
        ),
      )
      .limit(1);
    const sourceId = sources[0]?.id;
    if (!sourceId) {
      throw new Error("Authoritative MRP provenance source could not be created.");
    }
    const existingBatches = await tx
      .select({
        id: mrpLoadBatchesTable.id,
        loadedAt: mrpLoadBatchesTable.loadedAt,
        downloadedAt: mrpLoadBatchesTable.downloadedAt,
      })
      .from(mrpLoadBatchesTable)
      .where(
        and(
          eq(mrpLoadBatchesTable.sourceId, sourceId),
          eq(mrpLoadBatchesTable.fileSha256, parsed.fileSha256),
        ),
      );
    if (existingBatches.length) {
      return {
        duplicate: true as const,
        existingBatches,
      };
    }

    const before = await tx.execute<{
      catalog_rows: number;
      history_rows: number;
      history_codes: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM catalog_products) AS catalog_rows,
        (SELECT COUNT(*)::int FROM mrp_price_history) AS history_rows,
        (SELECT COUNT(DISTINCT item_code)::int FROM mrp_price_history) AS history_codes
    `);
    const catalogCodesBefore = new Set(
      (
        await tx
          .select({ itemCode: catalogProductsTable.itemCode })
          .from(catalogProductsTable)
      ).map((row) => row.itemCode),
    );

    const existingProducts = await tx
      .select({
        itemCode: catalogProductsTable.itemCode,
        productName: catalogProductsTable.productName,
        division: catalogProductsTable.division,
        category: catalogProductsTable.category,
        seriesRange: catalogProductsTable.seriesRange,
        isActive: catalogProductsTable.isActive,
      })
      .from(catalogProductsTable);
    const classificationPlan = planAuthoritativeClassifications(parsed.productRows, existingProducts);
    const canonicalCodes = new Map(existingProducts.map(row => [authoritativeCode(row.itemCode), row.itemCode]));
    const eligiblePriceRows = parsed.priceRows
      .filter(row => classificationPlan.acceptedCodes.has(authoritativeCode(row.itemCode)))
      .map(row => ({ ...row, itemCode: canonicalCodes.get(authoritativeCode(row.itemCode)) ?? row.itemCode }));
    if (!eligiblePriceRows.length) throw new Error(classificationPlan.rejectedRows[0]?.reason ?? "No valid price rows would be written.");
    const periodCounts: Record<string, number> = {};
    const periodDivisionCounts: Record<string, number> = {};
    const variantCounts: Record<Variant, number> = { Standard: 0, Ivory: 0, "White with Jet": 0, "Pink / Green / Blue": 0 };
    for (const row of parsed.productRows.filter(row => classificationPlan.acceptedCodes.has(authoritativeCode(row.itemCode)))) {
      periodCounts[row.effectiveDate] = (periodCounts[row.effectiveDate] ?? 0) + 1;
      const key = `${row.effectiveDate} — ${row.division}`;
      periodDivisionCounts[key] = (periodDivisionCounts[key] ?? 0) + 1;
    }
    for (const row of eligiblePriceRows) variantCounts[row.variant]++;
    const newClassifications = new Map(classificationPlan.newProducts.map(row => [authoritativeCode(row.itemCode), row]));

    const batch = await tx
      .insert(mrpLoadBatchesTable)
      .values({
        sourceId,
        fileName: parsed.fileName,
        fileSha256: parsed.fileSha256,
        fileSizeBytes: input.buffer?.length ?? input.fileSizeBytes ?? 0,
        downloadedAt: input.downloadedAt,
        loadedBy: input.loadedBy,
        rowCount: eligiblePriceRows.length,
        notes: loadNotes,
      })
      .returning({ id: mrpLoadBatchesTable.id });
    const loadBatchId = batch[0]!.id;

    const newProductRows = parsed.productRows.filter(row => newClassifications.has(authoritativeCode(row.itemCode)));
    for (let index = 0; index < newProductRows.length; index += 500) {
      const values = newProductRows.slice(index, index + 500).map((row) => ({
        productName: preservedNamesByCode.get(row.itemCode) ?? row.productName,
        division: (assertSingleProductDivision(row.itemCode, row.division), row.division),
        ...newClassifications.get(authoritativeCode(row.itemCode))!,
        size: row.size,
        uom: "NOS",
        isActive: true,
        discontinuedFrom: null,
        discontinuedCheckedBy: null,
        discontinuedStatusNote: null,
        sourceFiles: parsed.fileName,
        dataFlag: parsed.dataFlag,
        updatedAt: new Date(),
      }));
      await tx
        .insert(catalogProductsTable)
        .values(values);
    }

    const loadedHistory: {
      id: number;
      itemCode: string;
      effectiveDate: string;
      mrp: number | null;
    }[] = [];
    const loadDate = new Date().toISOString().slice(0, 10);
    for (let index = 0; index < eligiblePriceRows.length; index += 500) {
      const values = eligiblePriceRows.slice(index, index + 500).map((row) => ({
        itemCode: row.itemCode,
        mrp: row.mrp,
        netPrice: null,
        discountPct: null,
        priceBasis: "MRP",
        effectiveDate: row.effectiveDate,
        loadDate,
        sourceFile: parsed.fileName,
        isCurrent: false,
        notes: parsed.loadReason,
        reviewStatus: "approved",
        reviewReasons: null,
        importBatchId: null,
        loadBatchId,
        reviewedAt: new Date(),
        variant: row.variant,
      }));
      const upserted = await tx
        .insert(mrpPriceHistoryTable)
        .values(values)
        .onConflictDoUpdate({
          target: [
            mrpPriceHistoryTable.itemCode,
            mrpPriceHistoryTable.effectiveDate,
            mrpPriceHistoryTable.variant,
          ],
          set: {
            mrp: sql`excluded.mrp`,
            netPrice: null,
            discountPct: null,
            priceBasis: "MRP",
            loadDate,
            sourceFile: parsed.fileName,
            isCurrent: false,
            notes: parsed.loadReason,
            reviewStatus: "approved",
            reviewReasons: null,
            importBatchId: null,
            loadBatchId,
            reviewedAt: new Date(),
          },
        })
        .returning({
          id: mrpPriceHistoryTable.id,
          itemCode: mrpPriceHistoryTable.itemCode,
          effectiveDate: mrpPriceHistoryTable.effectiveDate,
          mrp: mrpPriceHistoryTable.mrp,
        });
      loadedHistory.push(...upserted);
    }

    for (let index = 0; index < loadedHistory.length; index += 500) {
      await tx.insert(mrpHistoryProvenanceEventsTable).values(
        loadedHistory.slice(index, index + 500).map((row) => ({
          historyRowId: row.id,
          itemCode: row.itemCode,
          effectiveDate: row.effectiveDate,
          action: "authoritative_master_import",
          reason: parsed.loadReason,
          sourceFile: parsed.fileName,
          loadBatchId,
          mrp: row.mrp,
        })),
      );
    }

    // P049 Step 3: existing catalogue rows are never updated by a price load,
    // including names, hidden Range, division, activation and withdrawal state.
    await recomputeCurrentFlagsInTransaction(tx);

    const after = await tx.execute<{
      catalog_rows: number;
      history_rows: number;
      history_codes: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM catalog_products) AS catalog_rows,
        (SELECT COUNT(*)::int FROM mrp_price_history) AS history_rows,
        (SELECT COUNT(DISTINCT item_code)::int FROM mrp_price_history) AS history_codes
    `);
    const newCodes = (
      await tx
        .select({ itemCode: catalogProductsTable.itemCode })
        .from(catalogProductsTable)
    )
      .map((row) => row.itemCode)
      .filter((itemCode) => !catalogCodesBefore.has(itemCode))
      .sort();

    return {
      duplicate: false as const,
      loadBatchId,
      before: before.rows[0]!,
      after: after.rows[0]!,
      productRows: parsed.productRows.length,
      priceRows: eligiblePriceRows.length,
      classificationCounts: classificationPlan.counts,
      classificationDifferences: classificationPlan.classificationDifferences,
      rejectedRows: classificationPlan.rejectedRows,
      newCodes,
      deactivatedCodes: [],
      discontinuedRows: 0,
      immediatelyWithdrawn: 0,
      sourceDiscontinuedRows: parsed.discontinuedRows.length,
      excludedRows: parsed.excludedRows,
      invalidExcludedCodes: parsed.invalidExcludedCodes,
      periodCounts,
      periodDivisionCounts,
      variantCounts,
      preservedNameDisagreements: parsed.preservedNameDisagreements,
    };
  };
  const result = input.transaction
    ? await load(input.transaction)
    : await (input.database ?? db).transaction(load);
  return result;
}