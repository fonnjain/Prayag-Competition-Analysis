import { formatMoney } from "@workspace/formatting";
import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  catalogProductsTable,
  competitorPricesTable,
  mrpPriceHistoryTable,
  mrpHistoryProvenanceEventsTable,
  mrpRevisionBatchesTable,
  mrpRevisionRowsTable,
  mrpGeneratorResultsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";
import { isIsoDate, sha256ForBuffer } from "../lib/mrpProvenance";
import { normCode } from "../lib/catalog";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const P033R3_SHA256 = "f27fa5f40e9428fe8d953ad13803d5d46d667f4f399ff1ba46e63449cb603288";
const P033R3_DATES = ["2026-02-01", "2026-05-01", "2026-08-10"] as const;
const P033R3_NOTE = "unit restatement, per metre to per 3-metre pipe — not a price change";
const P033R3_DELETE_NOTE = "spurious period — February price recorded under a May date; deleted on Prayag's instruction";

function parseHistorySnapshot(value: string): Record<string, unknown> {
  const snapshot = JSON.parse(value) as Record<string, unknown>;
  for (const field of ["reviewedAt"]) {
    if (typeof snapshot[field] === "string") snapshot[field] = new Date(snapshot[field] as string);
  }
  return snapshot;
}

const historySnapshotFields = [
  "id", "itemCode", "mrp", "netPrice", "discountPct", "priceBasis",
  "effectiveDate", "loadDate", "sourceFile", "isCurrent", "notes",
  "reviewStatus", "reviewReasons", "importBatchId", "loadBatchId",
  "lastRevisionBatchId", "reviewedAt", "variant",
] as const;

function sameHistoryValue(current: unknown, snapshot: unknown): boolean {
  if (current instanceof Date || snapshot instanceof Date) {
    const currentTime = current instanceof Date ? current.getTime() : null;
    const snapshotTime = snapshot instanceof Date ? snapshot.getTime() : null;
    return currentTime === snapshotTime;
  }
  return current === snapshot;
}

function matchesHistorySnapshot(
  current: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): boolean {
  return historySnapshotFields.every((field) =>
    sameHistoryValue(current[field], snapshot[field] ?? null),
  );
}

function withAuditNote(previous: unknown, note: string): string {
  const existing = typeof previous === "string" ? previous.trim() : "";
  return existing ? `${existing}\n${note}` : note;
}

type TargetType = "mrp" | "competitor";
type ParsedRevision = {
  rowNumber: number;
  itemCode: string;
  effectiveDate: string | null;
  variant: string;
  competitor: string | null;
  newValue: number | null;
  note: string | null;
};

type ParsedRevisionWorkbook = {
  rows: ParsedRevision[];
  hasEffectiveDateColumn: boolean;
};

type RevisionScopeDate = {
  effectiveDate: string;
  rowCount: number;
  endsOn: string | null;
};

type RevisionDivisionSummary = {
  division: string;
  count: number;
};

type MrpRevisionScope = RevisionScopeDate & {
  divisions: RevisionDivisionSummary[];
};

type CompetitorRevisionScope = RevisionScopeDate & {
  competitor: string;
};

function splitDivisions(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(/\s*(?:\||\/)\s*/).map((part) => part.trim()).filter(Boolean))];
}

function textValue(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  return String(value).trim();
}

function headerName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  return textValue(value);
}

function numberValue(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

const LEGITIMATE_LOW_PRICE_CODES = new Set([
  "EPT-01",
  "126",
  "126-SQ",
  "PH-1",
  "TTS-03",
  "PH-2",
  "TTS-01",
  "137",
  "TTS-02",
  "311",
  "302",
]);

export function parseRevisionWorkbook(
  buffer: Buffer,
  targetType: TargetType,
): ParsedRevisionWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets.revision;
  if (!sheet) throw new Error('Workbook must contain a sheet named "revision".');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  if (rows.length < 2) throw new Error('The "revision" sheet has no data rows.');

  const headers = (rows[0] ?? []).map(headerName);
  const col = (name: string) => headers.indexOf(name);
  const codeCol = col("item_code");
  const dateCol = col("effective_date");
  const valueCol = col("new_mrp");
  const variantCol = col("variant");
  const competitorCol = col("competitor");
  const noteCol = col("note");
  const missing = ["item_code", "new_mrp"].filter(
    (name) => col(name) < 0,
  );
  if (targetType === "competitor" && competitorCol < 0) missing.push("competitor");
  if (missing.length > 0) {
    throw new Error(`Missing required revision column(s): ${missing.join(", ")}.`);
  }

  return {
    hasEffectiveDateColumn: dateCol >= 0,
    rows: rows.slice(1).map((row, index) => ({
      rowNumber: index + 2,
      itemCode: normCode(textValue(row[codeCol]) ?? ""),
      effectiveDate: dateCol >= 0 ? dateValue(row[dateCol]) : null,
      variant: textValue(row[variantCol]) ?? "Standard",
      competitor: targetType === "competitor" ? textValue(row[competitorCol]) : null,
      newValue: numberValue(row[valueCol]),
      note: textValue(row[noteCol]),
    })),
  };
}

function targetTypeValue(value: unknown): TargetType | null {
  return value === "mrp" || value === "competitor" ? value : null;
}

