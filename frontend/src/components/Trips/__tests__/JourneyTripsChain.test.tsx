import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RoadtripSummary } from "../../../types/roadtrip";

vi.mock("../../Roadtrips/useTripRoadtrips", () => ({ useTripRoadtrips: vi.fn() }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));
// The count rides the key, so the station figure is visible in the output.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "count" in o ? `${k}:${String(o.count)}` : k,
    i18n: { language: "de" },
  }),
}));

import { useTripRoadtrips } from "../../Roadtrips/useTripRoadtrips";
import JourneyTripsChain from "../JourneyTripsChain";

/** A list-endpoint row, synthetic. Only the fields a chain node prints. */
function summary(over: Partial<RoadtripSummary>): RoadtripSummary {
  return {
    id: "r",
    kind: "roadtrip",
    tripId: "j1",
    tripName: null,
    name: "R",
    mode: "road",
    color: null,
    vehicle: "campervan",
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: null,
    endDate: null,
    distanceKm: 100,
    drivenKm: 90,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 3,
    cityNames: ["Dunholme"],
    driveCount: 2,
    stayNights: 1,
    freeNights: 1,
    nights: 2,
    nightsKnown: true,
    placesSlept: 2,
    trackCount: 0,
    tourCount: 0,
    countries: ["NO"],
    points: [
      [10, 53],
      [6, 62],
    ],
    path: [
      [10, 53],
      [6, 62],
    ],
    ...over,
  };
}

function renderChain(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <JourneyTripsChain tripId="j1" />
    </MemoryRouter>
  );
}

describe("JourneyTripsChain", () => {
  it("draws one node per trip: its city, its days, its km and its stations", () => {
    vi.mocked(useTripRoadtrips).mockReturnValue({
      rows: [
        summary({
          id: "r1",
          name: "Southern loop · Coast run",
          startDate: "2031-05-02T00:00:00.000Z",
          endDate: "2031-05-08T00:00:00.000Z",
          drivenKm: 1370.4,
          stationCount: 10,
        }),
        summary({ id: "r2", name: "Mountain run" }),
      ],
      settled: true,
    });
    renderChain();

    // The title is the trip's CITY (owner ruling 2026-10-12, looking at this
    // chain): the segment after the last " · " of "<Journey> · <City>".
    const coast = screen.getByText("Coast run").closest("a");
    expect(coast).toHaveAttribute("href", "/roadtrips/r1");
    // Days first, the figures band's own fold and copy (`roadtripDays` +
    // `common:summary.cardDays`), then the km and the station count as before.
    expect(coast?.textContent).toContain("7 common:summary.cardDays:7");
    expect(coast?.textContent).toContain("1.370 km");
    expect(coast?.textContent).toContain("roadtrips:stationCount:10");

    // A name the builder did not mint as "<Journey> · <City>" — here the
    // journey's own name, the one-trip case — shows whole.
    const mountain = screen.getByText("Mountain run").closest("a");
    expect(mountain).toHaveAttribute("href", "/roadtrips/r2");
    expect(mountain?.textContent).toContain("common:summary.cardDays");
  });

  it("counts the days the way the figures band does, ≈ and all", () => {
    // An end date is missing: no span to count, so the fold falls back to the
    // stored nights + 1 and keeps the "≈" while those nights are only a lower
    // bound — the trip band's own Days cell, mirrored.
    vi.mocked(useTripRoadtrips).mockReturnValue({
      rows: [
        summary({
          id: "r1",
          name: "Coast run",
          startDate: "2031-05-02T00:00:00.000Z",
          endDate: null,
          nights: 2,
          nightsKnown: false,
        }),
      ],
      settled: true,
    });
    renderChain();

    const node = screen.getByText("Coast run").closest("a");
    expect(node?.textContent).toContain("≈ 3 common:summary.cardDays:3");
    expect(node?.querySelector("[title]")).toHaveAttribute("title", "roadtrips:list.nightsApprox");
  });

  it("dashes an unmeasured trip's km, as its card does — never a zero", () => {
    // Legs are measured when a save creates them, so a trip with fewer than
    // two stations has no distance (RoadtripCard's `stationCount >= 2`): the
    // card prints "—" with the reason on hover, and a node printing "0 km"
    // would claim a measured zero the data cannot have.
    vi.mocked(useTripRoadtrips).mockReturnValue({
      rows: [summary({ id: "r1", name: "Coast run", stationCount: 1, drivenKm: 0 })],
      settled: true,
    });
    renderChain();

    const node = screen.getByText("Coast run").closest("a");
    expect(node?.textContent).not.toContain("0 km");
    expect(node?.textContent).toContain("—");
    expect(node?.querySelector("[title]")).toHaveAttribute("title", "roadtrips:list.kmUnknown");
  });

  it("says the journey holds no trips once the read has settled empty", () => {
    vi.mocked(useTripRoadtrips).mockReturnValue({ rows: [], settled: true });
    renderChain();
    expect(screen.getByText("trips:overview.noTrips")).toBeInTheDocument();
  });

  it("draws nothing until the read settles — a failed or pending read is not an empty journey", () => {
    vi.mocked(useTripRoadtrips).mockReturnValue({ rows: [], settled: false });
    const { container } = renderChain();
    // The sentence would tell the reader to re-sync their trips from Immich,
    // which is false advice while the list is in flight or the request failed.
    expect(screen.queryByText("trips:overview.noTrips")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
