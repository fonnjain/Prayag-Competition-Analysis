/**
 * Integration-style tests confirming that the competitor-period date chip in
 * the dashboard filter bar:
 *   - shows the correct date returned by the overview endpoint
 *   - re-renders with an updated date when the user switches periods
 *   - stays absent when competitorPeriodDate is null
 *
 * All network hooks are mocked so no real HTTP calls are made.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dashboard from "./dashboard";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/replit-auth-web", () => ({
  useAuth: vi.fn(() => ({ user: { firstName: "Test" }, logout: vi.fn() })),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAnalysisFilters: vi.fn(),
  useGetAnalysisPeriods: vi.fn(),
  useGetAnalysisOverview: vi.fn(),
  useGetAnalysisByBrand: vi.fn(),
  useGetAnalysisPositioning: vi.fn(),
  useGetAnalysisByCategory: vi.fn(),
  useGetAnalysisCoverageMatrix: vi.fn(),
  useGetAnalysisOpportunities: vi.fn(),
  getExportAnalysisUrl: vi.fn(() => "/api/analysis/export"),
}));

import {
  useGetAnalysisFilters,
  useGetAnalysisPeriods,
  useGetAnalysisOverview,
  useGetAnalysisByBrand,
  useGetAnalysisPositioning,
  useGetAnalysisByCategory,
  useGetAnalysisCoverageMatrix,
  useGetAnalysisOpportunities,
} from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOOP_LOADING = { data: undefined, isLoading: true, queryKey: [] };
const NOOP_EMPTY = { data: undefined, isLoading: false, queryKey: [] };

function overviewResult(competitorPeriodDate: string | null, prayagMrpDate = "2026-08-18") {
  return {
    data: {
      totalSkus: 10,
      matchedSkus: 8,
      unmatchedSkus: 2,
      coveragePct: 80,
      comparableSkus: 7,
      prayagCheaperCount: 4,
      prayagCostlierCount: 3,
      prayagCheaperPct: 57,
      avgPriceDiffPct: 3.2,
      medianPriceDiffPct: 2.8,
      competitorCount: 2,
      matchQuality: { high: 6, medium: 1, low: 1, none: 0 },
      prayagMrpDate,
      competitorPeriodDate,
    },
    isLoading: false,
    queryKey: [],
  };
}

const PERIODS = ["2026-07-31", "2026-03-31"];

/** Seed all analysis hooks with sensible defaults. Override overview separately per test. */
function setupSideHooks() {
  (useGetAnalysisFilters as Mock).mockReturnValue({
    data: { competitors: ["BrandA", "BrandB"], divisions: [], categories: [], matchConfidences: [], matchStatuses: [] },
    isLoading: false,
  });
  (useGetAnalysisPeriods as Mock).mockReturnValue({
    data: {
      periods: PERIODS,
      defaultPeriod: PERIODS[0],
      isFuturePeriod: Object.fromEntries(PERIODS.map((p) => [p, false])),
    },
    isLoading: false,
  });
  (useGetAnalysisByBrand as Mock).mockReturnValue(NOOP_LOADING);
  (useGetAnalysisPositioning as Mock).mockReturnValue(NOOP_LOADING);
  (useGetAnalysisByCategory as Mock).mockReturnValue(NOOP_LOADING);
  (useGetAnalysisCoverageMatrix as Mock).mockReturnValue(NOOP_LOADING);
  (useGetAnalysisOpportunities as Mock).mockReturnValue(NOOP_EMPTY);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dashboard — competitor period date chip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSideHooks();
  });

  it('shows the chip with the correct date in "Latest (auto)" mode', async () => {
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-07-31"));
    render(<Dashboard />);

    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-07-31/i)).toBeInTheDocument(),
    );
  });

  it("hides the chip when competitorPeriodDate is null (no competitor data for the period)", async () => {
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult(null));
    render(<Dashboard />);

    // Prayag chip confirms the filter bar is fully loaded.
    await waitFor(() =>
      expect(screen.getByText(/Prayag MRP as of/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Competitor prices as of/i)).not.toBeInTheDocument();
  });

  it("updates the chip date when the user switches to an explicit past period", async () => {
    const user = userEvent.setup();

    // Start in Latest (auto) mode — July competitor data.
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-07-31"));
    render(<Dashboard />);

    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-07-31/i)).toBeInTheDocument(),
    );

    // Switching to the March period; overview re-fetch returns an earlier date.
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-03-10"));

    // The period SelectTrigger has data-testid="period-select-trigger".
    const periodTrigger = screen.getByTestId("period-select-trigger");
    await user.click(periodTrigger);
    const marchOption = await screen.findByRole("option", { name: /2026-03-31/i });
    await user.click(marchOption);

    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-03-10/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/2026-07-31/i)).not.toBeInTheDocument();
  });

  it("switches back to the latest date when the user reselects Latest (auto)", async () => {
    const user = userEvent.setup();

    // Start in Latest (auto) with July data, switch to March, then back.
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-07-31"));
    render(<Dashboard />);

    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-07-31/i)).toBeInTheDocument(),
    );

    // ── Switch to March ──
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-03-10"));
    const periodTrigger = screen.getByTestId("period-select-trigger");
    await user.click(periodTrigger);
    await user.click(await screen.findByRole("option", { name: /2026-03-31/i }));

    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-03-10/i)).toBeInTheDocument(),
    );

    // ── Switch back to Latest (auto) ──
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-07-31"));
    await user.click(screen.getByTestId("period-select-trigger"));
    await user.click(await screen.findByRole("option", { name: /latest \(auto\)/i }));

    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-07-31/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/2026-03-10/i)).not.toBeInTheDocument();
  });
});
