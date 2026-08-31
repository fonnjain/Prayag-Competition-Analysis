import * as XLSX from "xlsx";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  AUTHORITATIVE_MASTER_SOURCE,
  isIsoDate,
  sha256ForBuffer,
} from "./mrpProvenance";

export const AUTHORITATIVE_MASTER_SHA256 =
  "a6cd9c4d82ab60a1b77644edba5446af90bf9df25174095e791b6c23f773cab2";
export const AUTHORITATIVE_MASTER_FILE_NAME =
  "Prayag_MRP_Authoritative_01Sep2026.xlsx";

const EXPECTED_PRODUCT_ROWS = 6_076;
const EXPECTED_DISCONTINUED_ROWS = 233;
const EXPECTED_EXCLUDED_ROWS = 142;
const LOAD_REASON =
  "Authoritative master returned by Prayag, superseding the compiled 01 Sep list.";
const DEACTIVATED_CODES = [
  "PS1106",
  "PS1606",
  "PS5157",
  "PS5163",
  "PS5171",
  "PS5657",
  "PS5763",
  "PS7506",
] as const;

type Variant = "Standard" | "Ivory" | "White with Jet" | "Pink / Green / Blue";

export interface AuthoritativePriceRow {
  itemCode: string;
  division: string;
  series: string | null;
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
  productRows: AuthoritativePriceRow[];
  priceRows: AuthoritativePriceRow[];
  discontinuedRows: AuthoritativeDiscontinuedRow[];
  excludedRows: number;
  invalidExcludedCodes: string[];
  periodCounts: Record<string, number>;
  periodDivisionCounts: Record<string, number>;
  variantCounts: Record<Variant, number>;
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
  return text(value).toUpperCase().replace(/\.0$/, "");
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
  return sha256ForBuffer(buffer) === AUTHORITATIVE_MASTER_SHA256;
}

