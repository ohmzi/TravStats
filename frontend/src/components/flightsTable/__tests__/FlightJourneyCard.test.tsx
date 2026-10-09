import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import FlightJourneyCard from "../FlightJourneyCard";
import { groupFlightsByJourney } from "../FlightJourneyGrid";
import type { Flight } from "../../../types";

// The card's map is a deck.gl canvas and jsdom has no ResizeObserver, so it is
// stubbed the way the page suites stub their maps. Its own suite covers drawing.
vi.mock("../../map/CardMap", () => ({ default: () => <div data-testid="card-map" /> }));

/** One leg, with only the fields the grouping and the card read. */
function flight(over: Record<string, unknown> = {}): Flight {
  return {
    id: "f1",
    flightNumber: "LH2462",
    airline: "Lufthansa",
    depIata: "MUC",
    arrIata: "CPH",
    depLat: 48.35,
    depLon: 11.79,
    arrLat: 55.62,
    arrLon: 12.65,
    routeDistance: 850,
    tripId: "t1",
    trip: { id: "t1", name: "Baltic 2026", color: null },
    ...over,
  } as unknown as Flight;
}

function renderCard(flights: Flight[]): void {
  const [group] = groupFlightsByJourney(flights);
  render(
    <MemoryRouter>
      <FlightJourneyCard group={group} locale="en" />
    </MemoryRouter>
  );
}

afterEach(cleanup);

/**
 * The feature's entry point: tapping a journey card must open the journey's OWN
 * page. A revert to the old `/flights?view=table&trip=…` — undoing the whole
 * page — would otherwise pass CI, which only exercised the page and the fold.
 */
describe("groupFlightsByJourney", () => {
  it("points a journey's card at the journey's own page", () => {
    const groups = groupFlightsByJourney([flight()]);
    expect(groups[0].href).toBe("/flights/journeys/t1");
  });

  it("leaves an untripped flight pointing at the flight itself", () => {
    const groups = groupFlightsByJourney([flight({ tripId: null, trip: undefined })]);
    expect(groups[0].href).toBe("/flights/f1");
  });
});

describe("FlightJourneyCard", () => {
  it("marks a derived distance with the estimate sign, never a bare number", () => {
    renderCard([flight()]);
    // 850 km, derived: the cell's title is the great-circle reason and the value
    // carries the `~` the band uses for the same sum.
    const value = screen.getByTitle("flights:journeyPage.figDistanceSub");
    expect(value).toHaveTextContent("~850");
  });

  it("marks a derived AND partial sum with both signs, the rule the band shares", () => {
    renderCard([
      flight({ id: "f1", routeDistance: 850 }),
      // An unresolved endpoint is the app's (0,0) sentinel, so this leg gives no
      // distance — the sum is a lower bound as well as derived.
      flight({ id: "f2", routeDistance: null, depLat: 0, depLon: 0 }),
    ]);
    expect(screen.getByText("≈ ~850")).toBeInTheDocument();
  });

  it("counts airports by IATA, the same rule the page band uses", () => {
    renderCard([
      flight({ id: "f1" }),
      // A leg known only by its ICAO code is NOT a distinct IATA airport on the
      // band, so the card must not count it either.
      flight({ id: "f2", depIata: null, depIcao: "EDDM" }),
    ]);
    const caption = screen.getByText("flights:journeyCard.airports");
    expect(caption.previousElementSibling).toHaveTextContent("2");
  });
});
