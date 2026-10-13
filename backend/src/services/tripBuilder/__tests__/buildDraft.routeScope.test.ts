/**
 * The route-scoped scan (owner request 2026-10-12): the trip edit page's
 * Re-sync scans the trip's own window and the draft offers exactly one update —
 * that stored roadtrip, under its stored name, with its own album, and nothing
 * else of the journey.
 */
import { NIGHT_SPECIALS, validateNightPlan } from "../../../shared/tour/builderNightPlan";
import { buildDraftWith } from "../buildDraft";
import type { ExistingDeps } from "../existingDraft";
import type { ExistingTripState } from "../existingTypes";
import type { ScanInput } from "../types";
import {
  ME,
  NORTHVALE,
  PORT_CARROW,
  SELBY_BAY,
  builderDeps,
  countryAtFixture,
  photosAt,
  preciseFlight,
  type Place,
} from "./builderFixtures";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const TRIP = "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01";
const ROUTE = "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e";
const OTHER_ROUTE = "c5d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";
const F1 = "f1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";

const EASTPORT: Place = { lat: -38.0, lon: 177.0, city: "Eastport", state: "Eastshire" };
const FENWICK: Place = { lat: -37.7, lon: 176.25, city: "Fenwick", state: "Eastshire" };
/** A place the stored trip holds a station for and the photos never visit. */
const CROWMOOR: Place = { lat: -43.4, lon: 171.2, city: "Crowmoor" };
/** A place whose photos carry no Immich city, so the scan can only title it by coordinates. */
const RIDGE: Place = { lat: -41.2, lon: 174.9 };
const ZPC = { lat: -44.72, lon: 169.17 };
const ZEP = { lat: -38.02, lon: 177.01 };

const FLIGHT = preciseFlight({
  id: F1,
  label: "ZZ101 ZPC→ZEP",
  depIata: "ZPC",
  arrIata: "ZEP",
  dep: ZPC,
  arr: ZEP,
  depLocal: "2031-05-04T18:00",
  arrLocal: "2031-05-04T19:45",
});

const AREA_A = [
  ...photosAt("nv", NORTHVALE, [
    "2031-05-02T10:00",
    "2031-05-02T14:00",
    "2031-05-02T19:00",
    "2031-05-03T09:00",
    "2031-05-03T12:00",
    "2031-05-03T19:00",
  ]),
  ...photosAt("pc", PORT_CARROW, ["2031-05-04T10:00", "2031-05-04T13:00", "2031-05-04T15:00"]),
];
const AREA_B = [
  ...photosAt("ep", EASTPORT, ["2031-05-05T09:00", "2031-05-05T15:00", "2031-05-05T21:00"]),
  ...photosAt("fw", FENWICK, ["2031-05-06T10:00", "2031-05-06T12:00", "2031-05-06T15:00"]),
];

const station = (
  id: string,
  title: string,
  at: Place,
  startDate: string,
  endDate: string,
  night: ExistingTripState["roadtrips"][number]["stations"][number]["night"] = "free"
): ExistingTripState["roadtrips"][number]["stations"][number] => ({
  id,
  title,
  lat: at.lat,
  lon: at.lon,
  startDate,
  endDate,
  night,
  lodgingStayId: null,
  placeId: null,
  notes: null,
});

/** Two roadtrips: the target and one whose airport stay lies outside this window. */
const STATE: ExistingTripState = {
  tripId: TRIP,
  tripName: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-20",
  countries: ["NZ"],
  roadtrips: [
    {
      id: ROUTE,
      name: "Northvale loop", // as the owner renamed it; the scan must keep it, never re-mint it
      legs: [],
      stations: [
        station("st-a", "Northvale Lodge", NORTHVALE, "2031-05-02", "2031-05-04"),
        station("st-c", "Kelmore", { lat: -45.42, lon: 168.52 }, "2031-05-03", "2031-05-04"),
      ],
    },
    {
      id: OTHER_ROUTE,
      name: "Selby Bay stay",
      legs: [],
      stations: [
        station("st-s", "Selby Bay", { lat: -44.2, lon: 169.95 }, "2031-05-15", "2031-05-18"),
      ],
    },
  ],
  stops: [],
  flightIds: [],
  // The trip's own album — the name the row carries, which the album is matched by.
  albums: [
    {
      linkId: "l1",
      immichAlbumId: "al-1",
      albumName: "Northvale loop",
      assetCount: 2,
      ownedByUser: true,
      travstatsMarker: true,
    },
  ],
};

