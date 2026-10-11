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

  it("starts the toggle on the mode the trip stores, with a changed pill when the scan derived another", () => {
    // Finding N3-1: the trip stores a road leg; the scan's photos derived a ferry.
    // The commit leaves the stored leg alone unless the reviewed mode differs, so
    // the toggle must show the stored mode — not the derivation the commit ignores.
    renderRow({ ...LEG, mode: "road", derivedMode: "ferry", ferryEvidence: "seaPhotos" });
    expect(screen.getByRole("radio", { name: "tripBuilder:review.leg.road" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByText("tripBuilder:existing.status.changed")).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:review.leg.evidence.seaPhotos")).toBeInTheDocument();
  });

  it("draws no changed pill when the scan derived the mode the trip stores", () => {
    renderRow({ ...LEG, mode: "ferry", derivedMode: "ferry", ferryEvidence: "seaPhotos" });
    expect(screen.queryByText("tripBuilder:existing.status.changed")).toBeNull();
  });

  it("draws no changed pill for a leg with no stored mode: a new trip's, or a scan-made pair", () => {
    renderRow();
    expect(screen.queryByText("tripBuilder:existing.status.changed")).toBeNull();
  });
});
