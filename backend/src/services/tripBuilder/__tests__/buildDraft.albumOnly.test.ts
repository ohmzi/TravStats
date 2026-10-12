import { buildDraftWith } from "../buildDraft";
import { BUILD_PHASES, type BuildPhase, type ScanInput } from "../types";
import {
  ME,
  NORTHVALE,
  NOW_MS,
  PARTNER,
  at,
  builderDeps,
  nzAsset,
  preciseFlight,
} from "./builderFixtures";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const INPUT: ScanInput = {
  name: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-03",
  inspect: false,
  createAlbum: true,
  target: { kind: "new" },
};
const GATE = { allowed: true, missingScopes: [] as string[] };

describe("buildDraftWith, album only", () => {
  const assets = [
    nzAsset({ id: "a1", local: "2031-05-02T10:00", ...at(NORTHVALE) }),
    nzAsset({ id: "a2", local: "2031-05-03T09:00", ...at(NORTHVALE), type: "VIDEO" }),
    nzAsset({ id: "a3", local: "2031-05-03T10:00", lat: null, lon: null }),
    nzAsset({ id: "partner", local: "2031-05-02T11:00", ...at(NORTHVALE), ownerId: PARTNER }),
    nzAsset({ id: "live", local: "2031-05-02T10:00", ...at(NORTHVALE), visibility: "hidden" }),
  ];

  it("reports all seven steps, builds no movement and describes the album", async () => {
    const phases: BuildPhase[] = [];
    const deps = builderDeps(assets, {
      album: {
        gate: GATE,
        findOwned: async () => ({ immichAlbumId: "album-1", assetCount: 4 }),
        linkedTripName: async () => "Rented cabin",
      },
    });

    const draft = await buildDraftWith(deps, USER, INPUT, (phase) => phases.push(phase));

    expect(phases).toEqual([...BUILD_PHASES]);
    expect(draft).toMatchObject({
      id: "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a",
      ownerId: USER,
      immichUserId: ME,
      connSource: "user",
      status: "ready",
      createdAt: NOW_MS,
      albumAssetIds: ["a1", "a2", "a3"],
      previewAssetIds: [],
    });
    expect(draft.dto.areas).toEqual([]);
    expect(draft.dto.days).toEqual([]);
    expect(draft.dto.nights).toEqual({});
    expect(draft.dto.stats).toEqual({
      assets: 3,
      images: 2,
      videos: 1,
      located: 3,
      excluded: {
        partner: 1,
        hiddenLivePart: 1,
        misdated: 0,
        inFlight: 0,
        atSea: 0,
        unlocated: 0,
        locationCarried: 1,
        dayGuessed: 0,
      },
      truncated: false,
    });
    expect(draft.dto.album).toEqual({
      name: "Northvale loop",
      existing: { immichAlbumId: "album-1", assetCount: 4, linkedTripName: "Rented cabin" },
      assetCount: 3,
      images: 2,
      videos: 1,
      allowed: true,
      missingScopes: [],
    });
    expect(draft.dto.warnings).toEqual([
      { code: "albumLinkedElsewhere", params: { tripName: "Rented cabin" } },
    ]);
    expect(draft.dto.window).toEqual({
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      checkedFrom: "2031-04-29",
      checkedTo: "2031-05-06",
    });
  });

  it("lists the window's flights with the trip they are filed on, and flags overlapping trips", async () => {
    const filed = preciseFlight({
      id: "ff0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
      label: "ZZ101 ZPC→ZEP",
      depIata: "ZPC",
      arrIata: "ZEP",
      dep: { lat: -44.72, lon: 169.17 },
      arr: { lat: -38.02, lon: 177.01 },
      depLocal: "2031-05-02T08:00",
      arrLocal: "2031-05-02T09:30",
      tripId: "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01",
      tripName: "Winter in Tarn",
    });
    const deps = builderDeps(assets, {
      loadFlights: async () => [filed],
      overlappingTrips: async () => [
        {
          id: "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01",
          name: "Winter in Tarn",
          startDay: "2031-01-01",
          endDay: "2031-12-31",
        },
      ],
    });

    const draft = await buildDraftWith(
      deps,
      USER,
      { ...INPUT, createAlbum: false },
      () => undefined
    );

    expect(draft.dto.flights).toEqual([
      {
        id: filed.id,
        label: "ZZ101 ZPC→ZEP",
        depIata: "ZPC",
        arrIata: "ZEP",
        depLocal: "2031-05-02 08:00",
        arrLocal: "2031-05-02 09:30",
        precise: true,
        currentTrip: { id: "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01", name: "Winter in Tarn" },
        defaultAssign: false,
        locked: false,
      },
    ]);
    expect(draft.flightIds).toEqual(new Set([filed.id]));
    expect(draft.dto.album).toBeNull();
    expect(draft.dto.warnings).toContainEqual({
      code: "overlappingTrip",
      params: {
        name: "Winter in Tarn",
        startDay: "2031-01-01",
        endDay: "2031-12-31",
        suspiciouslyLong: true,
      },
    });
  });

  it("says what was checked when the library has nothing for the window", async () => {
    const onlyOthers = [
      nzAsset({ id: "partner", local: "2031-05-02T11:00", ...at(NORTHVALE), ownerId: PARTNER }),
      nzAsset({ id: "early", local: "2031-04-30T11:00", ...at(NORTHVALE) }),
    ];

    const draft = await buildDraftWith(
      builderDeps(onlyOthers),
      USER,
      { ...INPUT, createAlbum: false },
      () => undefined
    );

    expect(draft.dto.stats.assets).toBe(0);
    expect(draft.albumAssetIds).toEqual([]);
    expect(draft.dto.warnings).toEqual([
      {
        code: "emptyWindow",
        params: {
          checkedFrom: "2031-04-29",
          checkedTo: "2031-05-06",
          partner: 1,
          trashedNote: true,
        },
      },
    ]);
  });

  it("carries Immich's truncation into a warning", async () => {
    const draft = await buildDraftWith(
      builderDeps(assets, {}, true),
      USER,
      { ...INPUT, createAlbum: false },
      () => undefined
    );
    expect(draft.dto.warnings[0]).toEqual({ code: "truncated", params: {} });
    expect(draft.dto.stats.truncated).toBe(true);
  });
});
