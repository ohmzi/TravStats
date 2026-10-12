import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import EntityFigures from "../EntityFigures";
import { roadtripPhase } from "../../../lib/roadtrip/roadtripView";
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

function renderJourney(t: Trip, roadtrips: readonly { drivenKm: number }[] = []) {
  return render(
    <MemoryRouter>
      <EntityFigures level="journey" trip={t} roadtrips={roadtrips} />
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

  it("heads the journey's own span, both ends counted", () => {
    renderJourney(journey({ startDate: "2031-05-02", endDate: "2031-05-07" }));
    expect(screen.getByText("Zeitraum")).toBeInTheDocument();
    expect(screen.getByText("02.05. – 07.05.2031")).toBeInTheDocument();
    expect(screen.getByText("Tage")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
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
