import { buildDraftWith } from "../buildDraft";
import type { ExistingDeps } from "../existingDraft";
import type { ExistingTripState } from "../existingTypes";
import type { ScanInput } from "../types";
import { NORTHVALE, builderDeps, photosAt, preciseFlight, type Place } from "./builderFixtures";

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
      albumName: "Dunholme 2031 Road Trip (Southern loop)",
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
    expect(dto.areas.map((area) => area.mainCity)).toEqual(["Dunholme", "Southhollow"]);
    const [stay, destination] = dto.areas;
    expect(stay.pitstop).toEqual({ albumName: "Dunholme 2031 Road Trip (Southern loop)" });
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
    expect(stay.suggestedName).toBe("Southern loop · Dunholme");
    expect(destination.suggestedName).toBe("Southern loop · Southhollow");
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
    // explains away — but it opens as the ordinary kind, not as a roadtrip.
    expect(dto.areas[0].pitstop).toEqual({ albumName: "Dunholme 2031 Road Trip (Southern loop)" });
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
    expect(dto.areas[0].pitstop).toEqual({ albumName: "Dunholme 2031 Road Trip (Southern loop)" });
  });
});
