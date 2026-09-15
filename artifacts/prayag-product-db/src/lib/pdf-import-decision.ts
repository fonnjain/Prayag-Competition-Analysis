export type PdfImportPath = "text" | "vision" | "text_then_ai";

export type PdfDuplicateMatch = {
  batchId: number;
  effectiveDate: string;
  status: string;
  extractionPath: PdfImportPath | null;
};

export type PdfDuplicateDecision = {
  action: "new" | "reuse" | "new_period" | "supersede";
  message: string;
  existingBatchId: number | null;
  existingStatus?: string;
};

/** Derive the visible decision from the currently selected path, not stale preflight UI state. */
export function derivePdfDuplicateDecision(
  matches: PdfDuplicateMatch[],
  competitor: string,
  fileSha256: string,
  effectiveDate: string,
  extractionPath: PdfImportPath | null,
): PdfDuplicateDecision {
  const sameDate = matches.filter((match) => match.effectiveDate === effectiveDate);
  const exact = sameDate.find((match) => match.extractionPath === extractionPath);
  if (exact) {
    return {
      action: "reuse",
      message: `Identical ${competitor} catalogue (SHA ${fileSha256.slice(0, 12)}…) already exists as batch ${exact.batchId}; it will be reused and will not duplicate prices.`,
      existingBatchId: exact.batchId,
      existingStatus: exact.status,
    };
  }
  if (sameDate[0]) {
    return {
      action: "supersede",
      message: `Identical PDF exists as batch ${sameDate[0].batchId} for ${effectiveDate} with extraction path ${sameDate[0].extractionPath ?? "unknown"}; choosing ${extractionPath} will create a superseding review batch.`,
      existingBatchId: sameDate[0].batchId,
      existingStatus: sameDate[0].status,
    };
  }
  if (matches[0]) {
    return {
      action: "new_period",
      message: `Identical ${competitor} catalogue exists as batch ${matches[0].batchId} for ${matches[0].effectiveDate}; this upload will create a new period for ${effectiveDate} referencing the same source.`,
      existingBatchId: matches[0].batchId,
      existingStatus: matches[0].status,
    };
  }
  return {
    action: "new",
    message: "No identical catalogue is recorded. A new review batch will be staged after you confirm the extraction path.",
    existingBatchId: null,
  };
}