import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RoadtripFigures from "../RoadtripFigures";
import type { RoadtripJourneyAlbum } from "../../../lib/roadtrip/roadtripAlbum";
import type { RoadtripDetail } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

function detail(startDate: string, endDate: string): RoadtripDetail {
  return {
    roadtrip: { drivenKm: 0, distanceKm: 0, startOdometerKm: null, endOdometerKm: null },
    countries: [],
    trip: null,
    startDate,
    endDate,
    nights: { nights: 1, stayNights: 0, freeNights: 1, placesSlept: 1, nightsKnown: true },
    stations: [],
    legs: [],
    tours: [],
    routingAvailable: true,
    expenses: [],
    costs: {},
  } as unknown as RoadtripDetail;
}

/**
 * forgejo#165, the reported case through the figure itself: a planned
 * 10.–11.10.2026 roadtrip read on 02.10.2026 showed "Tage 2 — davon 9 noch
 * vor dir".
 */
describe("RoadtripFigures days figure (forgejo#165)", () => {
  it("puts the whole of a planned roadtrip ahead, never more", () => {
    render(
      <RoadtripFigures
        detail={detail("2026-10-10T00:00:00.000Z", "2026-10-11T00:00:00.000Z")}
        today="2026-10-02"
      />
    );
    expect(screen.getByText("davon 2 noch vor dir")).toBeInTheDocument();
    expect(screen.queryByText("davon 9 noch vor dir")).not.toBeInTheDocument();
  });

  it("counts the days after today while underway", () => {
    render(
      <RoadtripFigures
        detail={detail("2026-10-10T00:00:00.000Z", "2026-10-12T00:00:00.000Z")}
        today="2026-10-10"
      />
    );
    expect(screen.getByText("davon 2 noch vor dir")).toBeInTheDocument();
  });
});

/**
 * forgejo#179: on day 1 of 3, with the only leg still ahead, the figure said
 * "Gefahren 254 km". The number is the planned length of all legs; it may be
 * called driven only once the roadtrip is over.
 */
describe("RoadtripFigures distance figure (forgejo#179)", () => {
  function withKm(start: string, end: string): RoadtripDetail {
    const d = detail(start, end);
    return { ...d, roadtrip: { ...d.roadtrip, drivenKm: 254, distanceKm: 254 } } as RoadtripDetail;
  }

  it("calls the distance planned while the roadtrip is still underway", () => {
    render(
      <RoadtripFigures
        detail={withKm("2026-10-03T00:00:00.000Z", "2026-10-05T00:00:00.000Z")}
        today="2026-10-03"
      />
    );
    expect(screen.queryByText("Gefahren")).not.toBeInTheDocument();
    expect(screen.getByText("Strecke")).toBeInTheDocument();
    expect(screen.getByText("geplant")).toBeInTheDocument();
  });

  it("calls it driven once the roadtrip is over", () => {
    render(
      <RoadtripFigures
        detail={withKm("2026-09-03T00:00:00.000Z", "2026-09-05T00:00:00.000Z")}
        today="2026-10-03"
      />
    );
    expect(screen.getByText("Gefahren")).toBeInTheDocument();
  });
});

/**
 * The album cell (owner-reported on the live app, 2026-10-12): a roadtrip's
 * cell kept showing the journey's first album instead of the roadtrip's own —
 * either the pitstop pair (spec 2026-10-11 pitstop §C.11, §6) or the stopover
 * pair, whose album shares the roadtrip's own one name (spec 2026-10-11
 * stopover §1). Synthetic places only (public repository).
 */
describe("RoadtripFigures album cell", () => {
  const TRIP = "Eastport loop";
  const CITY = "Southbridge";
  const OWN_ALBUM_NAME = `${CITY} 2031 Road Trip (${TRIP})`;

  function album(id: string, albumName: string, assetCount: number): RoadtripJourneyAlbum {
    return { id, albumName, immichAlbumId: `a-${id}`, assetCount };
  }

  /** sortIdx 0: the journey's own album, first linked — what the cell showed. */
  const TRIP_ALBUM = album("l1", TRIP, 12);
  const OWN_ALBUM = album("l2", OWN_ALBUM_NAME, 47);

  function onTrip(roadtripName: string, immichAlbums: RoadtripJourneyAlbum[]): RoadtripDetail {
    const d = detail("2031-05-02T00:00:00.000Z", "2031-05-04T00:00:00.000Z");
    return {
      ...d,
      roadtrip: { ...d.roadtrip, name: roadtripName },
      trip: { id: "t1", name: TRIP, immichAlbums },
    } as unknown as RoadtripDetail;
  }

  function renderBand(d: RoadtripDetail): void {
    render(
      <MemoryRouter>
        <RoadtripFigures detail={d} today="2031-05-03" />
      </MemoryRouter>
    );
  }

  it("shows a pitstop roadtrip's own album and links to the trip's gallery tab", () => {
    renderBand(onTrip(`${TRIP} · ${CITY}`, [TRIP_ALBUM, OWN_ALBUM]));
    expect(screen.getByRole("link", { name: OWN_ALBUM_NAME })).toHaveAttribute(
      "href",
      "/trips/t1?tab=gallery"
    );
    expect(screen.getByText("47 Fotos")).toBeInTheDocument();
  });

  it("shows a stopover roadtrip's own album, which is named like the roadtrip", () => {
    const name = `${CITY} 2031 Road Trip`;
    renderBand(onTrip(name, [TRIP_ALBUM, album("l3", name, 31)]));
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/trips/t1?tab=gallery");
    expect(screen.getByText("31 Fotos")).toBeInTheDocument();
  });

  it("shows the journey's first album for the trip-named roadtrip", () => {
    renderBand(onTrip(TRIP, [TRIP_ALBUM, OWN_ALBUM]));
    expect(screen.queryByRole("link", { name: OWN_ALBUM_NAME })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: TRIP }).map((link) => link.getAttribute("href"))
    ).toContain("/trips/t1?tab=gallery");
  });

  it("falls back to the journey's first album when the roadtrip's own is not linked", () => {
    renderBand(onTrip(`${TRIP} · ${CITY}`, [TRIP_ALBUM]));
    expect(screen.queryByRole("link", { name: OWN_ALBUM_NAME })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: TRIP }).map((link) => link.getAttribute("href"))
    ).toContain("/trips/t1?tab=gallery");
  });

  it("keeps the cell's absent behavior when the journey links no albums", () => {
    renderBand(onTrip(`${TRIP} · ${CITY}`, []));
    expect(screen.getByText("k.A.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Road Trip/ })).not.toBeInTheDocument();
  });
});
