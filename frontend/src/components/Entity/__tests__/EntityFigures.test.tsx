import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import EntityFigures from "../EntityFigures";
import { roadtripPhase } from "../../../lib/roadtrip/roadtripView";
import type { JourneyFlight } from "../../../lib/flights/journeyFigures";
import type { Trip } from "../../../types";
import type { LinkedAlbum } from "../../../types/immich";
import type { RoadtripDetail } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

// Synthetic fixtures only (public repository): invented journeys, places and
// album names; no real trip, roadtrip or album name anywhere.

function album(id: string, albumName: string, assetCount: number): LinkedAlbum {
  return {
    id,
    immichAlbumId: `im-${id}`,
    albumName,
    assetCount,
    thumbnailAssetId: null,
    mode: "link",
    sortIdx: 0,
    lastSyncedAt: null,
  };
}

function journey(over: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    name: "Eastport loop",
    countries: [],
    startDate: null,
    endDate: null,
    immichAlbums: [],
    ...over,
  } as unknown as Trip;
}

/**
 * A flight fixture, narrowed to the fields the flights fold reads — an
 * invented pair of airports, like every other fixture here (public repo).
 */
function flight(over: Partial<JourneyFlight> = {}): JourneyFlight {
  return {
    depIata: "QQA",
    arrIata: "QQB",
    depCity: "Eastport",
    arrCity: "Northvale",
    depLat: 52.31,
    depLon: 4.76,
    arrLat: 55.68,
    arrLon: 12.57,
    ...over,
  };
}

/** The roadtrip half, narrowed to the fields the band reads. */
interface RoadtripFixture {
  id?: string;
  name?: string;
  drivenKm?: number;
  distanceKm?: number;
  startOdometerKm?: number | null;
  endOdometerKm?: number | null;
}

type TripFixture = Omit<Partial<RoadtripDetail>, "roadtrip"> & { roadtrip?: RoadtripFixture };

function trip(over: TripFixture = {}): RoadtripDetail {
  return {
    countries: [],
    trip: null,
    startDate: null,
    endDate: null,
    nights: { nights: 1, stayNights: 0, freeNights: 1, placesSlept: 1, nightsKnown: true },
    stations: [],
    legs: [],
    tours: [],
    routingAvailable: true,
    expenses: [],
    costs: {},
    ...over,
    roadtrip: {
      id: "rt-1",
      name: "Northvale loop",
      drivenKm: 0,
      distanceKm: 0,
      startOdometerKm: null,
      endOdometerKm: null,
      ...over.roadtrip,
    },
  } as unknown as RoadtripDetail;
}

function renderJourney(
  t: Trip,
  roadtrips: readonly { drivenKm: number; id?: string }[] = [],
  flights: readonly JourneyFlight[] = []
) {
  return render(
    <MemoryRouter>
      <EntityFigures level="journey" trip={t} roadtrips={roadtrips} flights={flights} />
    </MemoryRouter>
  );
}

function renderTrip(detail: RoadtripDetail, today = "2031-05-03") {
  return render(
    <MemoryRouter>
      <EntityFigures level="trip" detail={detail} today={today} />
    </MemoryRouter>
  );
}

/** The cell whose mono label is `label` — the band draws `dt` then `dd`. */
function cellOf(container: HTMLElement, label: string): HTMLElement {
  const dt = [...container.querySelectorAll("dt")].find((d) => d.textContent === label);
  if (!dt) throw new Error(`the band drew no ${label} cell`);
  return dt.parentElement as HTMLElement;
}

/** The anchor a cell's figure wraps, or null when the cell is not an entry point. */
function cellLink(container: HTMLElement, label: string): HTMLAnchorElement | null {
  return cellOf(container, label).querySelector("a");
}

