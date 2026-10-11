import { buildDraftWith } from "../buildDraft";
import type { ExistingDeps } from "../existingDraft";
import type { ExistingTripState } from "../existingTypes";
import type { ScanInput } from "../types";
import { ME, NORTHVALE, PORT_CARROW, builderDeps, photosAt } from "./builderFixtures";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const TRIP = "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01";

/** Northvale for two nights, then Port Carrow: nine photos in the window, one two days after it. */
const WINDOW_PHOTOS = [
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
const AFTER_WINDOW = photosAt("late", NORTHVALE, ["2031-05-06T10:00"]);

const INPUT: ScanInput = {
  name: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-04",
  inspect: true,
  createAlbum: true,
  target: { kind: "existing", tripId: TRIP },
};

const STATE: ExistingTripState = {
  tripId: TRIP,
  tripName: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-04",
  countries: ["NZ"],
  roadtrips: [
    {
      id: "r1",
      name: "Northvale loop",
      legs: [],
      stations: [
        {
          id: "st-a",
          title: "Northvale Lodge",
          lat: NORTHVALE.lat,
          lon: NORTHVALE.lon,
          startDate: "2031-05-02",
          endDate: "2031-05-04",
          night: "free",
          lodgingStayId: null,
          placeId: null,
          notes: null,
        },
        {
          id: "st-c",
          title: "Kelmore",
          lat: -45.42,
          lon: 168.52,
          startDate: "2031-05-03",
          endDate: "2031-05-04",
          night: "pass",
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
      member("late-1", "2031-05-05T22:00:00.000Z"),
    ],
    findOwnedAlbumByName: async () => null,
    getMyApiKey: async () => ({ permissions: ["albumAsset.delete"] }),
  },
};

const GATE = { allowed: true, missingScopes: [] as string[] };

function deps(over: { existing?: ExistingDeps | null } = {}) {
  return builderDeps([...WINDOW_PHOTOS, ...AFTER_WINDOW], {
    targetTrip: {
      id: TRIP,
      name: "Northvale loop",
      countries: ["NZ"],
      roadtripNames: ["Northvale loop"],
    },
    album: { gate: GATE, findOwned: async () => null, linkedTripName: async () => null },
    ...over,
  });
}

describe("buildDraftWith for an existing trip", () => {
  it("annotates the stations against the stored roadtrip and remembers what it offered", async () => {
    const draft = await buildDraftWith(deps({ existing }), USER, INPUT, () => undefined);

    const [area] = draft.dto.areas;
    expect(area.roadtripId).toBe("r1");
    expect(area.stations.map((s) => [s.title, s.status, s.existingId])).toEqual([
      ["Northvale Lodge", "same", "st-a"],
      ["Port Carrow", "new", undefined],
    ]);
    expect(area.notSeen?.map((s) => [s.title, s.status])).toEqual([["Kelmore", "notSeen"]]);
    expect(draft.existing?.tripId).toBe(TRIP);
    expect([...(draft.existing?.roadtrips.get("r1")?.matchedIds ?? [])]).toEqual(["st-a"]);
  });

  it("shows the stored roadtrip's own name for the matched area, not the derived '·' one", async () => {
    // The trip already holds a roadtrip called "Northvale loop", so the derived name
    // would be "Northvale loop · Northvale"; the review shows the stored name instead,
    // which is also what the commit keeps when the user does not rename it.
    const draft = await buildDraftWith(deps({ existing }), USER, INPUT, () => undefined);

    const [area] = draft.dto.areas;
    expect(area.roadtripId).toBe("r1");
    expect(area.suggestedName).toBe("Northvale loop");
  });

  it("previews the album against the photos of the window and the ones around it", async () => {
    const draft = await buildDraftWith(deps({ existing }), USER, INPUT, () => undefined);

    expect(draft.dto.album?.sync).toEqual({
      target: "linked",
      toAdd: 8,
      alreadyIn: 1,
      removable: { count: 1, defaultOn: true, allowed: true },
    });
    expect(draft.existing?.album).toEqual({ immichAlbumId: "al-1", outsideIds: ["late-1"] });
  });

  it("leaves a draft with no existing deps unannotated", async () => {
    const draft = await buildDraftWith(
      deps(),
      USER,
      { ...INPUT, target: { kind: "new" } },
      () => undefined
    );

    expect(draft.existing).toBeUndefined();
    expect(draft.dto.areas[0].stations.every((s) => s.status === undefined)).toBe(true);
    expect(draft.dto.album?.sync).toBeUndefined();
    expect(draft.dto.notSeenStops).toBeUndefined();
  });
});
