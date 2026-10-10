import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RoadtripFigures from "../RoadtripFigures";
import type { RoadtripDetail } from "../../../types/roadtrip";

// Synthetic roadtrip (public repository).
function detail(trip: { id: string; name: string } | null): RoadtripDetail {
  return {
    roadtrip: { drivenKm: 0, distanceKm: 0, startOdometerKm: null, endOdometerKm: null },
    countries: [],
    trip,
    startDate: "2031-05-02T00:00:00.000Z",
    endDate: "2031-05-04T00:00:00.000Z",
    nights: { nights: 2, stayNights: 0, freeNights: 2, placesSlept: 2, nightsKnown: true },
    stations: [],
    legs: [],
    tours: [],
    routingAvailable: true,
    expenses: [],
    costs: {},
  } as unknown as RoadtripDetail;
}

describe("RoadtripFigures re-sync link", () => {
  it("links to the re-sync of the trip the roadtrip is filed on", () => {
    render(
      <MemoryRouter>
        <RoadtripFigures detail={detail({ id: "t1", name: "Northvale loop" })} today="2031-05-03" />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "tripBuilder:resync.action" })).toHaveAttribute(
      "href",
      "/trips/t1/resync"
    );
  });

  it("offers nothing for a roadtrip that is on no trip", () => {
    render(
      <MemoryRouter>
        <RoadtripFigures detail={detail(null)} today="2031-05-03" />
      </MemoryRouter>
    );
    expect(
      screen.queryByRole("link", { name: "tripBuilder:resync.action" })
    ).not.toBeInTheDocument();
  });
});