export function warningFor(
  itemCode: string,
  division: string | null,
  previous: number | null,
  next: number,
): string[] {
  const warnings: string[] = [];
  if (
    next < 50 &&
    division &&
    /PTMT|CP Fittings|Sanitaryware/i.test(division) &&
    !LEGITIMATE_LOW_PRICE_CODES.has(normCode(itemCode))
  ) {
    warnings.push(`New value ${formatMoney(next)} is below ₹50 for ${division}.`);
  }
  if (previous != null && previous !== 0) {
    const changePct = ((next - previous) / Math.abs(previous)) * 100;
    if (changePct > 60) warnings.push(`Increase is ${changePct.toFixed(1)}%, above +60%.`);
    if (changePct < -20) warnings.push(`Decrease is ${changePct.toFixed(1)}%, below -20%.`);
  }
  return warnings;
}

function userLabel(req: Parameters<typeof requireAdmin>[0]): string | null {
  return req.user?.email ?? req.user?.id ?? null;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

router.get("/catalog/mrp-revisions/scopes", requireAdmin, async (_req, res) => {
  const [mrpGroups, competitorGroups] = await Promise.all([
    db
      .select({
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        division: catalogProductsTable.division,
        rowCount: sql<number>`cast(count(*) as integer)`,
      })
      .from(mrpPriceHistoryTable)
      .leftJoin(
        catalogProductsTable,
        eq(catalogProductsTable.itemCode, mrpPriceHistoryTable.itemCode),
      )
      .groupBy(mrpPriceHistoryTable.effectiveDate, catalogProductsTable.division)
      .orderBy(asc(mrpPriceHistoryTable.effectiveDate), asc(catalogProductsTable.division)),
    db
      .select({
        competitor: competitorPricesTable.competitor,
        effectiveDate: competitorPricesTable.effectiveDate,
        rowCount: sql<number>`cast(count(*) as integer)`,
      })
      .from(competitorPricesTable)
      .where(isNotNull(competitorPricesTable.effectiveDate))
      .groupBy(competitorPricesTable.competitor, competitorPricesTable.effectiveDate)
      .orderBy(
        asc(competitorPricesTable.competitor),
        asc(competitorPricesTable.effectiveDate),
      ),
  ]);

  const mrpDivisionCounts = new Map<string, Map<string, number>>();
  for (const group of mrpGroups) {
    const divisions = mrpDivisionCounts.get(group.effectiveDate) ?? new Map<string, number>();
    for (const division of splitDivisions(group.division)) {
      divisions.set(division, (divisions.get(division) ?? 0) + group.rowCount);
    }
    mrpDivisionCounts.set(group.effectiveDate, divisions);
  }
  const mrpByDate = new Map<string, MrpRevisionScope>();
  for (const group of mrpGroups) {
    const existing = mrpByDate.get(group.effectiveDate);
    if (existing) {
      existing.rowCount += group.rowCount;
    } else {
      mrpByDate.set(group.effectiveDate, {
        effectiveDate: group.effectiveDate,
        divisions: [...(mrpDivisionCounts.get(group.effectiveDate) ?? new Map())]
          .map(([division, count]) => ({ division, count }))
          .sort((a, b) => b.count - a.count || a.division.localeCompare(b.division)),
        rowCount: group.rowCount,
        endsOn: null,
      });
    }
  }
  const mrpPeriods = [...mrpByDate.values()].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate),
  );
  for (let index = 0; index < mrpPeriods.length; index += 1) {
    mrpPeriods[index]!.endsOn = mrpPeriods[index + 1]
      ? addDays(mrpPeriods[index + 1]!.effectiveDate, -1)
      : null;
  }

  const competitorPeriods: CompetitorRevisionScope[] = competitorGroups
    .filter(
      (group): group is typeof group & { effectiveDate: string } =>
        !!group.effectiveDate,
    )
    .map((group) => ({
      competitor: group.competitor,
      effectiveDate: group.effectiveDate,
      rowCount: group.rowCount,
      endsOn: null,
    }));
  for (let index = 0; index < competitorPeriods.length; index += 1) {
    const current = competitorPeriods[index]!;
    const next = competitorPeriods[index + 1];
    current.endsOn =
      next && next.competitor === current.competitor
        ? addDays(next.effectiveDate, -1)
        : null;
  }

  res.json({ mrpPeriods, competitorPeriods });
});

