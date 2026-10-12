import { describe, expect, it } from "vitest";

import { albumForRoadtrip, type RoadtripJourneyAlbum } from "../roadtripAlbum";
import type { RoadtripDetail } from "../../../types/roadtrip";

// Synthetic places only (public repository). The owner ruling of 2026-10-12:
// a trip and its album share ONE name — "<Journey name> · <City>", or the
// journey's own name when the journey holds exactly one trip — so the album
// whose name equals the roadtrip's IS the roadtrip's own. The second pair
// below is the legacy shape stored rows still carry (minted before the
// ruling), which the resolver keeps reading: roadtrip "<Trip> · <City>" was
// written against album "<City> <Year> Road Trip (<Trip>)".
const TRIP = "Eastport loop";
const CITY = "Southbridge";
const ROADTRIP = `${TRIP} · ${CITY}`;
/** LEGACY: the pitstop pair a stored row minted before the 2026-10-12 ruling. */
const LEGACY_PITSTOP = `${CITY} 2031 Road Trip (${TRIP})`;

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

/** sortIdx 0: the journey's own album, first linked. */
const TRIP_ALBUM = album(TRIP);

describe("albumForRoadtrip", () => {
  it("resolves the album a trip and its album share: the one name the naming pass minted", () => {
    const own = album(ROADTRIP);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), ROADTRIP)).toEqual(own);
  });

  it("resolves a trip whose name carries a clash suffix, because the album shares it", () => {
    const own = album(`${ROADTRIP} (6 Jun)`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), `${ROADTRIP} (6 Jun)`)).toEqual(own);
  });

  it("resolves the single-trip case: the trip takes the journey's name, which is the journey's own album", () => {
    const own = album(`${CITY} 2031 Road Trip`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), TRIP)).toEqual(TRIP_ALBUM);
  });

  it("still reads the legacy pitstop pair a stored row carries (minted before the ruling)", () => {
    const own = album(LEGACY_PITSTOP);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), ROADTRIP)).toEqual(own);
  });

  it("matches a legacy album naming another year, so a stay across a year boundary still resolves", () => {
    const own = album(`${CITY} 2032 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), ROADTRIP)).toEqual(own);
  });

  it("keeps the fallback for a trip whose own album is not linked", () => {
    expect(
      albumForRoadtrip(journey([TRIP_ALBUM, album("Kelmore 2031 Road Trip")]), ROADTRIP)
    ).toEqual(TRIP_ALBUM);
  });

  it("keeps the fallback for a roadtrip named by hand", () => {
    const own = album(LEGACY_PITSTOP);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), "Return leg")).toEqual(TRIP_ALBUM);
  });

  it("does not match a legacy city that merely starts like the roadtrip's own", () => {
    const trap = album(`${CITY}ville 2031 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, trap]), ROADTRIP)).toEqual(TRIP_ALBUM);
  });

  it("does not match a legacy album written for another trip", () => {
    const other = album(`${CITY} 2031 Road Trip (Westshire circuit)`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, other]), ROADTRIP)).toEqual(TRIP_ALBUM);
  });

  it("reads the legacy city's regex punctuation literally", () => {
    const own = album(`Kelmore (West) 2031 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, own]), `${TRIP} · Kelmore (West)`)).toEqual(own);
    const drop = album(`Kelmore West 2031 Road Trip (${TRIP})`);
    expect(albumForRoadtrip(journey([TRIP_ALBUM, drop]), `${TRIP} · Kelmore (West)`)).toEqual(
      TRIP_ALBUM
    );
  });

  it("reads the legacy trip's regex punctuation literally", () => {
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
