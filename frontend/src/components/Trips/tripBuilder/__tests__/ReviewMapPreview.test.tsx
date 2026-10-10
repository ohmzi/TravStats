import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { applyEdit, initialReviewState } from "../../../../lib/tripBuilder/draftEdits";
import { reviewDraft } from "../../../../lib/tripBuilder/__tests__/reviewFixtures";
import ReviewMapPreview from "../ReviewMapPreview";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../TripMap", () => ({
  default: (props: {
    trip: { stops: unknown[]; emptyKey: string };
    tourGeometries: Array<{ geometry: { features: unknown[] } }>;
  }) => (
    <div
      data-testid="map"
      data-stops={props.trip.stops.length}
      data-legs={props.tourGeometries[0].geometry.features.length}
      data-empty={props.trip.emptyKey}
    />
  ),
}));

const draft = reviewDraft();

describe("ReviewMapPreview", () => {
  it("draws a marker for each station and a line for each leg once the map has loaded", async () => {
    render(<ReviewMapPreview state={initialReviewState(draft)} />);
    const map = await screen.findByTestId("map");
    expect(map).toHaveAttribute("data-stops", "6");
    expect(map).toHaveAttribute("data-legs", "4");
    expect(map).toHaveAttribute("data-empty", "tripBuilder:review.map.empty");
  });

  it("follows the edits: a deleted station leaves the map", async () => {
    const state = applyEdit(draft, initialReviewState(draft), {
      type: "delete",
      stationKey: "-904|3388|2031-05-06",
    });
    render(<ReviewMapPreview state={state} />);
    const map = await screen.findByTestId("map");
    expect(map).toHaveAttribute("data-stops", "5");
    expect(map).toHaveAttribute("data-legs", "3");
  });

  it("draws nothing when no area is to be saved", () => {
    let state = initialReviewState(draft);
    for (const area of draft.areas) {
      state = applyEdit(draft, state, { type: "setAreaKind", areaKey: area.key, as: "skip" });
    }
    const { container } = render(<ReviewMapPreview state={state} />);
    expect(container).toBeEmptyDOMElement();
  });
});