// P033r3 is intentionally separate from the generic one-period spreadsheet
// editor: it is a two-date restatement plus a controlled period deletion.
router.post(
  "/catalog/mrp-revisions/p033r3/preview",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Attach the authoritative P033r3 workbook." });
      return;
    }
    try {
      const hash = sha256ForBuffer(req.file.buffer);
      if (hash !== P033R3_SHA256) {
        throw Object.assign(new Error(`P033r3 source checksum mismatch; expected ${P033R3_SHA256}.`), { httpStatus: 400 });
      }
      const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
      const sheet = workbook.Sheets.Sheet1;
      if (!sheet) throw Object.assign(new Error("P033r3 workbook must contain Sheet1."), { httpStatus: 400 });
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false });
      if (raw.length !== 91) throw Object.assign(new Error(`P033r3 workbook must contain exactly 90 data rows; found ${Math.max(0, raw.length - 1)}.`), { httpStatus: 400 });
      const headers = (raw[0] ?? []).map(headerName);
      const codeCol = headers.indexOf("cat_no.");
      const augCol = headers.findIndex((value) => value.includes("mrp_w.e.f.") && value.includes("10_aug_2026"));
      const febCol = headers.findIndex((value) => value.includes("previous_mrp") && value.includes("01_feb_2026"));
      if (codeCol < 0 || augCol < 0 || febCol < 0) throw Object.assign(new Error("P033r3 workbook headers are not the expected Cat No., August MRP, Previous February MRP columns."), { httpStatus: 400 });
      const source = raw.slice(1).map((row, index) => ({
        rowNumber: index + 2,
        itemCode: normCode(textValue(row[codeCol]) ?? ""),
        august: numberValue(row[augCol]),
        february: numberValue(row[febCol]),
      }));
      const sourceCodes = new Set(source.map((row) => row.itemCode));
      if (sourceCodes.size !== 90 || source.some((row) => !row.itemCode || row.august == null || row.february == null)) {
        throw Object.assign(new Error("P033r3 workbook must contain 90 unique codes with numeric February and August values."), { httpStatus: 400 });
      }
      const products = await db.select().from(catalogProductsTable);
      const productByCode = new Map(products.map((product) => [normCode(product.itemCode), product]));
      for (const code of sourceCodes) {
        const product = productByCode.get(code);
        if (!product || !/PPR\s*Pipe/i.test(`${product.seriesRange ?? ""} ${product.category ?? ""} ${product.productName ?? ""}`) ||
            /PPR\s*Fitting/i.test(`${product.seriesRange ?? ""} ${product.category ?? ""} ${product.productName ?? ""}`)) {
          throw Object.assign(new Error(`P033r3 code ${code} is not an approved PPR Pipe product.`), { httpStatus: 400 });
        }
      }
      const allRows = await db.select().from(mrpPriceHistoryTable);
      const affectedRows = allRows.filter((row) => sourceCodes.has(normCode(row.itemCode)));
      const dates = new Set(affectedRows.map((row) => row.effectiveDate));
      const unexpectedDates = [...dates].filter((date) => !(P033R3_DATES as readonly string[]).includes(date)).sort();
      if (unexpectedDates.length) throw Object.assign(new Error(`P033r3 halted: unexpected PPR effective date(s): ${unexpectedDates.join(", ")}.`), { httpStatus: 400 });
      if (affectedRows.length !== 270 || P033R3_DATES.some((date) => affectedRows.filter((row) => row.effectiveDate === date).length !== 90)) {
        throw Object.assign(new Error(`P033r3 requires exactly 270 PPR rows: 90 each at February, May, and August; found ${affectedRows.length}.`), { httpStatus: 400 });
      }
      if (affectedRows.some((row) => row.variant !== "Standard" || row.reviewStatus !== "approved")) {
        throw Object.assign(new Error("P033r3 requires all affected rows to be Standard and approved."), { httpStatus: 400 });
      }
      const sourceByCode = new Map(source.map((row) => [row.itemCode, row]));
      let exact3x = 0;
      let withinOne = 0;
      const verification = [...affectedRows].filter((row) => row.effectiveDate !== "2026-05-01").map((row) => {
        const expected = sourceByCode.get(normCode(row.itemCode))![row.effectiveDate === "2026-02-01" ? "february" : "august"]!;
        const delta = expected - (row.mrp ?? 0) * 3;
        if (Math.abs(delta) > 1) throw Object.assign(new Error(`P033r3 halted: ${row.itemCode} ${row.effectiveDate} is ${delta} rupees outside the ±1 tolerance.`), { httpStatus: 400 });
        if (delta === 0) exact3x++; else withinOne++;
        return { id: row.id, code: row.itemCode, date: row.effectiveDate, stored: row.mrp, authoritative: expected, delta };
      });
      const augCodes = new Set(affectedRows.filter((row) => row.effectiveDate === "2026-08-10").map((row) => normCode(row.itemCode)));
      if (augCodes.size !== 90) throw Object.assign(new Error("P033r3 halted: not every code has an August current price."), { httpStatus: 400 });
      const mayRows = affectedRows.filter((row) => row.effectiveDate === "2026-05-01");
      const mayIds = mayRows.map((row) => row.id);
      if (mayIds.length !== 90) throw Object.assign(new Error("P033r3 halted: exactly 90 May rows are required."), { httpStatus: 400 });
      const references = mayIds.length
        ? await db.select({ id: mrpGeneratorResultsTable.id }).from(mrpGeneratorResultsTable).where(inArray(mrpGeneratorResultsTable.currentRowId, mayIds))
        : [];
      if (references.length) throw Object.assign(new Error(`P033r3 halted: ${references.length} generator result(s) reference May rows.`), { httpStatus: 400 });
      const note = P033R3_NOTE;
      const revisionRows: Omit<typeof mrpRevisionRowsTable.$inferInsert, "batchId">[] = [];
      let rowNumber = 1;
      for (const date of ["2026-02-01", "2026-08-10"] as const) {
        for (const row of affectedRows.filter((candidate) => candidate.effectiveDate === date)) {
          const expected = sourceByCode.get(normCode(row.itemCode))![date === "2026-02-01" ? "february" : "august"]!;
          revisionRows.push({ rowNumber: rowNumber++, itemCode: row.itemCode, effectiveDate: date, variant: row.variant, targetRowId: row.id, previousValue: row.mrp, newValue: expected, note, operation: "update", previousRowSnapshot: JSON.stringify(row), outcome: "change" });
        }
      }
      for (const row of mayRows) {
        revisionRows.push({ rowNumber: rowNumber++, itemCode: row.itemCode, effectiveDate: row.effectiveDate, variant: row.variant, targetRowId: row.id, previousValue: row.mrp, newValue: null, note: P033R3_DELETE_NOTE, operation: "delete", previousRowSnapshot: JSON.stringify(row), outcome: "change" });
      }
      const reason = "P033r3 — unit restatement to per-pipe and delete spurious May period";
      const batch = await db.transaction(async (tx) => {
        const inserted = await tx.insert(mrpRevisionBatchesTable).values({
          targetType: "mrp", lockedEffectiveDate: null, fileName: req.file!.originalname, fileSha256: hash,
          fileSizeBytes: req.file!.size, uploadedBy: userLabel(req), reason, rowsInFile: 270,
          rowsChanged: 270, rowsNoop: 0, rowsRejected: 0, warningCount: 0,
        }).returning({ id: mrpRevisionBatchesTable.id });
        if (!inserted[0]) throw new Error("Could not create P033r3 preview batch.");
        await tx.insert(mrpRevisionRowsTable).values(revisionRows.map((row) => ({ ...row, batchId: inserted[0]!.id })));
        return inserted[0].id;
      });
      const storedRows = await db.select().from(mrpRevisionRowsTable).where(eq(mrpRevisionRowsTable.batchId, batch));
      res.json({ batchId: batch, status: "preview", correction: "P033r3", fileSha256: hash, rowsInFile: 270, rowsChanged: 270, rowsNoop: 0, rowsRejected: 0, updateRows: 180, deleteRows: 90, exact3x, withinOne, halted: 0, enumeratedRows: affectedRows, verification, rows: storedRows });
    } catch (error: any) {
      req.log?.error({ err: error }, "P033r3 preview failed");
      res.status(error.httpStatus ?? 400).json({ error: error instanceof Error ? error.message : "Could not preview P033r3." });
    }
  },
);