describe("the journey's figures row (design §2)", () => {
  it("sums the trips' driven km and counts them", () => {
    renderJourney(journey(), [{ drivenKm: 812 }, { drivenKm: 254 }]);
    expect(screen.getByText("Gefahrene km")).toBeInTheDocument();
    expect(screen.getByText("1.066 km")).toBeInTheDocument();
    expect(screen.getByText("Summe aus 2 Trips")).toBeInTheDocument();
    expect(screen.getByText("Trips")).toBeInTheDocument();
  });

  it("draws no km sub for a journey with no trips", () => {
    renderJourney(journey());
    expect(screen.getByText("0 km")).toBeInTheDocument();
    expect(screen.queryByText(/Summe aus/)).not.toBeInTheDocument();
  });

  it("adds the flown km beside the driven km, summed over the journey's flights", () => {
    renderJourney(
      journey(),
      [{ drivenKm: 812 }, { drivenKm: 254 }],
      [
        flight({ routeDistance: 3273, routeSource: "live_tracking" }),
        flight({ routeDistance: 1237, routeSource: "live_tracking" }),
      ]
    );
    expect(screen.getByText("Gefahrene km")).toBeInTheDocument();
    expect(screen.getByText("1.066 km")).toBeInTheDocument();
    expect(screen.getByText("Geflogene km")).toBeInTheDocument();
    // 3.273 + 1.237, measured legs — no marker.
    expect(screen.getByText("4.510 km")).toBeInTheDocument();
  });

  it("marks a derived sum with ~ and a leg without a distance with ≈, reasons on hover", () => {
    renderJourney(
      journey(),
      [],
      [
        flight({ routeDistance: 2000 }),
        // The write path's "no coordinate" sentinel: this leg gives nothing.
        flight({ depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 }),
      ]
    );
    const value = screen.getByText("≈ ~2.000 km");
    expect(value.closest("[title]")).toHaveAttribute(
      "title",
      "Aus der Großkreis-Sehne zwischen den Flughäfen jeder Etappe abgeleitet, nicht aus der geflogenen Strecke — 1 abgeleitet, 0 aufgezeichnet"
    );
  });

  it("dashes the flown cell with its reason when no flight gives a distance", () => {
    renderJourney(journey());
    const dash = screen.getByText("—");
    expect(dash.closest("[title]")).toHaveAttribute(
      "title",
      "Kein Flug dieser Reise hat eine Distanz"
    );
  });

  it("counts the flights as one more trip than the roadtrips alone", () => {
    renderJourney(journey(), [{ drivenKm: 812 }], [flight({ routeDistance: 2000 })]);
    expect(screen.getByText("Trips").parentElement?.textContent).toBe("Trips2");
  });

  it("leaves the Trips cell at the roadtrip count when the journey has no flights", () => {
    renderJourney(journey(), [{ drivenKm: 812 }], []);
    expect(screen.getByText("Trip").parentElement?.textContent).toBe("Trip1");
  });

  it("heads the journey's own span, both ends counted", () => {
    renderJourney(journey({ startDate: "2031-05-02", endDate: "2031-05-07" }));
    expect(screen.getByText("Zeitraum")).toBeInTheDocument();
    expect(screen.getByText("02.05. – 07.05.2031")).toBeInTheDocument();
    expect(screen.getByText("Tage")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("heads a flight-only journey with the span its entries give", () => {
    // The server serves the effective span on `times` (and the DATE anchors
    // beside it) for a journey whose row stores no days — owner 2026-10-13:
    // the flights carry the real dates, so the band must not stand blank.
    renderJourney(
      journey({
        startDate: null,
        endDate: null,
        times: {
          start: { date: "2020-11-20", zone: "America/New_York", precision: "day" },
          end: { date: "2020-11-28", zone: "America/New_York", precision: "day" },
        },
      })
    );
    expect(screen.getByText("Zeitraum")).toBeInTheDocument();
    expect(screen.getByText("20.11. – 28.11.2020")).toBeInTheDocument();
  });

  it("marks the days approximate while an end is not known to its day", () => {
    renderJourney(
      journey({
        startDate: "2031-05-02",
        endDate: "2031-05-07",
        times: {
          start: { date: "2031-05-02", zone: null, precision: "unknown" },
          end: { date: "2031-05-07", zone: null, precision: "day" },
        },
      })
    );
    const approx = screen.getByText("≈ 6");
    expect(approx.closest("[title]")).toHaveAttribute(
      "title",
      "Ein Datum ist nur ungefähr bekannt"
    );
  });

  it("draws no Dates and no Days for an undated journey", () => {
    renderJourney(journey());
    expect(screen.queryByText("Zeitraum")).not.toBeInTheDocument();
    expect(screen.queryByText("Tage")).not.toBeInTheDocument();
  });

  it("counts each country once and counts the linked albums", () => {
    renderJourney(
      journey({
        countries: ["DE", "DE", "FR"],
        immichAlbums: [
          album("l1", "Eastport loop", 12),
          album("l2", "Southbridge", 47),
          album("l3", "Northvale", 9),
        ],
      })
    );
    expect(screen.getByText("Länder")).toBeInTheDocument();
    expect(screen.getByText("DE · FR")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Alben")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("the trip's figures row (design §2)", () => {
  it("reads the trip's own dates, driven km, days, places slept and countries", () => {
    renderTrip(
      trip({
        roadtrip: {
          name: "Northvale loop",
          drivenKm: 812,
          distanceKm: 812,
          startOdometerKm: null,
          endOdometerKm: null,
        },
        countries: ["DE", "FR"],
        startDate: "2031-05-02T00:00:00.000Z",
        endDate: "2031-05-04T00:00:00.000Z",
        nights: { nights: 2, stayNights: 0, freeNights: 2, placesSlept: 2, nightsKnown: true },
      }),
      "2031-05-03"
    );
    expect(screen.getByText("Zeitraum")).toBeInTheDocument();
    expect(screen.getByText("02.05. – 04.05.2031")).toBeInTheDocument();
    expect(screen.getByText("Strecke")).toBeInTheDocument();
    expect(screen.getByText("geplant")).toBeInTheDocument();
    expect(screen.getByText("812 km")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2 Orten")).toBeInTheDocument();
    expect(screen.getByText("DE · FR")).toBeInTheDocument();
  });

  it("spells a cross-year span with the start's year — the card's own string", () => {
    // 28.12.2030 – 03.01.2031 crosses the year boundary: dropping the start's
    // year would read as one year's travel. The list card prints the same
    // span through the same rule (`omitStartYear`), and the two surfaces must
    // spell it identically.
    renderTrip(
      trip({
        startDate: "2030-12-28T00:00:00.000Z",
        endDate: "2031-01-03T00:00:00.000Z",
      }),
      "2031-01-01"
    );
    expect(screen.getByText("28.12.2030 – 03.01.2031")).toBeInTheDocument();
  });

  it("keeps a trip on its LAST day underway — the card's own phase, not a day that ended", () => {
    // `roadtripPhase` says the reader is on the road until the last day is
    // over (`UnderwayCard`: "day 3 of 3"); the band's `over` must read the
    // same rule, or one trip reads "Gefahren" in its band and "unterwegs" on
    // its card on the very day it ends.
    renderTrip(
      trip({
        roadtrip: {
          id: "rt-1",
          name: "Northvale loop",
          drivenKm: 812,
          distanceKm: 812,
          startOdometerKm: null,
          endOdometerKm: null,
        },
        startDate: "2031-05-01T00:00:00.000Z",
        endDate: "2031-05-03T00:00:00.000Z",
      }),
      "2031-05-03"
    );
    expect(
      roadtripPhase("2031-05-01T00:00:00.000Z", "2031-05-03T00:00:00.000Z", "2031-05-03")
    ).toBe("underway");
    expect(screen.getByText("Strecke")).toBeInTheDocument();
    expect(screen.queryByText("Gefahren")).not.toBeInTheDocument();
  });

  it("counts a trip over once its last day has passed", () => {
    renderTrip(
      trip({
        roadtrip: {
          id: "rt-1",
          name: "Northvale loop",
          drivenKm: 812,
          distanceKm: 812,
          startOdometerKm: null,
          endOdometerKm: null,
        },
        startDate: "2031-05-01T00:00:00.000Z",
        endDate: "2031-05-02T00:00:00.000Z",
      }),
      "2031-05-03"
    );
    expect(screen.getByText("Gefahren")).toBeInTheDocument();
    expect(screen.queryByText("Strecke")).not.toBeInTheDocument();
  });

  it("reads an undated trip's Days as the stored nights + 1, marked approximate", () => {
    renderTrip(
      trip({
        nights: { nights: 2, stayNights: 1, freeNights: 1, placesSlept: 2, nightsKnown: false },
      })
    );
    expect(screen.queryByText("Zeitraum")).not.toBeInTheDocument();
    const days = screen.getByText("≈ 3");
    expect(days.closest("[title]")).toHaveAttribute(
      "title",
      "Mindestens eine Station hat kein Abfahrtsdatum."
    );
    // No span to be over, so the distance reads as the planned one.
    expect(screen.getByText("Strecke")).toBeInTheDocument();
  });

  it("offers the journey and the trip's own album, N/A when there is neither", () => {
    renderTrip(trip());
    expect(screen.getAllByText("k.A.")).toHaveLength(2);
  });

  it("shows the trip's own album (albumForRoadtrip) on the trip's OWN gallery", () => {
    renderTrip(
      trip({
        roadtrip: {
          id: "rt-1",
          name: "Eastport loop · Southbridge",
          drivenKm: 812,
          distanceKm: 812,
          startOdometerKm: null,
          endOdometerKm: null,
        },
        trip: {
          id: "t1",
          name: "Eastport loop",
          immichAlbums: [
            album("l1", "Eastport loop", 12),
            // The trip and its album share the one name (owner ruling 2026-10-12).
            album("l2", "Eastport loop · Southbridge", 47),
          ],
        },
      })
    );
    expect(screen.getByRole("link", { name: "Eastport loop" })).toHaveAttribute(
      "href",
      "/trips/t1"
    );
    // The trip's Gallery tab resolves the same album (albumForRoadtrip), so
    // the cell points at the TRIP's gallery — a link to the journey's would
    // show a different album than the cell just named.
    expect(screen.getByRole("link", { name: "Eastport loop · Southbridge" })).toHaveAttribute(
      "href",
      "/roadtrips/rt-1?tab=gallery"
    );
    expect(screen.getByText("47 Fotos")).toBeInTheDocument();
  });

  it("keeps the odometer caption and no longer carries the Re-sync link (design §4)", () => {
    const { container } = renderTrip(
      trip({
        roadtrip: {
          name: "Northvale loop",
          drivenKm: 812,
          distanceKm: 812,
          startOdometerKm: 12480,
          endOdometerKm: 13100,
        },
        trip: { id: "t1", name: "Eastport loop", immichAlbums: [] },
      })
    );
    expect(screen.getByText("Kilometerstand 12.480 → 13.100")).toBeInTheDocument();
    expect(container.querySelector('a[href$="/resync"]')).toBeNull();
  });

  it("keeps the no-routing note as the caption's other fact", () => {
    renderTrip(trip({ routingAvailable: false }));
    expect(
      screen.getByText("Ohne Routing-Anbieter erscheinen neue Etappen als gerade Linien.")
    ).toBeInTheDocument();
  });
});

/**
 * The band as navigation (owner request 2026-10-14): the figures stop being
 * read-only sums and become the page's entry points. Each case asserts the
 * EXACT href, and each "unchanged" case asserts the absence of an anchor — the
 * owner's rule is that a link to nowhere useful is worse than no link.
 */
describe("the journey band's cells are entry points (owner request 2026-10-14)", () => {
  it("links Days to the timeline, Countries to the map, Trips to the trips and Albums to the gallery", () => {
    const { container } = renderJourney(
      journey({
        id: "t1",
        startDate: "2031-05-02",
        endDate: "2031-05-07",
        countries: ["DE"],
        immichAlbums: [album("l1", "Eastport loop", 12)],
      }),
      [{ id: "rt-1", drivenKm: 812 }],
      []
    );
    expect(cellLink(container, "Tage")).toHaveAttribute("href", "/trips/t1?tab=timeline");
    expect(cellLink(container, "Länder")).toHaveAttribute("href", "/trips/t1?tab=map");
    expect(cellLink(container, "Trip")).toHaveAttribute("href", "/trips/t1?tab=trips");
    expect(cellLink(container, "Alben")).toHaveAttribute("href", "/trips/t1?tab=gallery");
  });

  it("links Km flown to the journey's flight-trip page", () => {
    const { container } = renderJourney(
      journey({ id: "t1" }),
      [],
      [flight({ routeDistance: 2000, routeSource: "live_tracking" })]
    );
    expect(cellLink(container, "Geflogene km")).toHaveAttribute("href", "/flights/journeys/t1");
  });

  it("keeps the Dates cell plain text — the owner named no target for it", () => {
    const { container } = renderJourney(
      journey({ id: "t1", startDate: "2031-05-02", endDate: "2031-05-07" })
    );
    expect(cellOf(container, "Zeitraum").querySelector("a")).toBeNull();
  });

  it("keeps the Albums cell a plain count when the journey links no album", () => {
    const { container } = renderJourney(journey({ id: "t1", immichAlbums: [] }));
    expect(cellLink(container, "Alben")).toBeNull();
    expect(cellOf(container, "Alben").textContent).toBe("Alben0");
  });
});

/**
 * Ruling 1 (controller, 2026-10-14): the journey's Km is a SUM over its
 * roadtrips, so there is no single roadtrip page to open. Exactly one roadtrip
 * opens it; two or more open the journey's Trips tab, where they are listed;
 * with NO roadtrip the cell keeps today's plain "0 km" — the Trips tab would
 * have nothing of the journey's own to show, and a link there is a link to
 * nowhere useful.
 */
describe("the journey's km-driven cell (Ruling 1)", () => {
  it("opens the single roadtrip it sums", () => {
    const { container } = renderJourney(journey({ id: "t1" }), [{ id: "rt-7", drivenKm: 812 }]);
    expect(cellLink(container, "Gefahrene km")).toHaveAttribute("href", "/roadtrips/rt-7");
  });

  it("falls back to the journey's Trips tab when the sum spans several roadtrips", () => {
    const { container } = renderJourney(journey({ id: "t1" }), [
      { id: "rt-7", drivenKm: 812 },
      { id: "rt-8", drivenKm: 254 },
    ]);
    expect(cellLink(container, "Gefahrene km")).toHaveAttribute("href", "/trips/t1?tab=trips");
  });

  it("keeps today's plain figure — no anchor — when the journey has no roadtrip", () => {
    const { container } = renderJourney(journey({ id: "t1" }));
    expect(cellLink(container, "Gefahrene km")).toBeNull();
    expect(cellOf(container, "Gefahrene km").textContent).toBe("Gefahrene km0 km");
  });
});

describe("the trip band's cells are entry points (owner request 2026-10-14)", () => {
  it("links Driven and Countries to the map, Days and Places to the timeline", () => {
    const { container } = renderTrip(
      trip({
        roadtrip: {
          id: "rt-9",
          name: "Northvale loop",
          drivenKm: 812,
          distanceKm: 812,
          startOdometerKm: null,
          endOdometerKm: null,
        },
        countries: ["DE", "FR"],
        startDate: "2031-05-02T00:00:00.000Z",
        endDate: "2031-05-04T00:00:00.000Z",
      })
    );
    expect(cellLink(container, "Strecke")).toHaveAttribute("href", "/roadtrips/rt-9?tab=map");
    expect(cellLink(container, "Tage")).toHaveAttribute("href", "/roadtrips/rt-9?tab=timeline");
    expect(cellLink(container, "Geschlafen in")).toHaveAttribute(
      "href",
      "/roadtrips/rt-9?tab=timeline"
    );
    expect(cellLink(container, "Länder")).toHaveAttribute("href", "/roadtrips/rt-9?tab=map");
  });

  it("drives the map link off the finished roadtrip's own word (Gefahren)", () => {
    const { container } = renderTrip(
      trip({
        roadtrip: {
          id: "rt-9",
          name: "Northvale loop",
          drivenKm: 812,
          distanceKm: 812,
          startOdometerKm: null,
          endOdometerKm: null,
        },
        startDate: "2031-05-01T00:00:00.000Z",
        endDate: "2031-05-02T00:00:00.000Z",
      })
    );
    expect(cellLink(container, "Gefahren")).toHaveAttribute("href", "/roadtrips/rt-9?tab=map");
  });

  it("keeps the Dates cell plain text — the owner named no target for it", () => {
    const { container } = renderTrip(
      trip({
        startDate: "2031-05-02T00:00:00.000Z",
        endDate: "2031-05-04T00:00:00.000Z",
      })
    );
    expect(cellOf(container, "Zeitraum").querySelector("a")).toBeNull();
  });
});
