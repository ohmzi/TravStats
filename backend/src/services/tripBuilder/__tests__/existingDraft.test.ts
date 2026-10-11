import { describe, it, expect, jest } from "@jest/globals";

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import type { ImmichAsset } from "../../immich/types";
import type {
  ExistingRoadtrip,
  ExistingStation,
  ExistingStop,
  ExistingTripState,
} from "../existingTypes";
import { annotateDraftForExisting, applyExistingTarget, type ExistingDeps } from "../existingDraft";
import { area, derivedStation, derivedStations, draft, flight, K } from "./existingDraftFixture";

// Synthetic fixtures only (public repository).
const TRIP = "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c";
const STAY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "immich-user-1";
const PATTERN = /^-?\d+\|-?\d+\|\d{4}-\d{2}-\d{2}(?:~\d+)?$/;

function stored(
  over: Partial<ExistingStation> & Pick<ExistingStation, "id" | "title" | "lat" | "lon">
): ExistingStation {
  return {
    startDate: "2031-05-02",
    endDate: "2031-05-04",
    night: "free",
    lodgingStayId: null,
    placeId: null,
    notes: null,
    ...over,
  };
}

const roadtrip: ExistingRoadtrip = {
  id: "r1",
  name: "Northvale loop",
  legs: [],
  stations: [
    stored({
      id: "st-a",
      title: "Northvale Lodge",
      lat: -45.05,
      lon: 168.7,
      notes: "Booked by phone",
    }),
    stored({
      id: "st-b",
      title: "Port Carrow",
      lat: -44.7,
      lon: 169.15,
      startDate: "2031-05-04",
      endDate: "2031-05-06",
      night: "pass",
    }),
    stored({
      id: "st-c",
      title: "Kelmore",
      lat: -45.42,
      lon: 168.52,
      startDate: "2031-05-06",
      endDate: "2031-05-07",
    }),
    stored({
      id: "st-s",
      title: "Tarnside Lodge",
      lat: -45.2,
      lon: 169.4,
      startDate: "2031-05-07",
      endDate: "2031-05-09",
      night: "stay",
      lodgingStayId: STAY,
    }),
  ],
};

const museum: ExistingStop = {
  id: "stop-m",
  title: "Kelmore Museum",
  lat: -45.42,
  lon: 168.52,
  startDay: "2031-05-06",
  endDay: "2031-05-06",
  notes: null,
};

function state(over: Partial<ExistingTripState> = {}): ExistingTripState {
  return {
    tripId: TRIP,
    tripName: "Northvale loop",
    startDay: "2031-05-02",
    endDay: "2031-05-09",
    countries: ["NZ"],
    roadtrips: [roadtrip],
    stops: [],
    flightIds: [],
    albums: [],
    ...over,
  };
}