router.post(
  "/catalog/mrp-revisions/preview",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const targetType = targetTypeValue(req.body.targetType);
    const lockedCompetitor = textValue(req.body.competitor);
    const lockedDate = textValue(req.body.effectiveDate);
    const reason = textValue(req.body.reason);
    if (!targetType) {
      res.status(400).json({ error: "targetType must be mrp or competitor." });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: "reason is required for a revision batch." });
      return;
    }
    if (targetType === "competitor" && !lockedCompetitor) {
      res.status(400).json({ error: "competitor is required for competitor revisions." });
      return;
    }
    if (!lockedDate || !isIsoDate(lockedDate)) {
      res.status(400).json({ error: "A valid existing effectiveDate is required for revisions." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Attach a revision workbook." });
      return;
    }

    try {
      const parsedWorkbook = parseRevisionWorkbook(req.file.buffer, targetType);
      const parsed = parsedWorkbook.rows;
      const fileSha256 = sha256ForBuffer(req.file.buffer);
      // The catalog is small enough that a single read is clearer and safer
      // than relying on database-specific normalization of uploaded codes.
      const products = await db.select().from(catalogProductsTable);
      const productByCode = new Map(products.map((product) => [normCode(product.itemCode), product]));

      const allMrpRows = targetType === "mrp"
        ? await db.select().from(mrpPriceHistoryTable)
        : [];
      const mrpRows = allMrpRows.filter((row) => row.effectiveDate === lockedDate);
      const allCompetitorRows = targetType === "competitor"
        ? await db.select().from(competitorPricesTable).where(
            eq(competitorPricesTable.competitor, lockedCompetitor!),
          )
        : [];
      const competitorRows = allCompetitorRows.filter((row) => row.effectiveDate === lockedDate);
      if (targetType === "mrp" && mrpRows.length === 0) {
        throw Object.assign(
          new Error(`No existing MRP period found for selected date ${lockedDate}.`),
          { httpStatus: 400 },
        );
      }
      if (targetType === "competitor" && competitorRows.length === 0) {
        throw Object.assign(
          new Error(`No existing ${lockedCompetitor} period found for selected date ${lockedDate}.`),
          { httpStatus: 400 },
        );
      }

      const rowsToInsert: Omit<typeof mrpRevisionRowsTable.$inferInsert, "batchId">[] = [];
      let changed = 0;
      let noop = 0;
      let rejected = 0;
      let warningCount = 0;
      let dateMismatchCount = 0;
      const dateMismatchDates = new Set<string>();
      const changeTargetIds = new Set<number>();
      const changesByPeriod = new Map<string, number>();
      const periodCounts = new Map<string, number>();
      if (targetType === "mrp") {
        for (const row of mrpRows) {
          periodCounts.set(row.effectiveDate, (periodCounts.get(row.effectiveDate) ?? 0) + 1);
        }
      } else {
        periodCounts.set(lockedDate!, competitorRows.length);
      }

      for (const row of parsed) {
        const rowDate: string | null = parsedWorkbook.hasEffectiveDateColumn
          ? row.effectiveDate
          : lockedDate;
        const reject = (reason: string, previousValue: number | null = null) => {
          rejected++;
          rowsToInsert.push({
            rowNumber: row.rowNumber,
            itemCode: row.itemCode || null,
            effectiveDate: rowDate,
            variant: row.variant,
            competitor: row.competitor,
            previousValue,
            newValue: row.newValue,
            note: row.note,
            outcome: "rejected",
            rejectionReason: reason,
          });
        };
        if (!row.itemCode) {
          reject("item_code is blank.");
          continue;
        }
        if (!rowDate || !isIsoDate(rowDate)) {
          reject("effective_date must be a valid YYYY-MM-DD date.");
          continue;
        }
        const product = productByCode.get(normCode(row.itemCode));
        if (rowDate !== lockedDate) {
          dateMismatchCount++;
          dateMismatchDates.add(rowDate);
          let rowDatePrevious: number | null = null;
          if (targetType === "mrp" && product) {
            rowDatePrevious = allMrpRows.find(
                (candidate) =>
                  normCode(candidate.itemCode) === normCode(product.itemCode) &&
                  candidate.effectiveDate === rowDate &&
                  candidate.variant === row.variant,
              )?.mrp ?? null;
          } else if (targetType === "competitor") {
            rowDatePrevious = allCompetitorRows.find(
                (candidate) =>
                  normCode(candidate.competitorCode) === normCode(row.itemCode) &&
                  candidate.effectiveDate === rowDate,
              )?.price ?? null;
          }
          reject(
            `Row date ${rowDate} does not match the selected period ${lockedDate}.`,
            rowDatePrevious,
          );
          continue;
        }
        if (row.newValue == null) {
          reject("new_mrp is blank or not numeric.");
          continue;
        }
        if (row.newValue < 0) {
          reject("new_mrp cannot be negative.");
          continue;
        }
        if (targetType === "competitor") {
          if (row.competitor !== lockedCompetitor) {
            reject(`Competitor is locked to "${lockedCompetitor}".`);
            continue;
          }
        }

        let targetRow: typeof mrpRows[number] | typeof competitorRows[number] | undefined;
        let previous: number | null = null;
        let division: string | null = product?.division ?? null;
        if (targetType === "mrp") {
          if (!product) {
            reject("item_code does not exist in catalog_products.");
            continue;
          }
          targetRow = mrpRows.find(
            (candidate) =>
              normCode(candidate.itemCode) === normCode(product.itemCode) &&
              candidate.effectiveDate === rowDate &&
              candidate.variant === row.variant,
          );
          if (!targetRow) {
            reject(`No existing MRP row for ${product.itemCode}, ${rowDate}, ${row.variant}. Use the MRP loader for a new period.`);
            continue;
          }
          previous = targetRow.mrp;
        } else {
          const matches = competitorRows.filter(
            (candidate) =>
              normCode(candidate.competitorCode) === normCode(row.itemCode) &&
              candidate.effectiveDate === rowDate,
          );
          if (matches.length !== 1) {
            reject(matches.length === 0
              ? "No existing competitor row matches this competitor code and period."
              : "More than one competitor row matches this code and period; revision is intentionally blocked.");
            continue;
          }
          targetRow = matches[0];
          previous = targetRow.price;
        }
        if (previous == null) {
          reject("The existing price is blank and cannot be revised.");
          continue;
        }
        if (targetRow && changeTargetIds.has(targetRow.id)) {
          reject("Duplicate code/date/variant row in upload.");
          continue;
        }

        const isNoop = previous === row.newValue;
        const warnings = isNoop
          ? []
          : warningFor(row.itemCode, division, previous, row.newValue);
        if (isNoop) noop++;
        else {
          changed++;
          changeTargetIds.add(targetRow!.id);
          changesByPeriod.set(
            rowDate,
            (changesByPeriod.get(rowDate) ?? 0) + 1,
          );
        }
        warningCount += warnings.length;
        rowsToInsert.push({
          rowNumber: row.rowNumber,
          itemCode: targetType === "mrp" ? product!.itemCode : row.itemCode,
          effectiveDate: rowDate,
          variant: row.variant,
          competitor: targetType === "competitor" ? lockedCompetitor : null,
          targetRowId: targetRow!.id,
          previousValue: previous,
          newValue: row.newValue,
          note: row.note,
          outcome: isNoop ? "noop" : "change",
          warningReasons: warnings.length ? JSON.stringify(warnings) : null,
        });
      }

      for (const row of rowsToInsert.filter((candidate) => candidate.outcome === "change")) {
        const periodTotal = periodCounts.get(row.effectiveDate ?? "") ?? 0;
        const periodChanges = changesByPeriod.get(row.effectiveDate ?? "") ?? 0;
        if (periodTotal > 0 && periodChanges / periodTotal > 0.2) {
          const current = row.warningReasons ? JSON.parse(row.warningReasons) as string[] : [];
          current.push(`This upload changes ${periodChanges} of ${periodTotal} rows (${((periodChanges / periodTotal) * 100).toFixed(1)}%), above 20% of the period.`);
          row.warningReasons = JSON.stringify(current);
          warningCount++;
        }
      }

      const batch = await db.transaction(async (tx) => {
        const inserted = await tx.insert(mrpRevisionBatchesTable).values({
          targetType,
          competitor: targetType === "competitor" ? lockedCompetitor : null,
          lockedEffectiveDate: lockedDate,
          fileName: req.file!.originalname,
          fileSha256,
          fileSizeBytes: req.file!.size,
          uploadedBy: userLabel(req),
          reason,
          rowsInFile: parsed.length,
          rowsChanged: changed,
          rowsNoop: noop,
          rowsRejected: rejected,
          warningCount,
        }).returning({ id: mrpRevisionBatchesTable.id });
        if (!inserted[0]) throw new Error("Could not create revision batch.");
        if (rowsToInsert.length) {
          await tx.insert(mrpRevisionRowsTable).values(
            rowsToInsert.map((row) => ({ ...row, batchId: inserted[0]!.id })),
          );
        }
        return inserted[0].id;
      });

      const storedRows = await db.select().from(mrpRevisionRowsTable)
        .where(eq(mrpRevisionRowsTable.batchId, batch));
      res.json({
        batchId: batch,
        targetType,
        competitor: lockedCompetitor,
        effectiveDate: lockedDate,
        hasEffectiveDateColumn: parsedWorkbook.hasEffectiveDateColumn,
        dateMismatchCount,
        dateMismatchDates: [...dateMismatchDates].sort(),
        fileName: req.file.originalname,
        fileSha256,
        status: "preview",
        rowsInFile: parsed.length,
        rowsChanged: changed,
        rowsNoop: noop,
        rowsRejected: rejected,
        warningCount,
        rows: storedRows,
      });
    } catch (error: any) {
      req.log?.error({ err: error }, "MRP revision preview failed");
      res
        .status(error.httpStatus ?? 400)
        .json({ error: error instanceof Error ? error.message : "Could not preview revision workbook." });
    }
  },
);

