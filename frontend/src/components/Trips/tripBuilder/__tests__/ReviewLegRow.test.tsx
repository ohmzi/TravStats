import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { DraftLeg } from "../../../../types/tripBuilder";
import ReviewLegRow from "../ReviewLegRow";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

const LEG: DraftLeg = {
  fromKey: "a",
  toKey: "b",
  chordKm: 52.6,
  routedKm: 58,
  mode: "road",
  ferryEvidence: null,
};

function renderRow(leg: DraftLeg = LEG, onMode = vi.fn()) {
  render(<ReviewLegRow leg={leg} fromTitle="Northvale" toTitle="Port Carrow" onMode={onMode} />);
  return onMode;
}

describe("ReviewLegRow", () => {
  it("names the two ends and gives the routed distance when the scan had a route", () => {
    renderRow();
    expect(
      screen.getByText('tripBuilder:review.leg.between {"from":"Northvale","to":"Port Carrow"}')
    ).toBeInTheDocument();
    expect(screen.getByText('tripBuilder:review.leg.routed {"km":58}')).toBeInTheDocument();
  });

  it("gives the straight-line distance, and says so, when there is no route", () => {
    renderRow({ ...LEG, routedKm: null });
    expect(screen.getByText('tripBuilder:review.leg.chord {"km":53}')).toBeInTheDocument();
  });

  it("shows the mode chosen, and changes it", () => {
    const onMode = renderRow();
    expect(screen.getByRole("radio", { name: "tripBuilder:review.leg.road" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(screen.getByRole("radio", { name: "tripBuilder:review.leg.ferry" }));
    expect(onMode).toHaveBeenCalledWith("ferry");
  });

  it("says why a leg is, or may be, a ferry", () => {
    renderRow({ ...LEG, mode: "ferry", ferryEvidence: "seaPhotos" });
    expect(screen.getByText("tripBuilder:review.leg.evidence.seaPhotos")).toBeInTheDocument();
  });

  it("draws no chip for a leg with no evidence", () => {
    renderRow();
    expect(screen.queryByText(/review\.leg\.evidence/)).not.toBeInTheDocument();
  });
});
