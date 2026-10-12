import { buildDraftWith } from "../buildDraft";
import type { ExistingDeps } from "../existingDraft";
import type { ExistingTripState } from "../existingTypes";
import type { ScanInput } from "../types";
import {
  NORTHVALE,
  OPEN_WATER_A,
  builderDeps,
  countryAtFixture,
  photosAt,
  preciseFlight,
  type Place,
} from "./builderFixtures";

/**
 * The pitstop the scan marks on a multi-day same-airport stay (spec 2026-10-11
 * pitstops §2): the traveller stays in Dunholme between two flights that share
 * Northvale, while the trip's principal destination keeps the trip's own
 * album. Synthetic places only (public repository).
 */
const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const F1 = "1a1b2c3d-4e5f-4061-8a2b-3c4d5e6f7a8b";
const F2 = "2b2c3d4e-5f60-4172-9b3c-4d5e6f7a8b9c";

/** About 34 km from Northvale: past the 30 km layover radius, so the stay is an area. */
const DUNHOLME: Place = { lat: -44.744, lon: 168.7, city: "Dunholme", state: "Westshire" };
/** The destination after the second flight. */
const SOUTHHOLLOW: Place = { lat: -46.0, lon: 169.5, city: "Southhollow", state: "Southland" };
/** About 60 km inland of Southhollow: the destination's second city, so the destination is a roadtrip and only the stay is a pitstop. */
const DUNMERE: Place = { lat: -45.46, lon: 169.5, city: "Dunmere", state: "Southland" };

