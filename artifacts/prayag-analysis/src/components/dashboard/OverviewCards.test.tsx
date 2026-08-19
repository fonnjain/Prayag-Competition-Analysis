/**
 * Tests that OverviewCards reads competitorPeriodDate from the overview API
 * response and propagates it via the onCompetitorPeriodDate callback.
 */
import { describe, it, expect, vi, type Mock } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { OverviewCards } from "./OverviewCards";

// ---------------------------------------------------------------------------
// Minimal mock for @workspace/api-client-react
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-client-react", () => ({
  useGetAnalysisOverview: vi.fn(),
}));

import { useGetAnalysisOverview } from "@workspace/api-client-react";

// Shared minimal AnalysisOverview shape satisfying the component's destructure.
function makeOverviewData(overrides: Record<string, unknown> = {}) {
  return {
    totalSkus: 100,
    matchedSkus: 80,
    unmatchedSkus: 20,
    coveragePct: 80,
    comparableSkus: 75,
    prayagCheaperCount: 50,
    prayagCostlierCount: 25,
    prayagCheaperPct: 66.7,
    avgPriceDiffPct: 5.3,
    medianPriceDiffPct: 4.1,
    competitorCount: 3,
    matchQuality: { high: 60, medium: 15, low: 5, none: 0 },
    prayagMrpDate: "2026-08-01",
    competitorPeriodDate: null,
    ...overrides,
  };
}

function setupHook(data: ReturnType<typeof makeOverviewData> | null, isLoading = false) {
  (useGetAnalysisOverview as Mock).mockReturnValue({ data, isLoading, queryKey: [] });
}

describe("OverviewCards — competitorPeriodDate callback", () => {
  it("calls onCompetitorPeriodDate with the date returned by the overview API (Latest/auto mode)", async () => {
    setupHook(makeOverviewData({ competitorPeriodDate: "2026-07-15" }));
    const spy = vi.fn();

    render(<OverviewCards filters={{}} onCompetitorPeriodDate={spy} />);

    await waitFor(() => expect(spy).toHaveBeenCalledWith("2026-07-15"));
  });

  it("calls onCompetitorPeriodDate with the date for an explicit past period", async () => {
    setupHook(makeOverviewData({ competitorPeriodDate: "2026-02-28" }));
    const spy = vi.fn();

    render(
      <OverviewCards
        filters={{ effectivePeriod: "2026-02-28" }}
        onCompetitorPeriodDate={spy}
      />,
    );

    await waitFor(() => expect(spy).toHaveBeenCalledWith("2026-02-28"));
  });

  it("calls onCompetitorPeriodDate with null when no competitor data exists for the selected period", async () => {
    setupHook(makeOverviewData({ competitorPeriodDate: null }));
    const spy = vi.fn();

    render(
      <OverviewCards
        filters={{ effectivePeriod: "2025-01-31" }}
        onCompetitorPeriodDate={spy}
      />,
    );

    await waitFor(() => expect(spy).toHaveBeenCalledWith(null));
  });

  it("updates the callback value when the period filter changes", async () => {
    const spy = vi.fn();

    // First render: Latest (auto), competitor data is from July
    setupHook(makeOverviewData({ competitorPeriodDate: "2026-07-15" }));
    const { rerender } = render(<OverviewCards filters={{}} onCompetitorPeriodDate={spy} />);
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith("2026-07-15"));

    // Re-render with an explicit past period; API returns an earlier date.
    setupHook(makeOverviewData({ competitorPeriodDate: "2026-03-10" }));
    rerender(
      <OverviewCards
        filters={{ effectivePeriod: "2026-03-31" }}
        onCompetitorPeriodDate={spy}
      />,
    );
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith("2026-03-10"));
  });

  it("calls the callback with undefined when data is not yet available (loading state)", async () => {
    // When the hook is loading, `data` is undefined.  The effect fires with
    // null so the parent can clear any stale chip date immediately.
    setupHook(null, /* isLoading */ true);
    const spy = vi.fn();

    render(<OverviewCards filters={{}} onCompetitorPeriodDate={spy} />);

    await waitFor(() => expect(spy).toHaveBeenCalledWith(undefined));
  });
});
