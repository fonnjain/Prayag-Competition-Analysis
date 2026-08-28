import * as XLSX from "xlsx";

export interface AdminUserImportCandidate {
  row: number;
  email: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
}

export interface AdminUserImportIssue {
  row: number;
  name: string | null;
  email: string | null;
  reason: string;
}

export interface ParsedAdminUserWorkbook {
  totalRows: number;
  candidates: AdminUserImportCandidate[];
  duplicateRows: number;
  invalidRows: number;
  issues: AdminUserImportIssue[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function cleanCell(value: unknown): string {
  return String(value ?? "").trim();
}

function splitName(fullName: string): { firstName: string; lastName: string | null } {
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() ?? "",
    lastName: parts.length > 0 ? parts.join(" ") : null,
  };
}

function findHeaderRow(rows: unknown[][]): {
  rowIndex: number;
  emailColumn: number;
  nameColumn: number | null;
  firstNameColumn: number | null;
  lastNameColumn: number | null;
} {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const headers = rows[rowIndex]!.map(normaliseHeader);
    const emailColumn = headers.findIndex((header) =>
      ["email", "emailaddress", "mail"].includes(header),
    );
    const nameColumn = headers.findIndex((header) =>
      ["name", "fullname", "salesperson", "salespersonname"].includes(header),
    );
    const firstNameColumn = headers.findIndex((header) =>
      ["firstname", "givenname"].includes(header),
    );
    const lastNameColumn = headers.findIndex((header) =>
      ["lastname", "surname", "familyname"].includes(header),
    );

    if (emailColumn >= 0 && (nameColumn >= 0 || firstNameColumn >= 0)) {
      return {
        rowIndex,
        emailColumn,
        nameColumn: nameColumn >= 0 ? nameColumn : null,
        firstNameColumn: firstNameColumn >= 0 ? firstNameColumn : null,
        lastNameColumn: lastNameColumn >= 0 ? lastNameColumn : null,
      };
    }
  }

  throw new Error(
    'Could not find a header row containing "Email" and either "Name" or "First name".',
  );
}

function findUserSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
  const preferredName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === "users");
  if (preferredName) return workbook.Sheets[preferredName]!;

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: false,
    });
    try {
      findHeaderRow(rows);
      return sheet;
    } catch {
      // Continue looking for a sheet with the expected columns.
    }
  }

  throw new Error('Could not find a "Users" sheet with recognizable name and email columns.');
}

export function parseAdminUserWorkbook(buffer: Buffer): ParsedAdminUserWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = findUserSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  const header = findHeaderRow(rows);
  const validRows: AdminUserImportCandidate[] = [];
  const issues: AdminUserImportIssue[] = [];
  let invalidRows = 0;
  let totalRows = 0;

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (!row.some((value) => cleanCell(value) !== "")) continue;

    totalRows += 1;
    const email = cleanCell(row[header.emailColumn]).toLowerCase();
    const fullName =
      header.nameColumn == null ? "" : cleanCell(row[header.nameColumn]);
    const split = splitName(fullName);
    const firstName =
      header.firstNameColumn == null
        ? split.firstName
        : cleanCell(row[header.firstNameColumn]);
    const lastNameValue =
      header.lastNameColumn == null
        ? split.lastName
        : cleanCell(row[header.lastNameColumn]);
    const lastName = lastNameValue || null;
    const displayName = [firstName, lastName].filter(Boolean).join(" ");
    const issueBase = {
      row: rowIndex + 1,
      name: displayName || fullName || null,
      email: email || null,
    };

    if (!displayName) {
      invalidRows += 1;
      issues.push({ ...issueBase, reason: "Name is required." });
      continue;
    }
    if (!EMAIL_PATTERN.test(email)) {
      invalidRows += 1;
      issues.push({ ...issueBase, reason: "A valid email address is required." });
      continue;
    }
    validRows.push({
      row: rowIndex + 1,
      email,
      firstName,
      lastName,
      displayName,
    });
  }

  if (totalRows === 0) {
    throw new Error("The workbook contains no user rows.");
  }

  const emailCounts = new Map<string, number>();
  for (const row of validRows) {
    emailCounts.set(row.email, (emailCounts.get(row.email) ?? 0) + 1);
  }
  const candidates = validRows.filter((row) => emailCounts.get(row.email) === 1);
  const duplicateRows = validRows.length - candidates.length;
  for (const row of validRows) {
    if (emailCounts.get(row.email) === 1) continue;
    issues.push({
      row: row.row,
      name: row.displayName,
      email: row.email,
      reason: "Duplicate email in this workbook; neither row will be imported.",
    });
  }

  return { totalRows, candidates, duplicateRows, invalidRows, issues };
}