router.get("/catalog/mrp-revisions/:batchId", requireAdmin, async (req, res) => {
  const batchId = Number(req.params.batchId);
  if (!Number.isInteger(batchId)) {
    res.status(400).json({ error: "batchId must be an integer." });
    return;
  }
  const batch = await db.select().from(mrpRevisionBatchesTable)
    .where(eq(mrpRevisionBatchesTable.id, batchId)).limit(1);
  if (!batch[0]) {
    res.status(404).json({ error: "Revision batch not found." });
    return;
  }
  const rows = await db.select().from(mrpRevisionRowsTable)
    .where(eq(mrpRevisionRowsTable.batchId, batchId))
    .orderBy(asc(mrpRevisionRowsTable.rowNumber));
  res.json({ batch: batch[0], rows });
});

router.post("/catalog/mrp-revisions/:batchId/apply", requireAdmin, async (req, res) => {
  const batchId = Number(req.params.batchId);
  const acknowledgeWarnings = req.body?.acknowledgeWarnings === true;
  if (!Number.isInteger(batchId)) {
    res.status(400).json({ error: "batchId must be an integer." });
    return;
  }
  try {
    const applied = await db.transaction(async (tx) => {
      // The status check and terminal transition must be serialized so an
      // Apply and Discard request can never both win for the same preview.
      await tx.execute(sql`
        SELECT id FROM mrp_revision_batches
        WHERE id = ${batchId}
        FOR UPDATE
      `);
      const batch = (await tx.select().from(mrpRevisionBatchesTable)
        .where(eq(mrpRevisionBatchesTable.id, batchId)).limit(1))[0];
      if (!batch) throw Object.assign(new Error("Revision batch not found."), { httpStatus: 404 });
      if (batch.targetType === "p034r2") {
        throw Object.assign(new Error("P034r2 batches must use the dedicated decision apply endpoint."), { httpStatus: 409 });
      }
      if (batch.status !== "preview") throw Object.assign(new Error(`Revision batch is already ${batch.status}.`), { httpStatus: 409 });
      if (batch.warningCount > 0 && !acknowledgeWarnings) {
        throw Object.assign(new Error("Explicit acknowledgement is required for revision warnings."), { httpStatus: 409 });
      }
      const rows = await tx.select().from(mrpRevisionRowsTable)
        .where(and(eq(mrpRevisionRowsTable.batchId, batchId), eq(mrpRevisionRowsTable.outcome, "change")))
        .orderBy(asc(mrpRevisionRowsTable.id));
      if (rows.length === 0) {
        throw Object.assign(
          new Error(
            batch.rowsRejected > 0
              ? `Nothing to apply: ${batch.rowsInFile} rows, ${batch.rowsNoop} no-ops, ${batch.rowsRejected} rejected.`
              : `Nothing to apply: ${batch.rowsInFile} rows, all no-ops.`,
          ),
          { httpStatus: 409 },
        );
      }
      for (const row of rows) {
        if (!row.targetRowId || row.previousValue == null || (row.operation !== "delete" && row.newValue == null)) {
          throw new Error(`Revision row ${row.rowNumber} is missing its target or values.`);
        }
        if (batch.targetType === "mrp") {
          // Different previews can point to the same price row. Lock it before
          // validating the previous value so a stale batch cannot overwrite a
          // revision that committed while it was waiting.
          await tx.execute(sql`
            SELECT id FROM mrp_price_history
            WHERE id = ${row.targetRowId}
            FOR UPDATE
          `);
          const current = (await tx.select().from(mrpPriceHistoryTable)
            .where(eq(mrpPriceHistoryTable.id, row.targetRowId)).limit(1))[0];
          const previousSnapshot = row.previousRowSnapshot
            ? parseHistorySnapshot(row.previousRowSnapshot)
            : null;
          if (
            !current ||
            current.itemCode !== row.itemCode ||
            current.effectiveDate !== row.effectiveDate ||
            (batch.lockedEffectiveDate != null && current.effectiveDate !== batch.lockedEffectiveDate) ||
            current.variant !== "Standard" ||
            current.reviewStatus !== "approved" ||
            current.mrp !== row.previousValue ||
            (previousSnapshot && !matchesHistorySnapshot(current, previousSnapshot))
          ) {
            throw Object.assign(new Error(`MRP row ${row.rowNumber} identity or value changed after preview; create a fresh preview.`), { httpStatus: 409 });
          }
          if (row.operation === "delete") {
            await tx.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.id, row.targetRowId));
          } else {
            await tx.update(mrpPriceHistoryTable).set({
              mrp: row.newValue,
              ...(previousSnapshot ? { notes: withAuditNote(previousSnapshot.notes, row.note ?? batch.reason ?? "") } : {}),
              lastRevisionBatchId: batchId,
            }).where(eq(mrpPriceHistoryTable.id, row.targetRowId));
          }
          await tx.insert(mrpHistoryProvenanceEventsTable).values({
            historyRowId: row.targetRowId,
            itemCode: row.itemCode!,
            effectiveDate: row.effectiveDate!,
            action: row.operation === "delete" ? "revision_deleted" : "revision_applied",
            reason: row.note ?? batch.reason,
            sourceFile: batch.fileName,
            previousMrp: row.previousValue,
            mrp: row.newValue,
            ...(previousSnapshot ? { loadBatchId: (previousSnapshot.loadBatchId ?? null) as number | null } : {}),
          });
        } else {
          await tx.execute(sql`
            SELECT id FROM competitor_prices
            WHERE id = ${row.targetRowId}
            FOR UPDATE
          `);
          const current = (await tx.select({ id: competitorPricesTable.id, price: competitorPricesTable.price })
            .from(competitorPricesTable).where(eq(competitorPricesTable.id, row.targetRowId)).limit(1))[0];
          if (!current || current.price !== row.previousValue) {
            throw Object.assign(new Error(`Competitor row ${row.rowNumber} changed after preview; create a fresh preview.`), { httpStatus: 409 });
          }
          await tx.update(competitorPricesTable).set({
            price: row.newValue,
            lastRevisionBatchId: batchId,
            updatedAt: new Date(),
          })
            .where(eq(competitorPricesTable.id, row.targetRowId));
        }
      }
      await tx.update(mrpRevisionBatchesTable).set({
        status: "applied",
        warningAcknowledged: acknowledgeWarnings,
        appliedAt: new Date(),
        appliedBy: userLabel(req),
      }).where(eq(mrpRevisionBatchesTable.id, batchId));
      return { batchId, rowsChanged: rows.length };
    });
    res.json({ ...applied, status: "applied" });
  } catch (error: any) {
    const status = error.httpStatus ?? 500;
    if (status >= 500) req.log.error({ err: error, batchId }, "MRP revision apply failed");
    res.status(status).json({ error: error.message ?? "Could not apply revision." });
  }
});

