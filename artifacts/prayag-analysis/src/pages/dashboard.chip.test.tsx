/**
 * Integration-style tests confirming that the competitor-period date chip in
 * the dashboard filter bar:
 *   - shows the correct date returned by the overview endpoint
 *   - re-renders with an updated date when the user switches periods
 *   - stays absent when competitorPeriodDate is null
 *
 * All network hooks are mocked so no real HTTP calls are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "./dashboard";

// Hoist mockToastFn so it is in scope inside the vi.mock factory (which is
// also hoisted before imports by Vitest).
const { mockToastFn } = vi.hoisted(() => ({ mockToastFn: vi.fn() }));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/replit-auth-web", () => ({
  useAuth: vi.fn(() => ({ user: { firstName: "Test" }, logout: vi.fn() })),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToastFn }),
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

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

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
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-07-31/i)).toBeInTheDocument(),
    );
  });

  it("hides the chip when competitorPeriodDate is null (no competitor data for the period)", async () => {
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult(null));
    renderDashboard();

    // Prayag revision chip confirms the filter bar is fully loaded.
    await waitFor(() =>
      expect(screen.getByText(/MRP revision as of/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Competitor prices as of/i)).not.toBeInTheDocument();
  });

  it("updates the chip date when the user switches to an explicit past period", async () => {
    const user = userEvent.setup();

    // Start in Latest (auto) mode — July competitor data.
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-07-31"));
    renderDashboard();

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
    renderDashboard();

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

  it("Clear button reverts the chip to the Latest date, resets the period select, and re-calls child hooks without effectivePeriod", async () => {
    const user = userEvent.setup();

    // Helper: return the last args passed to a mocked hook.
    const lastCallArg = (mock: Mock) => mock.mock.calls[mock.mock.calls.length - 1]?.[0];

    // Start in Latest (auto) mode — July competitor data.
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-07-31"));
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-07-31/i)).toBeInTheDocument(),
    );

    // ── Switch to the March period ──
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-03-10"));
    await user.click(screen.getByTestId("period-select-trigger"));
    await user.click(await screen.findByRole("option", { name: /2026-03-31/i }));

    // Chip reflects the March competitor date.
    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-03-10/i)).toBeInTheDocument(),
    );

    // All five child panel hooks must have been re-called with effectivePeriod set to the March period.
    await waitFor(() => {
      expect(lastCallArg(useGetAnalysisByBrand as Mock)).toMatchObject({ effectivePeriod: "2026-03-31" });
      expect(lastCallArg(useGetAnalysisByCategory as Mock)).toMatchObject({ effectivePeriod: "2026-03-31" });
      expect(lastCallArg(useGetAnalysisCoverageMatrix as Mock)).toMatchObject({ effectivePeriod: "2026-03-31" });
      expect(lastCallArg(useGetAnalysisPositioning as Mock)).toMatchObject({ effectivePeriod: "2026-03-31" });
      expect(lastCallArg(useGetAnalysisOpportunities as Mock)).toMatchObject({ effectivePeriod: "2026-03-31" });
    });

    // ── Click the Clear button ──
    // After clearing, the overview hook is called without effectivePeriod, returning July data.
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-07-31"));
    const clearButton = screen.getByRole("button", { name: /clear/i });
    await user.click(clearButton);

    // Chip should revert to the latest date.
    await waitFor(() =>
      expect(screen.getByText(/Competitor prices as of 2026-07-31/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/2026-03-10/i)).not.toBeInTheDocument();

    // Period select should show "Latest (auto)" again.
    const periodTrigger = screen.getByTestId("period-select-trigger");
    expect(periodTrigger).toHaveTextContent(/latest \(auto\)/i);

    // All five child panel hooks must have been re-called WITHOUT effectivePeriod after Clear.
    await waitFor(() => {
      const brandArg = lastCallArg(useGetAnalysisByBrand as Mock);
      const categoryArg = lastCallArg(useGetAnalysisByCategory as Mock);
      const coverageArg = lastCallArg(useGetAnalysisCoverageMatrix as Mock);
      const positioningArg = lastCallArg(useGetAnalysisPositioning as Mock);
      const opportunitiesArg = lastCallArg(useGetAnalysisOpportunities as Mock);
      expect(brandArg?.effectivePeriod).toBeUndefined();
      expect(categoryArg?.effectivePeriod).toBeUndefined();
      expect(coverageArg?.effectivePeriod).toBeUndefined();
      expect(positioningArg?.effectivePeriod).toBeUndefined();
      expect(opportunitiesArg?.effectivePeriod).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Dashboard — export button: zero-row warning and blob download
// ---------------------------------------------------------------------------
//
// Confirms that handleExport():
//   • Shows a destructive toast titled "Export has no data" when the API
//     returns X-Export-Row-Count: 0 — and does NOT initiate a download.
//   • Calls URL.createObjectURL (initiating a blob download) when the API
//     returns a non-zero row count — and does NOT show a warning toast.

describe("Dashboard — export button: zero-row warning and download", () => {
  const origCreateObjectURL = URL.createObjectURL;
  const origRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    setupSideHooks();
    (useGetAnalysisOverview as Mock).mockReturnValue(overviewResult("2026-07-31"));
    mockToastFn.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("shows a 'Export has no data' toast and skips download when X-Export-Row-Count is 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        headers: {
          get: (h: string) => {
            if (h === "x-export-row-count") return "0";
            if (h === "x-export-warning")
              return "No rows matched the requested period or filters; the file contains a header row only.";
            return null;
          },
        },
        blob: vi.fn(),
      }),
    );

    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => screen.getByRole("button", { name: /csv/i }));
    await user.click(screen.getByRole("button", { name: /csv/i }));

    await waitFor(() =>
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Export has no data" }),
      ),
    );
    // Blob download must NOT have been triggered.
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("triggers a blob download and does not show a warning toast when rows are present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        headers: {
          get: (h: string) => {
            if (h === "x-export-row-count") return "12";
            return null;
          },
        },
        blob: vi.fn().mockResolvedValue(new Blob(["Competitor,Price"], { type: "text/csv" })),
      }),
    );

    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => screen.getByRole("button", { name: /csv/i }));
    await user.click(screen.getByRole("button", { name: /csv/i }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    // No warning toast should have been shown.
    expect(mockToastFn).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Export has no data" }),
    );
  });
});