const FLIGHT_IN = preciseFlight({
  id: F1,
  label: "ZZ109 KMR→NVL",
  depIata: "KMR",
  arrIata: "NVL",
  dep: { lat: -43.49, lon: 172.53 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-05-02T08:00",
  arrLocal: "2031-05-02T10:05",
});
/** Leaves two days later: different local days, so the stay is a pitstop. */
const FLIGHT_OUT = preciseFlight({
  id: F2,
  label: "ZZ110 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-04T18:00",
  arrLocal: "2031-05-04T20:30",
});
/** Leaves the same evening, a gap of 13h50: outside the layover window, and the same local day. */
const FLIGHT_OUT_SAME_DAY = preciseFlight({
  id: F2,
  label: "ZZ110 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-02T23:55",
  arrLocal: "2031-05-03T02:25",
});

/** The stay's own photos: two days in Dunholme, between the two flights. */
const AT_DUNHOLME = photosAt("dh", DUNHOLME, [
  "2031-05-02T11:00",
  "2031-05-02T13:00",
  "2031-05-03T09:00",
  "2031-05-03T11:00",
  "2031-05-03T15:00",
]);
/** The same-day stay: one day in Dunholme, before the evening flight. */
const AT_DUNHOLME_ONE_DAY = photosAt("dh", DUNHOLME, [
  "2031-05-02T11:00",
  "2031-05-02T13:00",
  "2031-05-02T15:00",
  "2031-05-02T17:00",
]);
/** The principal destination: three nights in Southhollow after the second flight. */
const AT_SOUTHHOLLOW = photosAt("sh", SOUTHHOLLOW, [
  "2031-05-04T22:00",
  "2031-05-05T12:00",
  "2031-05-06T12:00",
]);
const AT_SOUTHHOLLOW_SAME_DAY = photosAt("sh", SOUTHHOLLOW, [
  "2031-05-03T12:00",
  "2031-05-04T12:00",
  "2031-05-05T12:00",
]);
/** The destination's second city: one day inland, after the flight out of the stay. */
const AT_DUNMERE = photosAt("dm", DUNMERE, [
  "2031-05-06T11:00",
  "2031-05-06T13:00",
  "2031-05-06T15:00",
]);

const INPUT: ScanInput = {
  name: "Southern loop",
  startDay: "2031-05-02",
  endDay: "2031-05-07",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

const deps = (
  outbound: typeof FLIGHT_OUT,
  assets: ReturnType<typeof photosAt>,
  over: Partial<Parameters<typeof builderDeps>[1]> = {}
) =>
  builderDeps(assets, {
    loadFlights: async () => [FLIGHT_IN, outbound],
    airports: async () =>
      new Map([
        [
          "NVL",
          { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
        ],
      ]),
    ...over,
  });

const RE_SYNC_TRIP = "3d5c7b91-2a4e-4c8d-9f1b-6e7a8c9d0e1f";
const STORED_ROADTRIP = "r-dunholme";

/** The trip already holds the stay as a roadtrip with its own album (spec §5). */
const RE_SYNC_STATE: ExistingTripState = {
  tripId: RE_SYNC_TRIP,
  tripName: "Southern loop",
  startDay: "2031-05-02",
  endDay: "2031-05-07",
  countries: ["NZ"],
  roadtrips: [
    {
      id: STORED_ROADTRIP,
      name: "Dunholme stay",
      legs: [],
      stations: [
        {
          id: "st-dunholme",
          title: "Dunholme",
          lat: DUNHOLME.lat,
          lon: DUNHOLME.lon,
          startDate: "2031-05-02",
          endDate: "2031-05-03",
          night: "stay",
          lodgingStayId: null,
          placeId: null,
          notes: null,
        },
      ],
    },
  ],
  stops: [],
  flightIds: [],
  albums: [
    {
      linkId: "l-dunholme",
      immichAlbumId: "al-dunholme",
      // The only trip of this journey is the stay's pitstop, so its album
      // carries the journey's own name (owner ruling 2026-10-12: a one-trip
      // journey's trip takes the journey's name) — the name the commit's
      // add-only write resolves by.
      albumName: "Southern loop",
      assetCount: 7,
      ownedByUser: true,
      travstatsMarker: true,
    },
  ],
};

describe("buildDraftWith: a multi-day same-airport stay", () => {
  it("marks the stay a pitstop with its album name, and leaves the destination alone", async () => {
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT, [...AT_DUNHOLME, ...AT_SOUTHHOLLOW, ...AT_DUNMERE]),
      USER,
      INPUT,
      () => undefined
    );
    // The pitstop's city is its shared airport's (owner ruling 2026-10-12):
    // Northvale, not the photos' own Dunholme.
    expect(dto.areas.map((area) => area.mainCity)).toEqual(["Northvale", "Southhollow"]);
    const [stay, destination] = dto.areas;
    // The album takes the roadtrip row's own name — the one naming pass mints
    // both, so the album never carries a second string (owner ruling 2026-10-12).
    expect(stay.pitstop).toEqual({ albumName: "Southern loop · Northvale" });
    // The destination keeps the trip's own album; its own flight pair qualifies
    // for nothing because it is not a pitstop's business (spec §2).
    expect(destination.pitstop).toBeUndefined();
    // The scan carries the pitstop's Roadtrip default (spec §3): the review
    // seed, the commit's `as` and the re-sync's roadtrip match all read this
    // one DTO field, so no layer has to compensate (final review, finding Q1).
    expect(stay.defaultAs).toBe("roadtrip");
    // The pitstop is named over the same roadtrip-naming list as every other
    // roadtrip area, so the review seed equals what `withSuggestedNames`
    // recomputes after an edit — not the bare trip name.
    expect(stay.suggestedName).toBe("Southern loop · Northvale");
    expect(destination.suggestedName).toBe("Southern loop · Southhollow");
  });

  it("names the pitstop's roadtrip row and its album from the shared airport — one city", async () => {
    // The owner-visible rule (ruling 2026-10-12): the row's city after the `·`
    // and the album's City are the same string. `suggestedName` is what the
    // review seeds the committed row from, and `mainCity` is what it re-derives
    // names from after an edit, so both carry the airport's city — the row can
    // never drift from the album.
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT, [...AT_DUNHOLME, ...AT_SOUTHHOLLOW, ...AT_DUNMERE]),
      USER,
      INPUT,
      () => undefined
    );
    const [stay] = dto.areas;
    expect(stay.mainCity).toBe("Northvale");
    expect(stay.suggestedName).toBe("Southern loop · Northvale");
    expect(stay.pitstop?.albumName).toBe(stay.suggestedName);
  });

  it("marks nothing when the two flights fall on one local day", async () => {
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT_SAME_DAY, [...AT_DUNHOLME_ONE_DAY, ...AT_SOUTHHOLLOW_SAME_DAY]),
      USER,
      INPUT,
      () => undefined
    );
    // The same geometry, an ordinary pair of areas: the day rule alone decides.
    expect(dto.areas.map((area) => area.mainCity)).toEqual(["Dunholme", "Southhollow"]);
    expect(dto.areas.every((area) => area.pitstop === undefined)).toBe(true);
  });

  it("carries the roadtripsHidden warning for a pitstop when roadtrips are off in Settings", async () => {
    // For this account the pitstop's kind falls back to the scan's own `stops`
    // (the commit refuses a roadtrip for it), and this warning is what drives
    // the review's disabled switches and says why (spec §3, the S3-1a lesson):
    // every area here is a single-city stop, so only the pitstop clause can
    // carry it.
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT, [...AT_DUNHOLME, ...AT_SOUTHHOLLOW], { roadtripsVisible: false }),
      USER,
      INPUT,
      () => undefined
    );
    expect(dto.warnings.map((w) => w.code)).toContain("roadtripsHidden");
    // The pitstop is still offered — its album switch is what the warning
    // explains away — but it opens as the ordinary kind, not as a roadtrip:
    // no naming pass covers it, so its album keeps the journey's own name (and
    // is never written).
    expect(dto.areas[0].pitstop).toEqual({ albumName: "Southern loop" });
    expect(dto.areas[0].defaultAs).toBe("stops");
  });

  it("matches the stay's stored roadtrip on a re-sync, album status included", async () => {
    // The live case of spec §5: the stay's roadtrip already exists on the trip.
    // The scan's own default makes the area a roadtrip area, so the existing
    // matcher claims the stored roadtrip instead of offering the stay again as
    // a new stop (final review, finding Q1-4).
    const existing: ExistingDeps = {
      state: RE_SYNC_STATE,
      immichUserId: USER,
      client: {
        getAlbumInfo: async () => {
          throw new Error("no album read is part of this scan");
        },
        listAlbumAssets: async () => {
          throw new Error("no album read is part of this scan");
        },
        findOwnedAlbumByName: async () => {
          throw new Error("no album read is part of this scan");
        },
        getMyApiKey: async () => {
          throw new Error("no album read is part of this scan");
        },
      },
    };
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT, [...AT_DUNHOLME, ...AT_SOUTHHOLLOW], {
        targetTrip: {
          id: RE_SYNC_TRIP,
          name: "Southern loop",
          countries: ["NZ"],
          roadtripNames: ["Dunholme stay"],
        },
        existing,
      }),
      USER,
      { ...INPUT, target: { kind: "existing", tripId: RE_SYNC_TRIP } },
      () => undefined
    );
    const [stay] = dto.areas;
    expect(stay.roadtripId).toBe(STORED_ROADTRIP);
    expect(stay.suggestedName).toBe("Dunholme stay");
    expect(stay.pitstop?.stored).toEqual({ albumAssetCount: 7, photoCount: 5 });
  });

  it("shows the album's own set as the pitstop's count, not the stations' sum", async () => {
    // Final review, finding Q3-1: the album takes the area's movement AND at-sea
    // photos (`storedPitstops`' `assetIds`), and the sea photos never become
    // stations. The "now" count the review shows must be that list — the set the
    // album holds or, on the missing-album path, immediately receives — or the
    // counts line disagrees with Immich right after the commit it describes.
    const atSea = photosAt("sea", OPEN_WATER_A, ["2031-05-03T13:00", "2031-05-03T13:30"]);
    const existing: ExistingDeps = {
      state: RE_SYNC_STATE,
      immichUserId: USER,
      client: {
        getAlbumInfo: async () => {
          throw new Error("no album read is part of this scan");
        },
        listAlbumAssets: async () => {
          throw new Error("no album read is part of this scan");
        },
        findOwnedAlbumByName: async () => {
          throw new Error("no album read is part of this scan");
        },
        getMyApiKey: async () => {
          throw new Error("no album read is part of this scan");
        },
      },
    };
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT, [...AT_DUNHOLME, ...atSea, ...AT_SOUTHHOLLOW], {
        countryAt: countryAtFixture,
        targetTrip: {
          id: RE_SYNC_TRIP,
          name: "Southern loop",
          countries: ["NZ"],
          roadtripNames: ["Dunholme stay"],
        },
        existing,
      }),
      USER,
      { ...INPUT, target: { kind: "existing", tripId: RE_SYNC_TRIP } },
      () => undefined
    );
    const [stay] = dto.areas;
    expect(stay.roadtripId).toBe(STORED_ROADTRIP);
    // Five movement photos and two the boundaries put at sea: the album's set.
    expect(stay.pitstop?.stored).toEqual({ albumAssetCount: 7, photoCount: 7 });
  });
});

