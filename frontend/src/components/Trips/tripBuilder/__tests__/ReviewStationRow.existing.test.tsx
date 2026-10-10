import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { initialReviewState } from "../../../../lib/tripBuilder/draftEdits";
import { existingDraft, KEY } from "../../../../lib/tripBuilder/__tests__/existingFixture";
import { ExistingDiffProvider } from "../ExistingDiffContext";
import ReviewStationRow from "../ReviewStationRow";

vi.mock("../../../../lib/api/tripBuilder", () => ({
  tripBuilderApi: { previewUrl: () => "/thumb" },
}));

function renderRow(stationKey: string, inProvider = true) {
  const draft = existingDraft();
  const station = draft.areas[0].stations.find((s) => s.key === stationKey)!;
  const row = (
    <ReviewStationRow
      station={station}
      draftId={draft.id}
      slept
      canSleep={false}
      canMerge={false}
      canFold={false}
      onEdit={vi.fn()}
    />
  );
  return render(
    inProvider ? (
      <ExistingDiffProvider draft={draft} state={initialReviewState(draft)} onEdit={vi.fn()}>
        {row}
      </ExistingDiffProvider>
    ) : (
      row
    )
  );
}

describe("ReviewStationRow of an existing trip", () => {
  it("says a changed station changed, with what was stored beside what the photos give", () => {
    const { container } = renderRow(KEY.portCarrow);
    expect(screen.getByText("tripBuilder:existing.status.changed")).toBeInTheDocument();
    const diff = container.querySelector("p")?.textContent ?? "";
    expect(diff).toContain("tripBuilder:existing.diff.was");
    expect(diff).toContain("04.05.2031 – 06.05.2031");
    expect(diff).toContain("04.05.2031 – 05.05.2031");
  });

  it("says a new station is new, and shows no before", () => {
    renderRow(KEY.southbridge);
    expect(screen.getByText("tripBuilder:existing.status.new")).toBeInTheDocument();
    expect(screen.queryByText("tripBuilder:existing.diff.was", { exact: false })).toBeNull();
  });

  it("draws nothing for an unchanged station while unchanged rows are collapsed", () => {
    const { container } = renderRow(KEY.northvale);
    expect(container).toBeEmptyDOMElement();
  });

  it("is the plain row of a new trip outside a provider: no pill, no before", () => {
    renderRow(KEY.portCarrow, false);
    expect(screen.getByText("Port Carrow")).toBeInTheDocument();
    expect(screen.queryByText("tripBuilder:existing.status.changed")).toBeNull();
    expect(screen.queryByText("tripBuilder:existing.diff.was", { exact: false })).toBeNull();
  });
});