describe("annotateDraftForExisting: a roadtrip area", () => {
  const result = annotateDraftForExisting(draft(TRIP), state({ stops: [museum] }));
  const [only] = result.dto.areas;

  it("matches the area to the stored roadtrip and every station against its stored one", () => {
    expect(only.roadtripId).toBe("r1");
    expect(only.stations.map((s) => [s.title, s.status, s.existingId])).toEqual([
      ["Northvale Lodge", "same", "st-a"],
      ["Port Carrow", "changed", "st-b"],
      ["Southbridge", "new", undefined],
      ["Tarnside Lodge", "same", "st-s"],
    ]);
  });

  it("keeps the stored title, notes and coordinates of a matched station", () => {
    const [northvale] = only.stations;
    expect(northvale).toMatchObject({
      title: "Northvale Lodge",
      notes: "Booked by phone",
      lat: -45.05,
      lon: 168.7,
      snappedKm: null,
    });
    expect(northvale.key).toBe(K.northvale);
  });

  it("shows what a changed station was", () => {
    expect(only.stations[1].before).toEqual({
      startDate: "2031-05-04",
      endDate: "2031-05-06",
      slept: false,
      stay: false,
    });
  });

  it("lists a stored station the photos do not show beside the area, not inside it", () => {
    expect(only.notSeen).toHaveLength(1);
    const [kelmore] = only.notSeen ?? [];
    expect(kelmore).toMatchObject({
      title: "Kelmore",
      status: "notSeen",
      existingId: "st-c",
      titleSource: "existing",
      notSeen: { defaultKeep: true, reason: "notInPhotos" },
    });
    expect(kelmore.key).toMatch(PATTERN);
    expect(only.stations).toHaveLength(4);
    expect(only.legs).toHaveLength(3);
  });

  it("remembers what it offered, for the commit to hold the draft to", () => {
    const offer = result.existing.roadtrips.get("r1");
    expect(offer?.areaKey).toBe("2031-05-02#1");
    expect(offer?.name).toBe("Northvale loop");
    expect([...(offer?.matchedIds ?? [])].sort()).toEqual(["st-a", "st-b", "st-s"]);
    expect([...(offer?.notSeenIds ?? [])]).toEqual(["st-c"]);
    expect(result.existing.tripId).toBe(TRIP);
  });

  it("names a matched area with the stored roadtrip's own name, not the scan's derivation", () => {
    // The trip already holds a roadtrip called like the trip, so `roadtripAreaNames`
    // derives "Northvale loop · Northvale"; the review must show what the roadtrip is
    // actually called, or the name the user sees is not the name the commit would keep.
    const derived = draft(TRIP, [area({ suggestedName: "Northvale loop · Northvale" })]);
    const [only] = annotateDraftForExisting(derived, state()).dto.areas;
    expect(only.roadtripId).toBe("r1");
    expect(only.suggestedName).toBe("Northvale loop");
  });

  it("offers the stop that no area matched as not seen", () => {
    expect(result.dto.notSeenStops?.map((s) => [s.title, s.existingId])).toEqual([
      ["Kelmore Museum", "stop-m"],
    ]);
    expect([...result.existing.stops.notSeenIds]).toEqual(["stop-m"]);
    expect(result.existing.stops.matchedIds.size).toBe(0);
  });
});