describe("buildDraftWith: a re-sync whose stay is still a timeline stop", () => {
  /** The same re-sync, but the pre-feature build wrote the stay as the timeline stop (the live case). */
  const STOP_RE_SYNC_STATE: ExistingTripState = {
    ...RE_SYNC_STATE,
    roadtrips: [],
    stops: [
      {
        id: "stop-dunholme",
        title: "Dunholme",
        lat: DUNHOLME.lat,
        lon: DUNHOLME.lon,
        startDay: "2031-05-02",
        endDay: "2031-05-03",
        notes: null,
      },
    ],
    albums: [],
  };

  it("claims the stored stop onto the pitstop area, so the roadtrip can succeed it", async () => {
    // Final review, finding Q2: the trip holds the stay as the stop, not the
    // roadtrip. The pitstop area (scan default: Roadtrip, its album offered)
    // takes that stop onto its anchor — the review can keep it as the stop or
    // convert it, and the commit removes the stop when the roadtrip wins.
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT, [...AT_DUNHOLME, ...AT_SOUTHHOLLOW, ...AT_DUNMERE], {
        targetTrip: {
          id: RE_SYNC_TRIP,
          name: "Southern loop",
          countries: ["NZ"],
          roadtripNames: [],
        },
        existing: {
          state: STOP_RE_SYNC_STATE,
          immichUserId: USER,
          client: {
            getAlbumInfo: async () => {
              throw new Error("no album read is part of this scan");
            },
            listAlbumAssets: async () => {
              throw new Error("no album read is part of this scan");
            },
            findOwnedAlbumByName: async () => {
              throw new Error("no album read is part of this scan");
            },
            getMyApiKey: async () => {
              throw new Error("no album read is part of this scan");
            },
          },
        },
      }),
      USER,
      { ...INPUT, target: { kind: "existing", tripId: RE_SYNC_TRIP } },
      () => undefined
    );
    const [stay] = dto.areas;
    expect(stay.defaultAs).toBe("roadtrip");
    expect(stay.roadtripId).toBeUndefined();
    // The stop the stay was committed as is the area's anchor, not a "not seen" stop.
    expect(stay.stations.some((s) => s.existingId === "stop-dunholme")).toBe(true);
    expect(dto.notSeenStops).toEqual([]);
    // The pitstop's own album is still the offer (spec §3).
    expect(dto.areas[0].pitstop).toEqual({ albumName: "Southern loop · Northvale" });
  });
});

