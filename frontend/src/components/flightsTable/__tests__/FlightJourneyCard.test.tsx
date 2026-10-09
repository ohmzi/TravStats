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

  it("counts the journey's nights as its SPAN, not the sum of its stays", () => {
    // Out on 1 Oct, home on the 6th: five nights away — the owner's rule
    // (owner, 2026-10-08), the same fold the page band reads.
    renderCard([
      flight({
        id: "f1",
        departureTime: "2026-10-01T06:00:00.000Z",
        arrivalTime: "2026-10-01T09:00:00.000Z",
      }),
      flight({
        id: "f2",
        depIata: "CPH",
        arrIata: "MUC",
        departureTime: "2026-10-06T18:00:00.000Z",
        arrivalTime: "2026-10-06T21:00:00.000Z",
      }),
    ]);
    const caption = screen.getByText("common:summary.cardNights");
    expect(caption.previousElementSibling).toHaveTextContent("5");
  });

  it("ends a one-way at the last arrival", () => {
    renderCard([
      flight({
        id: "f1",
        departureTime: "2026-10-01T06:00:00.000Z",
        arrivalTime: "2026-10-01T09:00:00.000Z",
      }),
      flight({
        id: "f2",
        depIata: "CPH",
        arrIata: "ARN",
        departureTime: "2026-10-03T06:00:00.000Z",
        arrivalTime: "2026-10-03T09:00:00.000Z",
      }),
    ]);
    const caption = screen.getByText("common:summary.cardNights");
    expect(caption.previousElementSibling).toHaveTextContent("2");
  });

  it("is a dash with a reason, never a zero, when no leg is dated", () => {
    renderCard([flight({ departureTime: null, arrivalTime: null })]);
    expect(screen.getByTitle("flights:journeyPage.figNightsNone")).toHaveTextContent("—");
  });

  it("shows exactly three figures — km, nights, cities — and no airports cell", () => {
    const [group] = groupFlightsByJourney([flight()]);
    const { container } = render(
      <MemoryRouter>
        <FlightJourneyCard group={group} locale="en" />
      </MemoryRouter>
    );
    // The airports cell left the journey card (owner, 2026-10-08: "remove number
    // of airports from the card of flight on logbook"); the count lives on the
    // band and the logbook strip. A fourth cell reappearing here would be caught.
    expect(container.querySelectorAll(".grid.grid-cols-3 > *")).toHaveLength(3);
    expect(screen.queryByText("common:summary.airports")).not.toBeInTheDocument();
  });

  it("counts cities — a different figure from airports when two share one city", () => {
    renderCard([
      flight({ id: "f1", depIata: "LHR", arrIata: "JFK", depCity: "London", arrCity: "New York" }),
      flight({ id: "f2", depIata: "LGW", arrIata: "JFK", depCity: "London", arrCity: "New York" }),
    ]);
    // Three airports (LHR, LGW, JFK) but two cities (London, New York) — the
    // figure the page band shows. The airport count is deliberately not on the
    // card, so only the cities cell is asserted here (owner, 2026-10-08).
    expect(screen.getByText("common:summary.cities").previousElementSibling).toHaveTextContent("2");
  });

  it("says on hover when a partial city lookup makes the count a lower bound", () => {
    renderCard([flight({ depCity: "Munich", arrCity: null })]);
    const value = screen.getByTitle("flights:journeyPage.figCitiesSub");
    expect(value).toHaveTextContent("1");
  });
});
