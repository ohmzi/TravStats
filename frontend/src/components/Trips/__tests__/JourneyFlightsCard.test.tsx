import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import JourneyFlightsCard from "../JourneyFlightsCard";
import type { CardMapLine, CardMapStop } from "../../map/CardMap";
import type { JourneyFlight } from "../../../lib/flights/journeyFigures";

// The card's map is a basemap canvas under an SVG overlay and jsdom has
// neither ResizeObserver nor WebGL, so it is stubbed the way the roadtrip
// card's, the tab's and the logbook journey card's suites stub it. Stubbed as
// a RECORDER, not a blank: once the canvas is gone the props ARE the drawing,
// and what the card hands the map is this suite's whole subject (the owner's
// report: the flight card showed a blank where the map belongs).
const maps = vi.hoisted(() => [] as Array<{ lines: CardMapLine[]; stops: CardMapStop[] }>);
vi.mock("../../map/CardMap", () => ({
  default: ({ lines, stops }: { lines: CardMapLine[]; stops: CardMapStop[] }) => {
    maps.push({ lines, stops });
    return <div data-testid="card-map" />;
  },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

/** A flight as the journey page hands it down — invented airports, like every fixture here. */
function flight(over: Partial<JourneyFlight> = {}): JourneyFlight {
  return {
    depIata: "QQA",
    arrIata: "QQB",
    depLat: 52.31,
    depLon: 4.76,
    arrLat: 55.68,
    arrLon: 12.57,
    departureTime: "2031-09-16T08:00:00.000Z",
    arrivalTime: "2031-09-16T10:30:00.000Z",
    ...over,
  };
}

function renderCard(flights: readonly JourneyFlight[]): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <JourneyFlightsCard tripId="trip-1" flights={flights} />
    </MemoryRouter>
  );
  return container;
}

afterEach(() => {
  cleanup();
  maps.length = 0;
});

/**
 * The journey's flights card, in the Trips tab: the map its roadtrip
 * neighbours carry, drawn from the card's own `flights` prop.
 */
describe("JourneyFlightsCard's map", () => {
  it("draws one great-circle line per flight, leaving and arriving at its airports", () => {
    renderCard([
      flight(),
      flight({
        depIata: "QQB",
        arrIata: "QQC",
        depLat: 55.68,
        depLon: 12.57,
        arrLat: 59.65,
        arrLon: 17.92,
      }),
    ]);

    expect(maps).toHaveLength(1);
    expect(maps[0].lines).toHaveLength(2);
    // The arc starts at the departure and ends at the arrival — a bowed
    // great circle, not a bare chord (the logbook journey card's own arc).
    const [first] = maps[0].lines;
    expect(first.coords.length).toBeGreaterThan(2);
    expect(first.coords[0][0]).toBeCloseTo(4.76, 6);
    expect(first.coords[0][1]).toBeCloseTo(52.31, 6);
    const last = first.coords[first.coords.length - 1];
    expect(last[0]).toBeCloseTo(12.57, 6);
    expect(last[1]).toBeCloseTo(55.68, 6);
  });

  it("meets the arcs on the distinct airports' dots, one per position", () => {
    // Three legs through four airports with the middle one touched twice: the
    // stops are the DISTINCT positions — the roadtrip card's stations rule —
    // so two arcs end on one dot instead of stacking two.
    renderCard([
      flight(),
      flight({
        depIata: "QQB",
        arrIata: "QQC",
        depLat: 55.68,
        depLon: 12.57,
        arrLat: 59.65,
        arrLon: 17.92,
      }),
      flight({
        depIata: "QQA",
        arrIata: "QQC",
        depLat: 52.31,
        depLon: 4.76,
        arrLat: 59.65,
        arrLon: 17.92,
      }),
    ]);

    expect(maps[0].stops.map((s) => s.coord)).toEqual([
      [4.76, 52.31],
      [12.57, 55.68],
      [17.92, 59.65],
    ]);
  });

  it("dashes a leg that has not been flown and draws a flown one solid", () => {
    // "Upcoming" is the flight domain's own `status === "scheduled"`
    // (`routesLayer`, `globeArcData`, `tripMapColors`), drawn as the dash the
    // roadtrip card gives a planned roadtrip and `CardMap` documents for "a
    // planned leg" — the one thing a planned line says that a flown one does not.
    renderCard([
      flight({ status: "scheduled" }),
      flight({ arrIata: "QQC", arrLat: 59.65, arrLon: 17.92, status: "flown" }),
    ]);

    expect(maps[0].lines.map((l) => l.dashed)).toEqual([true, false]);
  });

  it("draws no line and no dot for an endpoint the app stored as the no-coordinate sentinel", () => {
    // An unresolved airport is stored as (0,0), not null (`journeyFigures`
    // `isRealEndpoint`): the fold counts such a leg as unknown and `TripMap`
    // draws no arc for it. Drawing it here would send a line to Null Island.
    renderCard([
      flight({ depLat: 0, depLon: 0 }),
      flight({
        depIata: "QQB",
        arrIata: "QQC",
        depLat: 55.68,
        depLon: 12.57,
        arrLat: 59.65,
        arrLon: 17.92,
      }),
    ]);

    expect(maps[0].lines).toHaveLength(1);
    // The broken leg's REAL end is still a place the journey touched, so its
    // dot stays; only the sentinel end is dropped.
    expect(maps[0].stops.map((s) => s.coord)).toEqual([
      [12.57, 55.68],
      [17.92, 59.65],
    ]);
  });

  it("stays one link to the flight journey's page, the map inside it", () => {
    // The map is furniture INSIDE the card's own link: it must not introduce a
    // second anchor or move the card's target.
    const container = renderCard([flight()]);

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(screen.getByTestId("card-map").closest("a")).toHaveAttribute(
      "href",
      "/flights/journeys/trip-1"
    );
    expect(links[0]).toHaveAttribute("href", "/flights/journeys/trip-1");
  });
});
