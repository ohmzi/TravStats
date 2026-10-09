import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RoadtripCard from "../RoadtripCard";
import type { RoadtripSummary } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

// The card's map is a deck.gl canvas and jsdom has no ResizeObserver, so it is
// stubbed the way `FlightJourneyCard.test` stubs it. Its own suite covers the
// drawing; without this the whole file dies in `CardMap` before a figure is
// asserted, so the three-cell row below would never actually run.
vi.mock("../../map/CardMap", () => ({ default: () => <div data-testid="card-map" /> }));

function summary(over: Partial<RoadtripSummary>): RoadtripSummary {
  return {
    id: "rt-1",
    kind: "roadtrip",
    tripId: null,
    tripName: null,
    name: "QA Roadtrip",
    mode: "car",
    color: null,
    vehicle: null,
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: "2026-10-03T00:00:00.000Z",
    endDate: "2026-10-05T00:00:00.000Z",
    distanceKm: 254,
    drivenKm: 254,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 1,
    cityNames: ["Oslo"],
    trackCount: 0,
    tourCount: 1,
    countries: [],
    points: [],
    nights: 1,
    stayNights: 1,
    freeNights: 0,
    placesSlept: 1,
    nightsKnown: true,
    ...over,
  } as RoadtripSummary;
}

/** forgejo#160, the roadtrip card: "1 Nacht", "1 Stadt". */
describe("RoadtripCard figures in the singular (forgejo#160)", () => {
  it("names one of each in the singular", () => {
    render(
      <MemoryRouter>
        <RoadtripCard roadtrip={summary({})} phase="underway" />
      </MemoryRouter>
    );
    expect(screen.getByText("Nacht")).toBeInTheDocument();
    expect(screen.getByText("Stadt")).toBeInTheDocument();
  });

  it("keeps the plural for more than one", () => {
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({ nights: 3, cityNames: ["Oslo", "Bergen"] })}
          phase="underway"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Nächte")).toBeInTheDocument();
    expect(screen.getByText("Städte")).toBeInTheDocument();
  });

  it("counts the distinct station titles as its cities, not the station count", () => {
    // The station count is 1; the card must read the CITIES field instead
    // (owner, 2026-10-08), or a strip and a card could disagree.
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({ stationCount: 1, cityNames: ["Oslo", "Bergen", "Tromsø"] })}
          phase="underway"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Städte").previousElementSibling).toHaveTextContent("3");
  });

  it("shows exactly three figures — km, nights, cities — and no stations or tours cell", () => {
    const { container } = render(
      <MemoryRouter>
        <RoadtripCard roadtrip={summary({ stationCount: 1 })} phase="underway" />
      </MemoryRouter>
    );
    // The stations cell collapsed into CITIES and the tours cell left the card
    // (owner, 2026-10-08); a fourth cell reappearing would be caught here, and
    // the German stations noun proves the collapsed cell is really gone.
    expect(container.querySelectorAll(".grid.grid-cols-3 > *")).toHaveLength(3);
    expect(screen.queryByText("Station")).not.toBeInTheDocument();
  });
});