describe("annotateDraftForExisting: other cases", () => {
  it("calls every station of an area with no stored roadtrip new", () => {
    const { dto, existing } = annotateDraftForExisting(draft(TRIP), state({ roadtrips: [] }));
    expect(dto.areas[0].roadtripId).toBeUndefined();
    expect(dto.areas[0].stations.map((s) => s.status)).toEqual(["new", "new", "new", "new"]);
    expect(existing.roadtrips.size).toBe(0);
  });

  it("matches a stops area to a stored timeline stop and carries the status on its first ground station", () => {
    const stopsArea = area({
      key: "2031-05-06#1",
      defaultAs: "stops",
      stations: [
        derivedStation(
          "-908|3370|2031-05-06",
          "Kelmore Museum",
          { lat: -45.42, lon: 168.52 },
          "2031-05-06",
          "2031-05-07"
        ),
      ],
    });
    const { dto, existing } = annotateDraftForExisting(
      draft(TRIP, [stopsArea]),
      state({ roadtrips: [], stops: [museum] })
    );
    const [anchor] = dto.areas[0].stations;
    expect(anchor).toMatchObject({ status: "changed", existingId: "stop-m" });
    expect(anchor.before).toEqual({
      startDate: "2031-05-06",
      endDate: "2031-05-06",
      slept: false,
      stay: false,
    });
    expect([...existing.stops.matchedIds]).toEqual(["stop-m"]);
    expect(dto.notSeenStops).toEqual([]);
  });

  it("lists the flights already on the trip as locked and ticked", () => {
    const f = flight();
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [area()], { flights: [f] }),
      state({ flightIds: [f.id] })
    );
    expect(dto.flights[0]).toMatchObject({ locked: true, defaultAssign: true });
  });

  it("gives a not-seen station a key that cannot collide with a derived one", () => {
    // The first stored station is the derived Northvale (same place, overlapping days), so it
    // matches. The second is at the same place and first day but is not what the photos show:
    // its own key would be the derived station's key, so it has to be claimed with a suffix.
    const matched = stored({
      id: "st-a",
      title: "Northvale",
      lat: -45.05,
      lon: 168.7,
      startDate: "2031-05-02",
      endDate: "2031-05-03",
      night: "pass",
    });
    const clash = stored({
      id: "st-x",
      title: "Elsewhere",
      lat: -45.05,
      lon: 168.7,
      startDate: "2031-05-02",
      endDate: "2031-05-02",
      night: "pass",
    });
    const rt: ExistingRoadtrip = { ...roadtrip, stations: [matched, clash] };
    const { dto } = annotateDraftForExisting(
      draft(TRIP, [area({ stations: derivedStations().slice(0, 1) })]),
      state({ roadtrips: [rt] })
    );
    const [only] = dto.areas;
    expect(only.stations.map((s) => [s.key, s.status, s.existingId])).toEqual([
      [K.northvale, "changed", "st-a"],
    ]);
    const [elsewhere] = only.notSeen ?? [];
    expect(only.notSeen).toHaveLength(1);
    expect(elsewhere).toMatchObject({ title: "Elsewhere", status: "notSeen", existingId: "st-x" });
    expect(elsewhere.key).not.toBe(K.northvale);
    expect(elsewhere.key).toMatch(/~\d+$/);
    const keys = [...only.stations, ...(only.notSeen ?? [])].map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("applyExistingTarget", () => {
  const album = {
    name: "Northvale loop",
    existing: null,
    assetCount: 3,
    images: 3,
    videos: 0,
    allowed: true,
    missingScopes: [],
  };
  const facts = {
    windowAssetIds: ["w1", "w2", "w3"],
    contextIds: new Set(["c1"]),
    fetchFrom: new Date("2031-04-28T10:00:00.000Z"),
    fetchTo: new Date("2031-05-13T12:00:00.000Z"),
  };
  const asset = (id: string, at: string): ImmichAsset => ({
    id,
    type: "IMAGE",
    fileCreatedAt: at,
    originalFileName: `${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: null,
    lat: null,
    lon: null,
  });

  function deps(listAlbumAssets: ExistingDeps["client"]["listAlbumAssets"]): ExistingDeps {
    return {
      immichUserId: ME,
      state: state({
        albums: [
          {
            linkId: "l1",
            immichAlbumId: "al-1",
            albumName: "Northvale loop",
            assetCount: 3,
            ownedByUser: true,
            travstatsMarker: true,
          },
        ],
      }),
      client: {
        getAlbumInfo: jest.fn(async (id: string) => ({
          id,
          albumName: "Northvale loop",
          description: "TravStats trip · x",
          ownerId: ME,
          assetCount: 2,
          thumbnailAssetId: null,
        })),
        listAlbumAssets,
        findOwnedAlbumByName: jest.fn(async () => null),
        getMyApiKey: jest.fn(async () => ({ permissions: ["albumAsset.delete"] })),
      },
    };
  }

  it("changes nothing for a new trip", async () => {
    const dto = draft(TRIP);
    expect(await applyExistingTarget(null, facts, dto)).toEqual({ dto });
  });

  it("previews the album sync and remembers which album and which members it judged", async () => {
    const list = jest.fn(async () => [
      asset("w1", "2031-05-03T09:00:00.000Z"),
      asset("c1", "2031-05-01T09:00:00.000Z"),
    ]);
    const out = await applyExistingTarget(deps(list), facts, draft(TRIP, [area()], { album }));
    expect(out.dto.album?.sync).toEqual({
      target: "linked",
      toAdd: 2,
      alreadyIn: 1,
      removable: { count: 1, defaultOn: true, allowed: true },
    });
    expect(out.existing?.album).toEqual({ immichAlbumId: "al-1", outsideIds: ["c1"] });
  });

  it("blocks the album as unverified when Immich cannot be read, instead of previewing nothing", async () => {
    const failing = jest.fn(async () => {
      throw new Error("immich unreachable");
    });
    const out = await applyExistingTarget(deps(failing), facts, draft(TRIP, [area()], { album }));
    expect(out.dto.album).toMatchObject({ allowed: false, blockedReason: "unverified" });
    expect(out.dto.album?.sync).toBeUndefined();
    expect(out.existing?.album).toBeNull();
  });
});