const member = (id: string, fileCreatedAt: string) => ({
  id,
  type: "IMAGE" as const,
  fileCreatedAt,
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: null,
  lat: null,
  lon: null,
});

const existing: ExistingDeps = {
  state: STATE,
  immichUserId: ME,
  client: {
    getAlbumInfo: async (id) => ({
      id,
      albumName: "Northvale loop",
      description: "TravStats trip · 2031-05-02 – 2031-05-04",
      ownerId: ME,
      assetCount: 2,
      thumbnailAssetId: null,
    }),
    listAlbumAssets: async () => [
      member("nv-1", "2031-05-01T22:00:00.000Z"),
      member("old-1", "2031-04-01T22:00:00.000Z"),
    ],
    findOwnedAlbumByName: async () => null,
    getMyApiKey: async () => ({ permissions: ["albumAsset.delete"] }),
  },
};

const GATE = { allowed: true, missingScopes: [] as string[] };

function deps(
  photos: Parameters<typeof builderDeps>[0],
  flights = false,
  state: ExistingTripState = STATE
) {
  return builderDeps(photos, {
    loadFlights: async () => (flights ? [FLIGHT] : []),
    countryAt: countryAtFixture,
    targetTrip: {
      id: TRIP,
      name: "Northvale loop",
      countries: ["NZ"],
      roadtripNames: ["Northvale loop", "Selby Bay stay"],
    },
    existing: { ...existing, state },
    album: { gate: GATE, findOwned: async () => null, linkedTripName: async () => null },
  });
}

const INPUT: ScanInput = {
  name: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-04",
  inspect: true,
  createAlbum: true,
  target: { kind: "existing", tripId: TRIP, routeId: ROUTE },
};

