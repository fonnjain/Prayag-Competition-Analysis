import { describe, expect, it } from "vitest";
import { deriveConfirmedDiscontinuations } from "./discontinuationPolicy.js";

describe("deriveConfirmedDiscontinuations", () => {
  it("keeps a shared code live when any range occurrence has a live price", () => {
    const result = deriveConfirmedDiscontinuations([
      {
        itemCode: "BD-40",
        markerPeriod: "2026-08-01",
        latestPricedPeriod: null,
        isRemoved: true,
      },
      {
        itemCode: "BD-40",
        markerPeriod: null,
        latestPricedPeriod: "2026-08-01",
        isRemoved: false,
      },
      {
        itemCode: "6103-S",
        markerPeriod: "2026-08-01",
        latestPricedPeriod: null,
        isRemoved: true,
      },
    ]);

    expect(result).toEqual([
      { itemCode: "6103-S", discontinuedFrom: "2026-08-01" },
    ]);
  });

  it("uses the first date when every occurrence is removed", () => {
    const rows = [
      {
        itemCode: "RET-1",
        markerPeriod: "2026-09-01",
        latestPricedPeriod: null,
        isRemoved: true,
      },
      {
        itemCode: "RET-1",
        markerPeriod: "2026-08-01",
        latestPricedPeriod: null,
        isRemoved: true,
      },
    ];

    expect(deriveConfirmedDiscontinuations(rows)).toEqual([
      { itemCode: "RET-1", discontinuedFrom: "2026-08-01" },
    ]);
    expect(deriveConfirmedDiscontinuations(rows)).toEqual(
      deriveConfirmedDiscontinuations(rows),
    );
  });

  it("keeps a reintroduced code live when its last real price follows a marker", () => {
    expect(
      deriveConfirmedDiscontinuations([
        {
          itemCode: "WT-3LH-50",
          markerPeriod: "2024-05-01",
          latestPricedPeriod: "2026-02-01",
          isRemoved: true,
        },
      ]),
    ).toEqual([]);
  });

  it("keeps a genuine final-period removal discontinued", () => {
    expect(
      deriveConfirmedDiscontinuations([
        {
          itemCode: "616-D",
          markerPeriod: "2026-09-01",
          latestPricedPeriod: "2026-03-05",
          isRemoved: true,
        },
      ]),
    ).toEqual([{ itemCode: "616-D", discontinuedFrom: "2026-09-01" }]);
  });

  it("keeps a same-period final price historically available but schedules withdrawal", () => {
    expect(
      deriveConfirmedDiscontinuations([
        {
          itemCode: "616-D",
          markerPeriod: "2026-09-01",
          latestPricedPeriod: "2026-09-01",
          isRemoved: true,
        },
      ]),
    ).toEqual([{ itemCode: "616-D", discontinuedFrom: "2026-09-01" }]);
  });
});