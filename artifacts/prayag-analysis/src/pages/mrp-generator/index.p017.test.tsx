import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const previewMutation = {
  isPending: false,
  isError: false,
  isSuccess: true,
  data: {
    summary: { total: 1600, suggested: 300, increases: 300, decreases: 0 },
  },
  mutate: vi.fn(),
};

vi.mock("@workspace/api-client-react", () => ({
  usePreviewMrpGeneratorSimpleScenario: () => previewMutation,
}));

import { ScenarioPreviewSentence } from "./index";

describe("P017 scenario card", () => {
  it("shows the live pre-run estimate and confirms direction", () => {
    render(
      <ScenarioPreviewSentence
        scenario={{
          id: 17,
          policyVersion: 3,
          updatedAt: "2026-09-15T00:00:00Z",
          simplePolicy: { policyVersion: 3 },
          scope: { competitorMapped: true },
        }}
      />,
    );
    expect(screen.getByText("Would evaluate 1600 products; 300 would change. all increases.")).toBeInTheDocument();
    expect(previewMutation.mutate).toHaveBeenCalledOnce();
  });
});