describe("buildDraftWith for a route-scoped re-sync", () => {
  it("offers the one stored roadtrip, under its own name, and nothing else of the journey", async () => {
    const draft = await buildDraftWith(deps(AREA_A), USER, INPUT, () => undefined);

    expect(draft.dto.target).toEqual({
      kind: "existing",
      tripId: TRIP,
      tripName: "Northvale loop",
      routeId: ROUTE,
      routeName: "Northvale loop",
    });
    expect(draft.dto.areas).toHaveLength(1);
    const [area] = draft.dto.areas;
    expect(area.roadtripId).toBe(ROUTE);
    expect(area.defaultAs).toBe("roadtrip");
    expect(area.suggestedName).toBe("Northvale loop");
    expect(area.stations.map((s) => [s.title, s.status, s.existingId])).toEqual([
      ["Northvale Lodge", "same", "st-a"],
      ["Port Carrow", "new", undefined],
    ]);
    expect(area.notSeen?.map((s) => s.title)).toEqual(["Kelmore"]);
    // The journey's timeline stops and the stopover machinery are not offered.
    expect(draft.dto.notSeenStops).toBeUndefined();
    expect(draft.dto.stopovers).toEqual([]);
    expect(area.pitstop).toBeUndefined();
    // Only the target roadtrip is held as an offer; the other row is not the commit's to touch.
    expect([...(draft.existing?.roadtrips.keys() ?? [])]).toEqual([ROUTE]);
    expect([...(draft.existing?.stops.matchedIds ?? [])]).toEqual([]);
    expect([...(draft.existing?.stops.notSeenIds ?? [])]).toEqual([]);
  });

  it("keeps the stored name even when the scan was asked under another one (the row is never re-minted)", async () => {
    const draft = await buildDraftWith(
      deps(AREA_A),
      USER,
      { ...INPUT, name: "Karachi dawn" },
      () => undefined
    );

    expect(draft.dto.areas[0].suggestedName).toBe("Northvale loop");
  });

  it("merges the areas of the window into the one trip, in travel order", async () => {
    const draft = await buildDraftWith(
      deps([...AREA_A, ...AREA_B], true),
      USER,
      { ...INPUT, endDay: "2031-05-06" },
      () => undefined
    );

    expect(draft.dto.areas).toHaveLength(1);
    const [area] = draft.dto.areas;
    expect(area.roadtripId).toBe(ROUTE);
    expect(area.stations.map((s) => s.title)).toEqual([
      "Northvale Lodge",
      "Port Carrow",
      "Eastport",
      "Fenwick",
    ]);
    expect(area.legs).toHaveLength(3);
    expect(draft.dto.stopovers).toEqual([]);
  });

  it("leaves out the photos that stand on another trip, before their stop is derived, and says so", async () => {
    // The owner's shape (2026-10-12, live failure), now caught one level down:
    // the trip-scoped window's last day also picks up photos that belong to
    // ANOTHER trip of the journey — the 11-30 Dubai arrival photos against the
    // Dubai trip's own stored stop — and their stop would be refused as a
    // whole. The scan drops those PHOTOS before any station is derived, so the
    // other trip's day cannot colour this trip's clusters at all; the review
    // gets the exclusion, leftOut-style, with the trip it belongs to.
    const otherStay = station(
      "st-x",
      "Camp Nine",
      { lat: -44.21, lon: 169.94 },
      "2031-05-04",
      "2031-05-06"
    );
    const state: ExistingTripState = {
      ...STATE,
      roadtrips: [STATE.roadtrips[0], { ...STATE.roadtrips[1], stations: [otherStay] }],
    };
    const draft = await buildDraftWith(
      deps(
        [...AREA_A, ...photosAt("sb", SELBY_BAY, ["2031-05-04T17:00", "2031-05-05T10:00"])],
        false,
        state
      ),
      USER,
      { ...INPUT, endDay: "2031-05-05" },
      () => undefined
    );

    const [area] = draft.dto.areas;
    // No Selby Bay stop forms: its photos never reach the clusters this trip's
    // stations are built from, so there is nothing for the stop skip to catch.
    expect(area.stations.map((s) => s.title)).toEqual(["Northvale Lodge", "Port Carrow"]);
    expect(area.legs).toHaveLength(1);
    expect(area.leftOut).toBeUndefined();
    // The exclusion is shown the way the stop skip is: the other trip's name,
    // the days and how many photos.
    expect(area.leftOutPhotos).toEqual([
      {
        routeId: OTHER_ROUTE,
        routeName: "Selby Bay stay",
        firstDay: "2031-05-04",
        lastDay: "2031-05-05",
        count: 2,
      },
    ]);
    // No night may name a station the review cannot show.
    const shown = new Set(area.stations.map((s) => s.key));
    const specials: readonly string[] = NIGHT_SPECIALS;
    for (const entry of Object.values(draft.dto.nights)) {
      if (!specials.includes(entry.assign)) expect(shown.has(entry.assign)).toBe(true);
    }
    // The counts stay coherent with the stat rows: the photos are still among
    // the window's own — 9 of the trip's plus the 2 left out — and the album's
    // list is the window's, while the excluded count says how many of them
    // shape nothing here.
    expect(draft.dto.stats.assets).toBe(11);
    expect(draft.dto.stats.excluded.otherTrip).toBe(2);
    expect(draft.albumAssetIds).toEqual(expect.arrayContaining(["sb-1", "sb-2"]));
    // The day rows keep the window's photo counts, the excluded ones included.
    expect(draft.dto.days.find((day) => day.day === "2031-05-04")?.photos).toBe(4);
    // The target's own offer is untouched, and the other trip's row is not this
    // scan's to write.
    expect([...(draft.existing?.roadtrips.keys() ?? [])]).toEqual([ROUTE]);
  });

  it("starts the night plan from the target trip's own stored spans (the owner's shape)", async () => {
    // The owner's night drift (2026-10-12, live scoped run): the stored trip's
    // two Jebel Shams nights — its stop carried `overnight: true` on 11-26..28 —
    // came back as the review's photo-based guesses, because a fresh scoped
    // scan has no stored draft to seed them from. Here: stored "Port Carrow"
    // 05-02..05-04 holds the nights of 05-02 and 05-03 (the Jebel Shams span),
    // the scan's own answers for those nights are Northvale, and the night
    // outside the stored spans (05-04) keeps the scan's suggestion.
    const state: ExistingTripState = {
      ...STATE,
      roadtrips: [
        {
          id: ROUTE,
          name: "Northvale loop",
          legs: [],
          stations: [
            // The arrival the photos show as a pass-through (the owner's
            // Muscat 11-26): a pass station holds no night.
            station("st-a", "Northvale Lodge", NORTHVALE, "2031-05-02", "2031-05-04", "pass"),
            station("st-p", "Port Carrow", PORT_CARROW, "2031-05-02", "2031-05-04"),
          ],
        },
        STATE.roadtrips[1],
      ],
    };
    const draft = await buildDraftWith(
      deps(
        [
          ...photosAt("pc", PORT_CARROW, ["2031-05-02T09:00", "2031-05-02T15:00"]),
          ...photosAt("nv", NORTHVALE, [
            "2031-05-02T19:00",
            "2031-05-03T09:00",
            "2031-05-03T19:00",
          ]),
          ...photosAt("ep", EASTPORT, ["2031-05-04T10:00", "2031-05-04T19:00"]),
        ],
        false,
        state
      ),
      USER,
      { ...INPUT, endDay: "2031-05-05" },
      () => undefined
    );

    const [area] = draft.dto.areas;
    const keyOf = (title: string): string =>
      area.stations.find((s) => s.title === title)?.key ?? "not shown";
    expect(area.stations.map((s) => s.title)).toEqual([
      "Port Carrow",
      "Northvale Lodge",
      "Eastport",
    ]);
    // The two stored nights come back as the stored station, not the scan's
    // own last-photo answers (Northvale on both).
    expect(draft.dto.nights["2031-05-02"]).toMatchObject({
      assign: keyOf("Port Carrow"),
      reason: "stored",
    });
    expect(draft.dto.nights["2031-05-03"]).toMatchObject({
      assign: keyOf("Port Carrow"),
      reason: "stored",
    });
    // A night outside the stored spans keeps today's scan suggestion.
    expect(draft.dto.nights["2031-05-04"]).toMatchObject({
      assign: keyOf("Eastport"),
      reason: "lastPhoto",
    });
    // The stored span came back whole: the night plan the review submits is a
    // valid one, so the trip is not left un-updatable by its own seeds.
    const stationRows = area.stations.map((s) => ({
      key: s.key,
      title: s.title,
      lat: s.lat,
      lon: s.lon,
      firstDay: s.firstDay,
      lastDay: s.lastDay,
    }));
    expect(
      validateNightPlan(
        stationRows,
        Object.fromEntries(Object.entries(draft.dto.nights).map(([day, e]) => [day, e.assign])),
        [
          {
            key: area.key,
            startDay: area.startDay,
            endDay: area.endDay,
            stationKeys: area.stations.map((s) => s.key),
          },
        ],
        { startDay: "2031-05-02", endDay: "2031-05-05" }
      )
    ).toEqual([]);
  });

  it("adopts the stored trip's own dates, so its stored nights seed (the owner's shape)", async () => {
    // The owner's drift (2026-10-12, the scoped run): the stored trip's
    // overnight — Jebel Shams 11-26..28, its two nights — met a FRESH scan whose
    // matched station carried days of its own that could not hold those nights,
    // so the seeding guard refused them and the scan's own suggestions won.
    // Here: the stored "Northvale" overnight is 05-02..05-04 (nights 05-02 and
    // 05-03) while the new scan's Northvale photos are on 05-05 — the match
    // holds by title alone, and before the fix both nights keep the scan's
    // Fenwick answers. With the stored span adopted, the station carries
    // 05-02..05-04 and the trip's own nights come back as it.
    const state: ExistingTripState = {
      ...STATE,
      startDay: "2031-05-02",
      endDay: "2031-05-05",
      roadtrips: [
        {
          id: ROUTE,
          name: "Northvale loop",
          legs: [],
          stations: [
            // The stored overnight the new scan cannot place: its own photo of
            // the place sits a day after the stored span.
            station("st-a", "Northvale", NORTHVALE, "2031-05-02", "2031-05-04"),
            // A stored station no cluster matches: its not-seen behaviour is
            // untouched by the adoption.
            station("st-k", "Crowmoor", CROWMOOR, "2031-05-03", "2031-05-04"),
          ],
        },
        STATE.roadtrips[1],
      ],
    };
    const draft = await buildDraftWith(
      deps(
        [
          ...photosAt("fw", FENWICK, [
            "2031-05-02T09:00",
            "2031-05-02T19:00",
            "2031-05-03T09:00",
            "2031-05-03T19:00",
            "2031-05-04T09:00",
            "2031-05-04T19:00",
          ]),
          ...photosAt("nv", NORTHVALE, ["2031-05-05T10:00", "2031-05-05T15:00"]),
        ],
        false,
        state
      ),
      USER,
      { ...INPUT, endDay: "2031-05-05" },
      () => undefined
    );

    const [area] = draft.dto.areas;
    // The pills still read the scan's own derivation (the photos' days versus
    // what is stored) while the matched station carries the stored span.
    expect(
      area.stations.map((s) => [s.title, s.firstDay, s.lastDay, s.status, s.existingId])
    ).toEqual([
      ["Fenwick", "2031-05-02", "2031-05-04", "new", undefined],
      ["Northvale", "2031-05-02", "2031-05-04", "changed", "st-a"],
    ]);
    // The commit's day allow-list offers the days the review will ship.
    expect(draft.stationIndex.get(area.stations[1].key)).toMatchObject({
      areaKey: area.key,
      firstDay: "2031-05-02",
      lastDay: "2031-05-04",
    });
    // The stored span's nights come back as the stored station …
    expect(draft.dto.nights["2031-05-02"]).toMatchObject({
      assign: area.stations[1].key,
      reason: "stored",
    });
    expect(draft.dto.nights["2031-05-03"]).toMatchObject({
      assign: area.stations[1].key,
      reason: "stored",
    });
    // … a night outside the stored spans keeps today's scan suggestion …
    expect(draft.dto.nights["2031-05-04"]).toMatchObject({
      assign: area.stations[0].key,
      reason: "lastPhoto",
    });
    // … and an unmatched stored station is offered not-seen, exactly as before.
    expect(area.notSeen?.map((s) => [s.title, s.notSeen?.defaultKeep, s.notSeen?.reason])).toEqual([
      ["Crowmoor", true, "notInPhotos"],
    ]);
    // The plan the review submits is the one the commit validates.
    const stationRows = area.stations.map((s) => ({
      key: s.key,
      title: s.title,
      lat: s.lat,
      lon: s.lon,
      firstDay: s.firstDay,
      lastDay: s.lastDay,
    }));
    expect(
      validateNightPlan(
        stationRows,
        Object.fromEntries(Object.entries(draft.dto.nights).map(([day, e]) => [day, e.assign])),
        [
          {
            key: area.key,
            startDay: area.startDay,
            endDay: area.endDay,
            stationKeys: area.stations.map((s) => s.key),
          },
        ],
        { startDay: "2031-05-02", endDay: "2031-05-05" }
      )
    ).toEqual([]);
  });

  it("takes the stored title where the scan could only title a matched station by coordinates", async () => {
    // The title rule the scoped flow reads is the journey-wide `keptTitle`
    // (spec §K.2, applied by the annotation): a draft title that is empty or
    // only the coordinate fallback adopts the stored one — no Immich city and
    // no geocoder here, so the cluster's own title is "-41.20, 174.90" and the
    // stored "Fenwick Fold" is what the review shows and the commit keeps.
    const state: ExistingTripState = {
      ...STATE,
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      roadtrips: [
        {
          id: ROUTE,
          name: "Northvale loop",
          legs: [],
          stations: [station("st-r", "Fenwick Fold", RIDGE, "2031-05-02", "2031-05-03")],
        },
        STATE.roadtrips[1],
      ],
    };
    const draft = await buildDraftWith(
      deps(photosAt("rd", RIDGE, ["2031-05-02T10:00", "2031-05-02T19:00"]), false, state),
      USER,
      { ...INPUT, endDay: "2031-05-03" },
      () => undefined
    );

    expect(draft.dto.areas[0].stations.map((s) => [s.title, s.status, s.existingId])).toEqual([
      ["Fenwick Fold", "same", "st-r"],
    ]);
  });

  it("keeps a legitimate name from the new scan when the stored title is only coordinates", async () => {
    // The other arm of the same rule: the stored station's title is the old
    // coordinate fallback and the new scan has a real name — the draft's own
    // name is the one shown (a corrected place name is not overwritten by the
    // placeholder the previous scan left).
    const state: ExistingTripState = {
      ...STATE,
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      roadtrips: [
        {
          id: ROUTE,
          name: "Northvale loop",
          legs: [],
          stations: [station("st-f", "-37.70, 176.25", FENWICK, "2031-05-02", "2031-05-03")],
        },
        STATE.roadtrips[1],
      ],
    };
    const draft = await buildDraftWith(
      deps(photosAt("fw", FENWICK, ["2031-05-02T10:00", "2031-05-02T19:00"]), false, state),
      USER,
      { ...INPUT, endDay: "2031-05-03" },
      () => undefined
    );

    expect(draft.dto.areas[0].stations.map((s) => [s.title, s.existingId])).toEqual([
      ["Fenwick", "st-f"],
    ]);
  });

  it("previews the trip's own album, matched by its stored name, and offers no removal", async () => {
    const draft = await buildDraftWith(deps(AREA_A), USER, INPUT, () => undefined);

    expect(draft.dto.album?.name).toBe("Northvale loop");
    expect(draft.dto.album?.sync).toEqual({
      target: "linked",
      toAdd: 8,
      alreadyIn: 1,
      // Add-only: the trip's own album never loses members here.
      removable: { count: 0, defaultOn: false, allowed: false },
    });
    expect(draft.existing?.album).toEqual({ immichAlbumId: "al-1", outsideIds: [] });
  });
});
