import { describe, expect, it } from "vitest";
import {
  competitorRevisionGroupKey,
  derivePriceHistoryStatuses,
} from "./priceHistoryStatus.js";

describe("derivePriceHistoryStatuses", () => {
  it("derives Current, Upcoming, and Superseded without accepting a stored flag", () => {
    const rows = [
      { id: 1, effectiveDate: "2026-05-01", itemCode: "CCL-60-BSK", variant: "Standard", isCurrent: true },
      { id: 2, effectiveDate: "2026-09-01", itemCode: "CCL-60-BSK", variant: "Standard", isCurrent: false },
    ];

    const beforeSeptember = derivePriceHistoryStatuses(
      rows,
      "2026-08-31",
      (row) => `${row.itemCode}\u0000${row.variant}`,
    );
    const onSeptember = derivePriceHistoryStatuses(
      rows,
      "2026-09-01",
      (row) => `${row.itemCode}\u0000${row.variant}`,
    );

    expect([...beforeSeptember.values()]).toEqual(["Current", "Upcoming"]);
    expect([...onSeptember.values()]).toEqual(["Superseded", "Current"]);
  });

  it("keeps Standard and colour-variant timelines independent", () => {
    const rows = [
      { id: 1, effectiveDate: "2026-05-01", itemCode: "SAN-1", variant: "Standard" },
      { id: 2, effectiveDate: "2026-09-01", itemCode: "SAN-1", variant: "Standard" },
      { id: 3, effectiveDate: "2026-05-01", itemCode: "SAN-1", variant: "Ivory" },
      { id: 4, effectiveDate: "2026-10-01", itemCode: "SAN-1", variant: "Ivory" },
    ];

    const statuses = derivePriceHistoryStatuses(
      rows,
      "2026-09-01",
      (row) => `${row.itemCode}\u0000${row.variant}`,
    );

    expect(statuses.get(1)).toBe("Superseded");
    expect(statuses.get(2)).toBe("Current");
    expect(statuses.get(3)).toBe("Current");
    expect(statuses.get(4)).toBe("Upcoming");
  });

  it("keeps distinct exact codes on independent competitor timelines", () => {
    const rows = [
      { id: 1, effectiveDate: "2026-07-01", competitor: "Sparsh", matchedPrayagCode: " CCL 60 " },
      { id: 2, effectiveDate: "2026-07-01", competitor: "Sparsh", matchedPrayagCode: "CCL60" },
      { id: 3, effectiveDate: "2026-09-01", competitor: "Sparsh", matchedPrayagCode: "CCL60" },
    ];

    const statuses = derivePriceHistoryStatuses(
      rows,
      "2026-08-31",
      competitorRevisionGroupKey,
    );

    expect(statuses.get(1)).toBe("Current");
    expect(statuses.get(2)).toBe("Current");
    expect(statuses.get(3)).toBe("Upcoming");
  });
});