router.post("/catalog/mrp-revisions/:batchId/discard", requireAdmin, async (req, res) => {
  const batchId = Number(req.params.batchId);
  if (!Number.isInteger(batchId)) {
    res.status(400).json({ error: "batchId must be an integer." });
    return;
  }
  try {
    const discarded = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM mrp_revision_batches
        WHERE id = ${batchId}
        FOR UPDATE
      `);
      const batch = (await tx.select().from(mrpRevisionBatchesTable)
        .where(eq(mrpRevisionBatchesTable.id, batchId)).limit(1))[0];
      if (!batch) throw Object.assign(new Error("Revision batch not found."), { httpStatus: 404 });
      if (batch.targetType === "p034r2") {
        throw Object.assign(new Error("P034r2 batches must use the dedicated decision rollback endpoint."), { httpStatus: 409 });
      }
      if (batch.status !== "preview") {
        throw Object.assign(new Error(`Revision batch is already ${batch.status}.`), { httpStatus: 409 });
      }
      await tx.update(mrpRevisionBatchesTable).set({
        status: "discarded",
        discardedAt: new Date(),
        discardedBy: userLabel(req),
      }).where(eq(mrpRevisionBatchesTable.id, batchId));
      return { batchId, status: "discarded" as const };
    });
    res.json(discarded);
  } catch (error: any) {
    const status = error.httpStatus ?? 500;
    if (status >= 500) req.log.error({ err: error, batchId }, "MRP revision discard failed");
    res.status(status).json({ error: error.message ?? "Could not discard revision." });
  }
});

router.post("/catalog/mrp-revisions/:batchId/rollback", requireAdmin, async (req, res) => {
  const batchId = Number(req.params.batchId);
  if (!Number.isInteger(batchId)) {
    res.status(400).json({ error: "batchId must be an integer." });
    return;
  }
  try {
    const rolledBack = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM mrp_revision_batches
        WHERE id = ${batchId}
        FOR UPDATE
      `);
      const batch = (await tx.select().from(mrpRevisionBatchesTable)
        .where(eq(mrpRevisionBatchesTable.id, batchId)).limit(1))[0];
      if (!batch) throw Object.assign(new Error("Revision batch not found."), { httpStatus: 404 });
      if (batch.status !== "applied") throw Object.assign(new Error("Only an applied revision can be rolled back."), { httpStatus: 409 });
      const rows = await tx.select().from(mrpRevisionRowsTable)
        .where(and(eq(mrpRevisionRowsTable.batchId, batchId), eq(mrpRevisionRowsTable.outcome, "change")))
        .orderBy(asc(mrpRevisionRowsTable.id));
      for (const row of rows) {
        if (!row.targetRowId || row.previousValue == null || (row.operation !== "delete" && row.newValue == null)) throw new Error(`Revision row ${row.rowNumber} is incomplete.`);
        if (batch.targetType === "mrp") {
          if (row.operation === "delete") {
            if (!row.previousRowSnapshot) throw new Error(`Deleted revision row ${row.rowNumber} has no restoration snapshot.`);
            await tx.execute(sql`SELECT id FROM mrp_price_history WHERE item_code = ${row.itemCode!} AND effective_date = ${row.effectiveDate!} AND variant = ${row.variant} FOR UPDATE`);
            const existing = (await tx.select({ id: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable)
              .where(and(eq(mrpPriceHistoryTable.itemCode, row.itemCode!), eq(mrpPriceHistoryTable.effectiveDate, row.effectiveDate!), eq(mrpPriceHistoryTable.variant, row.variant))).limit(1))[0];
            if (existing) throw Object.assign(new Error(`Deleted MRP row ${row.rowNumber} was recreated after apply; rollback was not performed.`), { httpStatus: 409 });
            const restored = parseHistorySnapshot(row.previousRowSnapshot);
            if (!Number.isInteger(restored.loadBatchId) || Number(restored.loadBatchId) <= 0) {
              throw Object.assign(new Error(`Deleted MRP row ${row.rowNumber} has no load batch; rollback was not performed.`), { httpStatus: 409 });
            }
            await tx.insert(mrpPriceHistoryTable).values(restored as typeof mrpPriceHistoryTable.$inferInsert);
            await tx.insert(mrpHistoryProvenanceEventsTable).values({
              historyRowId: Number(restored.id ?? row.targetRowId),
              itemCode: row.itemCode!,
              effectiveDate: row.effectiveDate!,
              action: "revision_rollback",
              reason: `Rollback of revision batch ${batchId}`,
              sourceFile: batch.fileName,
              previousMrp: null,
              mrp: row.previousValue,
            });
            continue;
          }
          await tx.execute(sql`
            SELECT id FROM mrp_price_history
            WHERE id = ${row.targetRowId}
            FOR UPDATE
          `);
          const current = (await tx.select({
            mrp: mrpPriceHistoryTable.mrp,
            notes: mrpPriceHistoryTable.notes,
            lastRevisionBatchId: mrpPriceHistoryTable.lastRevisionBatchId,
          })
            .from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.id, row.targetRowId)).limit(1))[0];
          if (!current || current.mrp !== row.newValue) {
            throw Object.assign(new Error(`MRP row ${row.rowNumber} changed after apply; rollback was not performed.`), { httpStatus: 409 });
          }
          const previousSnapshot = row.previousRowSnapshot
            ? parseHistorySnapshot(row.previousRowSnapshot)
            : null;
          if (previousSnapshot && (
            current.notes !== withAuditNote(previousSnapshot.notes, row.note ?? batch.reason ?? "") ||
            current.lastRevisionBatchId !== batchId
          )) {
            throw Object.assign(new Error(`MRP row ${row.rowNumber} audit state changed after apply; rollback was not performed.`), { httpStatus: 409 });
          }
          await tx.update(mrpPriceHistoryTable).set({
            mrp: row.previousValue,
            ...(previousSnapshot
              ? {
                  notes: (previousSnapshot.notes ?? null) as string | null,
                  lastRevisionBatchId: (previousSnapshot.lastRevisionBatchId ?? null) as number | null,
                }
              : { lastRevisionBatchId: batchId }),
          })
            .where(eq(mrpPriceHistoryTable.id, row.targetRowId));
          await tx.insert(mrpHistoryProvenanceEventsTable).values({
            historyRowId: row.targetRowId,
            itemCode: row.itemCode!,
            effectiveDate: row.effectiveDate!,
            action: "revision_rollback",
            reason: `Rollback of revision batch ${batchId}`,
            sourceFile: batch.fileName,
            previousMrp: row.newValue,
            mrp: row.previousValue,
          });
        } else {
          await tx.execute(sql`
            SELECT id FROM competitor_prices
            WHERE id = ${row.targetRowId}
            FOR UPDATE
          `);
          const current = (await tx.select({ price: competitorPricesTable.price })
            .from(competitorPricesTable).where(eq(competitorPricesTable.id, row.targetRowId)).limit(1))[0];
          if (!current || current.price !== row.newValue) {
            throw Object.assign(new Error(`Competitor row ${row.rowNumber} changed after apply; rollback was not performed.`), { httpStatus: 409 });
          }
          await tx.update(competitorPricesTable).set({
            price: row.previousValue,
            lastRevisionBatchId: batchId,
            updatedAt: new Date(),
          })
            .where(eq(competitorPricesTable.id, row.targetRowId));
        }
      }
      await tx.update(mrpRevisionBatchesTable).set({
        status: "rolled_back",
        rolledBackAt: new Date(),
        rolledBackBy: userLabel(req),
      }).where(eq(mrpRevisionBatchesTable.id, batchId));
      return { batchId, rowsRolledBack: rows.length };
    });
    res.json({ ...rolledBack, status: "rolled_back" });
  } catch (error: any) {
    const status = error.httpStatus ?? 500;
    if (status >= 500) req.log.error({ err: error, batchId }, "MRP revision rollback failed");
    res.status(status).json({ error: error.message ?? "Could not roll back revision." });
  }
});

export default router;