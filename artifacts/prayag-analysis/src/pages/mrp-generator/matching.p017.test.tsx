import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@workspace/api-client-react", () => ({
  useGetMrpMatchingWorkbench: () => ({
    data: {
      runType: "matching",
      view: "prince_exposure",
      readOnly: true,
      suggestions: false,
      division: null,
      category: null,
      selectedCompetitors: ["Prince"],
      products: [{
        itemCode: "P017-001",
        productName: "UPVC Pipe",
        currentMrp: 100,
        competitors: [{ competitor: "Prince", matched: true, normalizedPrice: 90 }],
        signedPositionPercent: -10,
        position: "below",
      }],
      filteredProducts: [],
      counts: { total: 1 },
      exposure: {
        count: 1,
        categories: [{ label: "UPVC Pipe", count: 1 }],
        description: "The products where Prince is cheaper. Review only — suggests nothing.",
      },
    },
    isLoading: false,
    error: null,
  }),
  getGetMrpMatchingWorkbenchQueryKey: () => [],
  useSaveMrpMatchingSession: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import MrpMatchingWorkbench from "./matching";

describe("P017 Prince exposure view", () => {
  afterEach(() => window.history.pushState({}, "", "/"));

  it("opens read-only and hides every action/save control", () => {
    window.history.pushState({}, "", "/mrp-generator/matching?view=prince_exposure");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MrpMatchingWorkbench />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Where Prince undercuts us" })).toBeInTheDocument();
    expect(screen.getByText("mapped products where Prince is cheaper than Prayag")).toBeInTheDocument();
    expect(screen.getAllByText(/UPVC Pipe/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Save & Review Run")).not.toBeInTheDocument();
    expect(screen.queryByText("Bulk Action (Visible)")).not.toBeInTheDocument();
    expect(screen.queryByText("Action / Draft")).not.toBeInTheDocument();
  });
});