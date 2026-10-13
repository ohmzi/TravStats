/**
 * The route-scoped scan (owner request 2026-10-12): the trip edit page's
 * Re-sync scans the trip's own window and the draft offers exactly one update —
 * that stored roadtrip, under its stored name, with its own album, and nothing
 * else of the journey.
 */
import { NIGHT_SPECIALS } from "../../../shared/tour/builderNightPlan";
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
  endDate: string
): ExistingTripState["roadtrips"][number]["stations"][number] => ({
  id,
  title,
  lat: at.lat,
  lon: at.lon,
  startDate,
  endDate,
  night: "free",
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

  it("leaves out a stop that stands on another trip of the journey, and says so in the review", async () => {
    // The owner's shape (2026-10-12, live failure): the trip-scoped window's
    // last day also picks up photos that belong to ANOTHER trip of the journey —
    // the 11-30 Dubai arrival photos against the Dubai trip's own stored stop —
    // and the commit refused the whole re-sync. The scan leaves that stop out of
    // the route and records the skip for the review to show.
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
    expect(area.stations.map((s) => s.title)).toEqual(["Northvale Lodge", "Port Carrow"]);
    expect(area.legs).toHaveLength(1);
    const [leftOut] = area.leftOut ?? [];
    expect(leftOut).toMatchObject({
      title: "Selby Bay",
      firstDay: "2031-05-04",
      lastDay: "2031-05-05",
      routeId: OTHER_ROUTE,
      routeName: "Selby Bay stay",
    });
    expect(typeof leftOut?.key).toBe("string");
    // The stop is out of the route, not out of the trip: the target's own offer
    // is untouched, and the other trip's row is not this scan's to write.
    expect([...(draft.existing?.roadtrips.keys() ?? [])]).toEqual([ROUTE]);
    // No night may name a station the review cannot show: the answer the
    // left-out stop held is unknown again, so the night plan still validates.
    const shown = new Set(area.stations.map((s) => s.key));
    const specials: readonly string[] = NIGHT_SPECIALS;
    for (const entry of Object.values(draft.dto.nights)) {
      if (!specials.includes(entry.assign)) expect(shown.has(entry.assign)).toBe(true);
    }
    // The day rows carry no phantom either: the left-out key is gone from them.
    const dayKeys = draft.dto.days.flatMap((day) => day.stationKeys);
    expect(dayKeys).not.toContain(leftOut?.key);
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
