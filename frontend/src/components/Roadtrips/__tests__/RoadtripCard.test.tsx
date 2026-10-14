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

const at = (day: string) => `${day}T00:00:00.000Z`;

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

/** forgejo#160, the roadtrip card: "1 Tag", "1 Stadt" — days since 2026-10-11. */
describe("RoadtripCard figures in the singular (forgejo#160)", () => {
  it("names one of each in the singular", () => {
    // A same-day roadtrip: zero nights, and one day on its stored dates.
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({ nights: 0, endDate: at("2026-10-03") })}
          phase="underway"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Tag")).toBeInTheDocument();
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
    expect(screen.getByText("Tage")).toBeInTheDocument();
    expect(screen.getByText("Städte")).toBeInTheDocument();
  });

  it("spells a cross-year span with the start's year — the figures band's own string", () => {
    // 28.12.2030 – 03.01.2031 crosses the year boundary. Dropping the start's
    // year here would read as one year's travel ("28.12. – 03.01.2031"); the
    // band drops it only when both ends share a year, and both surfaces must
    // spell the span identically (`omitStartYear`).
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({ startDate: at("2030-12-28"), endDate: at("2031-01-03") })}
          phase="underway"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("28.12.2030 – 03.01.2031")).toBeInTheDocument();
  });

  it("counts the days from the two stored dates — five nights away is six days", () => {
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({ startDate: at("2031-05-01"), endDate: at("2031-05-06"), nights: 5 })}
          phase="underway"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Tage").previousElementSibling).toHaveTextContent("6");
  });

  it("heads the stored date span where the counted nights fall short of it — the page band's own figure", () => {
    // Twelve days between the two stored dates with only eight nights counted
    // at the stations (a cancelled stay counts nowhere, a half-dated free
    // station counts one night). The card must print the DATES' span — the
    // same `spanDays` the roadtrip's figures band prints — or the card and its
    // own page would put two counts under the one word.
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({
            startDate: at("2031-05-01"),
            endDate: at("2031-05-12"),
            nights: 8,
            nightsKnown: true,
          })}
          phase="underway"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Tage").previousElementSibling).toHaveTextContent(/^12$/);
  });

  it("drops the ≈ once the stored dates give the span — the count is exact, not a lower bound", () => {
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({
            startDate: at("2031-05-01"),
            endDate: at("2031-05-12"),
            nights: 8,
            nightsKnown: false,
          })}
          phase="underway"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Tage").previousElementSibling).toHaveTextContent(/^12$/);
    expect(screen.queryByTitle("Mindestens eine Station hat kein Abfahrtsdatum.")).toBeNull();
  });

  it("carries the approximation marker when a date is missing and the nights are a lower bound", () => {
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({ endDate: null, nights: 5, nightsKnown: false })}
          phase="underway"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("≈ 6")).toBeInTheDocument();
    expect(
      screen.getByTitle("Mindestens eine Station hat kein Abfahrtsdatum.")
    ).toBeInTheDocument();
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

  it("shows exactly three figures — km, days, cities — and no stations or tours cell", () => {
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

/** forgejo#249: a dash or "≈" says why on the card, not only on hover. */
describe("RoadtripCard — reasons without hover (forgejo#249)", () => {
  it("says why the distance is a dash and the nights a lower bound", () => {
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({ stationCount: 1, nightsKnown: false })}
          phase="underway"
        />
      </MemoryRouter>
    );
    const reasons = screen.getByTestId("roadtrip-card-reasons");
    expect(reasons).toHaveTextContent("Noch keine Etappe");
    expect(reasons).toHaveTextContent("Mindestens eine Station hat kein Abfahrtsdatum.");
  });

  it("says nothing extra when every figure is known", () => {
    render(
      <MemoryRouter>
        <RoadtripCard roadtrip={summary({ stationCount: 3 })} phase="past" />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("roadtrip-card-reasons")).not.toBeInTheDocument();
  });
});
