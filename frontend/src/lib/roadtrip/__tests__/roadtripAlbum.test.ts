import { describe, expect, it } from "vitest";

import { albumForRoadtrip, type RoadtripJourneyAlbum } from "../roadtripAlbum";
import type { RoadtripDetail } from "../../../types/roadtrip";

// Synthetic places only (public repository): the naming pairs the photo trip
// builder writes — a pitstop roadtrip `<Trip> · <City>` with album `<City>
// <Year> Road Trip (<Trip>)` (spec 2026-10-11 pitstop §C.11, §6), and a
// stopover roadtrip and album sharing ONE name `<City> <Year> Road Trip`
// (spec 2026-10-11 stopover §1).
const TRIP = "Eastport loop";
const CITY = "Southbridge";
const ROADTRIP = `${TRIP} · ${CITY}`;
const STOPOVER = `${CITY} 2031 Road Trip`;

function album(albumName: string, assetCount = 12): RoadtripJourneyAlbum {
  return {
    id: albumName,
    immichAlbumId: `a-${albumName}`,
    albumName,
    assetCount,
    thumbnailAssetId: null,
    mode: "link",
    sortIdx: 0,
    lastSyncedAt: null,
  };
}

function journey(albums?: RoadtripJourneyAlbum[]): NonNullable<RoadtripDetail["trip"]> {
  return { id: "t1", name: TRIP, immichAlbums: albums };
}

/** sortIdx 0: the journey's own album, first linked — what the cell shows today. */
const TRIP_ALBUM = album(TRIP);

describe("albumForRoadtrip", () => {
  it("picks a pitstop roadtrip's own city album", () => {
    const own = album(`${CITY} 2031 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), ROADTRIP)).toEqual(own);
  });

  it("matches an album naming another year, so a stay across a year boundary still resolves", () => {
    const own = album(`${CITY} 2032 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), ROADTRIP)).toEqual(own);
  });

  it("resolves a stopover roadtrip's album, which shares the roadtrip's own name", () => {
    const stopover = album(STOPOVER);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, stopover]), stopover.albumName)).toEqual(stopover);
  });

  it("resolves a stopover title that carries the day suffix the writer adds on a clash", () => {
    const stopover = album(`${STOPOVER} (4 Feb)`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, stopover]), stopover.albumName)).toEqual(stopover);
  });

  it("keeps the fallback for a stopover whose own album is not linked", () => {
    const pitstopsAlbum = album(`${STOPOVER} (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, pitstopsAlbum]), STOPOVER)).toEqual(TRIP_ALBUM);
  });

  it("keeps the journey's first album for the trip-named roadtrip", () => {
    const own = album(`${CITY} 2031 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), TRIP)).toEqual(TRIP_ALBUM);
  });

  it("keeps the fallback for a roadtrip named by hand", () => {
    const own = album(`${CITY} 2031 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), "Return leg")).toEqual(TRIP_ALBUM);
  });

  it("falls back to the journey's first album when the roadtrip's own is not linked", () => {
    expect(
      albumForRoadtrip(journey([TRIP_ALBUM, album("Kelmore 2031 Road Trip")]), ROADTRIP)
    ).toEqual(TRIP_ALBUM);
  });

  it("does not match a city that merely starts like the roadtrip's own", () => {
    const trap = album(`${CITY}ville 2031 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, trap]), ROADTRIP)).toEqual(TRIP_ALBUM);
  });

  it("does not match an album written for another trip", () => {
    const other = album(`${CITY} 2031 Road Trip (Westshire circuit)`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, other]), ROADTRIP)).toEqual(TRIP_ALBUM);
  });

  it("reads the city's regex punctuation literally", () => {
    const own = album(`Kelmore (West) 2031 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), `${TRIP} · Kelmore (West)`)).toEqual(own);
    const drop = album(`Kelmore West 2031 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, drop]), `${TRIP} · Kelmore (West)`)).toEqual(
      TRIP_ALBUM
    );
  });

  it("reads the trip's regex punctuation literally", () => {
    const trip = "Northvale (loop)";
    const own = album(`Kelmore 2031 Road Trip (${trip})`);
    const drop = album("Kelmore 2031 Road Trip (Northvale loop)");
    const on = { id: "t1", name: trip, immichAlbums: [album(trip), own] };
    expect(albumForRoadtrip(on, `${trip} · Kelmore`)).toEqual(own);
    expect(
      albumForRoadtrip({ ...on, immichAlbums: [album(trip), drop] }, `${trip} · Kelmore`)
    ).toEqual(album(trip));
  });

  it("returns null when the journey links no albums at all", () => {
    expect(albumForRoadtrip(journey([]), ROADTRIP)).toBeNull();
    expect(albumForRoadtrip(journey(), ROADTRIP)).toBeNull();
  });
});
