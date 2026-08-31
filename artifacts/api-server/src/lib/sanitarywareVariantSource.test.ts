import { describe, expect, it } from "vitest";
import { getSanitarywareVariantSourceAudit } from "./sanitarywareVariantSource";

describe("sanitaryware colour source completeness", () => {
  it("accounts for both periods and the two duplicate 4663/Ivory entries", () => {
    const audit = getSanitarywareVariantSourceAudit();

    expect(audit.rawRows).toHaveLength(300);
    expect(audit.uniqueRows).toHaveLength(298);
    expect(audit.duplicateKeys).toEqual([
      "4663\u001f2026-01-15\u001fIvory",
      "4663\u001f2026-05-01\u001fIvory",
    ]);
    expect(
      audit.periods.map((period) => ({
        effectiveDate: period.effectiveDate,
        rowCount: period.rowCount,
        payloadSha256: period.payloadSha256,
        payloadBytes: period.payloadBytes,
      })),
    ).toEqual([
      {
        effectiveDate: "2026-01-15",
        rowCount: 148,
        payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        payloadBytes: expect.any(Number),
      },
      {
        effectiveDate: "2026-05-01",
        rowCount: 150,
        payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        payloadBytes: expect.any(Number),
      },
    ]);
  });
});