export function parseAuthoritativeMasterBuffer(
  buffer: Buffer,
): ParsedAuthoritativeMaster {
  const actualHash = sha256ForBuffer(buffer);
  if (actualHash !== AUTHORITATIVE_MASTER_SHA256) {
    throw new Error(
      `Authoritative master checksum mismatch. Expected ${AUTHORITATIVE_MASTER_SHA256}, received ${actualHash}.`,
    );
  }

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
  if (products.length !== EXPECTED_PRODUCT_ROWS) {
    throw new Error(
      `Expected ${EXPECTED_PRODUCT_ROWS} product rows, found ${products.length}.`,
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

  return {
    productRows,
    priceRows,
    discontinuedRows,
    excludedRows: excluded.length,
    invalidExcludedCodes,
    periodCounts,
    periodDivisionCounts,
    variantCounts,
  };
}

export async function loadAuthoritativeMaster(input: {
  buffer: Buffer;
  downloadedAt: string;
  loadedBy: string | null;
  transaction?: DatabaseTransaction;
  database?: AuthoritativeTransactionExecutor;
}) {
  if (!isIsoDate(input.downloadedAt)) {
    throw new Error("downloadedAt must be a valid YYYY-MM-DD date.");
  }
  const parsed = parseAuthoritativeMasterBuffer(input.buffer);

  const load = async (tx: DatabaseTransaction) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(917_901)`);
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
          eq(mrpLoadBatchesTable.fileSha256, AUTHORITATIVE_MASTER_SHA256),
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

    const existingProducts = await tx
      .select({ itemCode: catalogProductsTable.itemCode })
      .from(catalogProductsTable);
    const existingCodes = new Set(
      existingProducts.map((row) => authoritativeCode(row.itemCode)),
    );
    const missingDiscontinued = parsed.discontinuedRows
      .map((row) => row.itemCode)
      .filter((code) => !existingCodes.has(code));
    if (missingDiscontinued.length) {
      throw new Error(
        `Discontinued codes are missing from the catalog: ${missingDiscontinued.join(", ")}.`,
      );
    }
    const missingDeactivated = DEACTIVATED_CODES.filter(
      (code) => !existingCodes.has(code),
    );
    if (missingDeactivated.length) {
      throw new Error(
        `Expected removed Prayag codes are missing from the catalog: ${missingDeactivated.join(", ")}.`,
      );
    }

    const batch = await tx
      .insert(mrpLoadBatchesTable)
      .values({
        sourceId,
        fileName: AUTHORITATIVE_MASTER_FILE_NAME,
        fileSha256: AUTHORITATIVE_MASTER_SHA256,
        fileSizeBytes: input.buffer.length,
        downloadedAt: input.downloadedAt,
        loadedBy: input.loadedBy,
        rowCount: parsed.priceRows.length,
        notes: LOAD_REASON,
      })
      .returning({ id: mrpLoadBatchesTable.id });
    const loadBatchId = batch[0]!.id;

    const newCodes: string[] = [];
    for (let index = 0; index < parsed.productRows.length; index += 500) {
      const values = parsed.productRows.slice(index, index + 500).map((row) => ({
        itemCode: row.itemCode,
        productName: row.productName,
        division: row.division,
        category: row.series,
        seriesRange: row.series,
        size: row.size,
        uom: "NOS",
        isActive: true,
        discontinuedFrom: null,
        discontinuedCheckedBy: null,
        discontinuedStatusNote: null,
        sourceFiles: AUTHORITATIVE_MASTER_FILE_NAME,
        dataFlag: "authoritative_master_2026_09_01",
        updatedAt: new Date(),
      }));
      const inserted = await tx
        .insert(catalogProductsTable)
        .values(values)
        .onConflictDoNothing({ target: catalogProductsTable.itemCode })
        .returning({ itemCode: catalogProductsTable.itemCode });
      newCodes.push(...inserted.map((row) => authoritativeCode(row.itemCode)));
      await tx
        .insert(catalogProductsTable)
        .values(values)
        .onConflictDoUpdate({
          target: catalogProductsTable.itemCode,
          set: {
            productName: sql`excluded.product_name`,
            division: sql`excluded.division`,
            category: sql`excluded.category`,
            seriesRange: sql`excluded.series_range`,
            size: sql`excluded.size`,
            isActive: true,
            discontinuedFrom: null,
            discontinuedCheckedBy: null,
            discontinuedStatusNote: null,
            sourceFiles: AUTHORITATIVE_MASTER_FILE_NAME,
            dataFlag: "authoritative_master_2026_09_01",
            updatedAt: new Date(),
          },
        });
    }

    const loadedHistory: {
      id: number;
      itemCode: string;
      effectiveDate: string;
      mrp: number | null;
    }[] = [];
    const loadDate = new Date().toISOString().slice(0, 10);
    for (let index = 0; index < parsed.priceRows.length; index += 500) {
      const values = parsed.priceRows.slice(index, index + 500).map((row) => ({
        itemCode: row.itemCode,
        mrp: row.mrp,
        netPrice: null,
        discountPct: null,
        priceBasis: "MRP",
        effectiveDate: row.effectiveDate,
        loadDate,
        sourceFile: AUTHORITATIVE_MASTER_FILE_NAME,
        isCurrent: false,
        notes: LOAD_REASON,
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
            sourceFile: AUTHORITATIVE_MASTER_FILE_NAME,
            isCurrent: false,
            notes: LOAD_REASON,
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
          reason: LOAD_REASON,
          sourceFile: AUTHORITATIVE_MASTER_FILE_NAME,
          loadBatchId,
          mrp: row.mrp,
        })),
      );
    }

    // The authoritative list is complete. Clear every previous withdrawal and
    // reapply exactly the 233 signed-off rows from this workbook.
    await tx
      .update(catalogProductsTable)
      .set({
        discontinuedFrom: null,
        discontinuedCheckedBy: null,
        discontinuedStatusNote: null,
        updatedAt: new Date(),
      });
    for (let index = 0; index < parsed.discontinuedRows.length; index += 250) {
      for (const row of parsed.discontinuedRows.slice(index, index + 250)) {
        await tx
          .update(catalogProductsTable)
          .set({
            discontinuedFrom: row.discontinuedFrom,
            discontinuedCheckedBy: row.checkedBy,
            discontinuedStatusNote: row.statusNote,
            updatedAt: new Date(),
          })
          .where(eq(catalogProductsTable.itemCode, row.itemCode));
      }
    }
    await tx
      .update(catalogProductsTable)
      .set({
        isActive: false,
        dataFlag: "removed_by_authoritative_master_2026_09_01",
        updatedAt: new Date(),
      })
      .where(inArray(catalogProductsTable.itemCode, [...DEACTIVATED_CODES]));
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

    return {
      duplicate: false as const,
      loadBatchId,
      before: before.rows[0]!,
      after: after.rows[0]!,
      productRows: parsed.productRows.length,
      priceRows: parsed.priceRows.length,
      newCodes,
      deactivatedCodes: [...DEACTIVATED_CODES],
      discontinuedRows: parsed.discontinuedRows.length,
      immediatelyWithdrawn: parsed.discontinuedRows.filter(
        (row) => row.discontinuedFrom <= loadDate,
      ).length,
      excludedRows: parsed.excludedRows,
      invalidExcludedCodes: parsed.invalidExcludedCodes,
      periodCounts: parsed.periodCounts,
      periodDivisionCounts: parsed.periodDivisionCounts,
      variantCounts: parsed.variantCounts,
    };
  };
  const result = input.transaction
    ? await input.transaction.transaction(load)
    : await (input.database ?? db).transaction(load);
  return result;
}