// ─── The naming city stays out of the destination label ──────────────────────

/** Leaves three days later, so the stay's photos can outspan the destination's. */
const LONG_STAY_FLIGHT_OUT = preciseFlight({
  id: F2,
  label: "ZZ110 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-05T18:00",
  arrLocal: "2031-05-05T20:30",
});

/** The stay: a day at each end of it, so its photos span three days but it holds ONE night — the destination holds two. */
const LONG_STAY_AT_DUNHOLME = photosAt("ls", DUNHOLME, [
  "2031-05-02T11:00",
  "2031-05-02T13:00",
  "2031-05-05T09:00",
]);
/** The destination's two cities, the two nights after the second flight. */
const LONG_STAY_AT_SOUTHHOLLOW = photosAt("sh", SOUTHHOLLOW, [
  "2031-05-05T23:00",
  "2031-05-06T12:00",
]);
const LONG_STAY_AT_DUNMERE = photosAt("dm", DUNMERE, ["2031-05-06T15:00", "2031-05-06T17:00"]);

describe("buildDraftWith: the longest area is the pitstop", () => {
  it("keeps the destination label the photo-majority city while the row and album take the airport's", async () => {
    // Review of 1cee95ab9, finding 1: the airport city is the row's and the
    // album's (owner ruling 2026-10-12), and it stays out of the journey's
    // destination label — `destinationLabel` is the longest area's own
    // photo-majority main city (`draftLabels`, `mainCityOf`), never the city
    // the pitstop's name borrowed from its airport.
    const { dto } = await buildDraftWith(
      deps(
        LONG_STAY_FLIGHT_OUT,
        [...LONG_STAY_AT_DUNHOLME, ...LONG_STAY_AT_SOUTHHOLLOW, ...LONG_STAY_AT_DUNMERE],
        {}
      ),
      USER,
      INPUT,
      () => undefined
    );
    const [stay, destination] = dto.areas;
    // The stay outspans the destination, so it is the label's own area — and
    // the label is Dunholme, where its photos are, not Northvale (its airport).
    expect(stay.pitstop).toEqual({ albumName: "Southern loop · Northvale" });
    expect(stay.mainCity).toBe("Northvale");
    expect(dto.destinationLabel).toBe("Dunholme");
    // The destination still names itself from its own photos.
    expect(destination.suggestedName).toMatch(/^Southern loop · /);
  });
});
