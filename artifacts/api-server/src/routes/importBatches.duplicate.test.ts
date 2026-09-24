import { describe, expect, it } from "vitest";
import { duplicateDecision } from "./importBatches.js";

function match(id: number, date: string, path: string, competitor = "Prince", extractorVersion?: string) {
  return {
    id,
    competitor,
    effectiveDate: date,
    extractorVersion,
    rowCounts: JSON.stringify({ extractionPath: path }),
    status: "approved",
  } as any;
}

describe("PDF duplicate decisions", () => {
  it("changes from reuse to supersede when the selected path changes", () => {
    const rows = [match(10, "2026-03-01", "text")];
    expect(duplicateDecision(rows, "Prince", "a".repeat(64), "2026-03-01", "text").action)
      .toBe("reuse");
    const override = duplicateDecision(rows, "Prince", "a".repeat(64), "2026-03-01", "vision");
    expect(override.action).toBe("supersede");
    expect(override.message).toMatch(/choosing vision.*superseding/i);
  });

  it("reports a new period for the same source on another date", () => {
    const decision = duplicateDecision(
      [match(10, "2026-03-01", "text")],
      "Prince",
      "a".repeat(64),
      "2026-09-01",
      "text",
    );
    expect(decision.action).toBe("new_period");
  });

  it("supersedes an old Apollo extraction even when SHA/date/path match", () => {
    const rows = [match(10, "2026-03-01", "vision", "Apollo", "pdf-code-discovery-v2:vision")];
    const decision = duplicateDecision(rows, "Apollo", "a".repeat(64), "2026-03-01", "vision");
    expect(decision.action).toBe("supersede");
  });

  it("reuses a current Apollo extraction idempotently", () => {
    const rows = [match(10, "2026-03-01", "vision", "Apollo", "pdf-code-discovery-v3:vision")];
    const decision = duplicateDecision(rows, "Apollo", "a".repeat(64), "2026-03-01", "vision");
    expect(decision.action).toBe("reuse");
  });

  it("does not apply Apollo versioning to other brands", () => {
    const rows = [match(10, "2026-03-01", "vision", "Prince", "pdf-code-discovery-v2:vision")];
    const decision = duplicateDecision(rows, "Prince", "a".repeat(64), "2026-03-01", "vision");
    expect(decision.action).toBe("reuse");
  });
});