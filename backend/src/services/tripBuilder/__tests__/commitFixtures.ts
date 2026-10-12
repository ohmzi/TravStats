import type { CommitBody } from "../../../schemas/tripBuilder";
import type {
  CommitPlan,
  CommitTargetPlan,
  DraftStation,
  StoredDraft,
  StoredPitstop,
  StoredStopover,
  StopoverPlan,
  TripBuilderDraft,
} from "../types";

export const DRAFT_ID = "4b9d6f1a-2c3e-4a5b-8d7e-9f0a1b2c3d4e";
export const COMMIT_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
export const OTHER_COMMIT_KEY = "7b1c8d2e-3f4a-4b6c-9d7e-8f9a0b1c2d3e";
export const JOURNEY_ID = "8c2d9e3f-4a5b-4c7d-8e8f-9a0b1c2d3e4f";
export const IMMICH_USER = "0b6f3a52-5d1c-4f43-9c1e-6a7b8c9d0e1f";
export const AREA_KEY = "2031-05-02#1";
export const K_NV = "-901|3374|2031-05-02";
export const K_PC = "-894|3383|2031-05-04";
export const K_SB = "-884|3399|2031-05-05";
export const WINDOW = { startDay: "2031-05-02", endDay: "2031-05-05" };
/** Created at 08:00; tests pin the clock at 08:30 so the draft is alive. */
export const CREATED_AT = Date.parse("2031-05-20T08:00:00Z");

export function draftStation(
  over: Pick<DraftStation, "key" | "title" | "lat" | "lon" | "firstDay" | "lastDay">
): DraftStation {
  return {
    titleSource: "immich",
    kind: "visit",
    snappedKm: null,
    firstLocal: null,
    lastLocal: null,
    photoCount: 3,
    previewIdx: [],
    notes: null,
    ...over,
  };
}

const STATIONS: DraftStation[] = [
  draftStation({
    key: K_NV,
    title: "Northvale",
    lat: -45.05,
    lon: 168.7,
    firstDay: "2031-05-02",
    lastDay: "2031-05-03",
  }),
  draftStation({
    key: K_PC,
    title: "Port Carrow",
    lat: -44.7,
    lon: 169.15,
    firstDay: "2031-05-04",
    lastDay: "2031-05-04",
  }),
  draftStation({
    key: K_SB,
    title: "Selby Bay",
    lat: -44.2,
    lon: 169.95,
    firstDay: "2031-05-05",
    lastDay: "2031-05-05",
  }),
];
const NO_HOME_END = { offered: false, defaultOn: false };

/** A ready draft of one roadtrip area (Northvale → Port Carrow → Selby Bay by ferry) over four days. */
export function fixtureDraft(
  ownerId: string,
  flightIds: readonly string[] = [],
  over: Partial<StoredDraft> = {}
): StoredDraft {
  const dto: TripBuilderDraft = {
    id: DRAFT_ID,
    expiresAt: new Date(CREATED_AT + 2 * 3_600_000).toISOString(),
    window: { ...WINDOW, checkedFrom: "2031-04-29", checkedTo: "2031-05-08" },
    options: { inspect: true, createAlbum: true },
    target: { kind: "new" },
    tripName: "Northvale loop",
    countries: ["NZ"],
    originLabel: null,
    destinationLabel: null,
    stats: {
      assets: 2,
      images: 2,
      videos: 0,
      located: 2,
      excluded: {
        partner: 0,
        hiddenLivePart: 0,
        misdated: 0,
        inFlight: 0,
        atSea: 0,
        unlocated: 0,
        dayGuessed: 0,
      },
      truncated: false,
    },
    flights: [],
    days: [],
    nights: {},
    areas: [
      {
        key: AREA_KEY,
        defaultAs: "roadtrip",
        suggestedName: "Northvale loop",
        mainCity: "Northvale",
        startDay: "2031-05-02",
        endDay: "2031-05-05",
        home: { start: NO_HOME_END, end: NO_HOME_END, unconfirmed: false },
        stations: STATIONS,
        legs: [
          {
            fromKey: K_NV,
            toKey: K_PC,
            chordKm: 53,
            routedKm: null,
            mode: "road",
            ferryEvidence: null,
          },
          {
            fromKey: K_PC,
            toKey: K_SB,
            chordKm: 85,
            routedKm: null,
            mode: "ferry",
            ferryEvidence: "seaPhotos",
          },
        ],
      },
    ],
    photoJourneys: [
      { id: JOURNEY_ID, startDay: "2031-05-02", endDay: "2031-05-03", defaultTick: true },
    ],
    album: {
      name: "Northvale loop",
      existing: null,
      assetCount: 2,
      images: 2,
      videos: 0,
      allowed: true,
      missingScopes: [],
    },
    warnings: [],
  };
  return {
    id: DRAFT_ID,
    ownerId,
    createdAt: CREATED_AT,
    touchedAt: CREATED_AT,
    status: "ready",
    input: {
      name: "Northvale loop",
      startDay: WINDOW.startDay,
      endDay: WINDOW.endDay,
      inspect: true,
      createAlbum: true,
      target: { kind: "new" },
    },
    immichUserId: IMMICH_USER,
    connSource: "user",
    dto,
    previewAssetIds: ["photo-a", "photo-b"],
    albumAssetIds: ["photo-a", "photo-b"],
    flightIds: new Set(flightIds),
    stationIndex: new Map(
      STATIONS.map(
        (s) => [s.key, { areaKey: AREA_KEY, firstDay: s.firstDay, lastDay: s.lastDay }] as const
      )
    ),
    stopovers: [],
    pitstops: [],
    ...over,
  };
}

const commitStation = (s: DraftStation) => ({
  key: s.key,
  title: s.title,
  lat: s.lat,
  lon: s.lon,
  kind: s.kind,
  firstDay: s.firstDay,
  lastDay: s.lastDay,
});

/** The body the review page would send for `fixtureDraft`, left as the scan proposed it. */
export function fixtureBody(flightIds: readonly string[] = []): CommitBody {
  return {
    commitKey: COMMIT_KEY,
    window: { ...WINDOW },
    target: { kind: "new", trip: { name: "Northvale loop" } },
    flightIds: [...flightIds],
    nights: { "2031-05-02": K_NV, "2031-05-03": K_NV, "2031-05-04": K_PC },
    areas: [
      {
        key: AREA_KEY,
        as: "roadtrip",
        name: "Northvale loop",
        vehicle: "car",
        homeStart: false,
        homeEnd: false,
        stations: STATIONS.map(commitStation),
        legModes: ["road", "ferry"],
        album: false,
        keepNotSeen: [],
        removeNotSeen: [],
      },
    ],
    stopovers: [],
    photoJourneyIds: [],
    stops: { keep: [], remove: [] },
    album: { create: false, name: "Northvale loop" },
  };
}

const NEW_TARGET: CommitTargetPlan = {
  kind: "new",
  trip: {
    name: "Northvale loop",
    startDate: new Date("2031-05-02T00:00:00.000Z"),
    endDate: new Date("2031-05-05T00:00:00.000Z"),
    countries: ["NZ"],
  },
};

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

/**
 * A validated plan: one roadtrip of three stations (two slept, one passed, a
 * road leg and a ferry leg) and one timeline stop. What `prepareCommit` would
 * make of `fixtureBody`, written out by hand so the write path is tested alone.
 */
export function fixturePlan(
  userId: string,
  flightIds: readonly string[] = [],
  target: CommitTargetPlan = NEW_TARGET
): CommitPlan {
  return {
    draftId: DRAFT_ID,
    userId,
    window: { ...WINDOW },
    target,
    flightIds: [...flightIds],
    stops: [
      {
        areaKey: "2031-05-05#1",
        title: "Selby Bay day",
        lat: -44.2,
        lon: 169.95,
        startDay: "2031-05-05",
        endDay: "2031-05-05",
        notes: "Two photos",
      },
    ],
    roadtrips: [
      {
        areaKey: AREA_KEY,
        name: "Northvale loop",
        vehicle: "car",
        stations: [
          {
            title: "Northvale",
            lat: -45.05,
            lon: 168.7,
            startDate: day("2031-05-02"),
            endDate: day("2031-05-04"),
            notes: null,
            night: { kind: "free" },
          },
          {
            title: "Port Carrow",
            lat: -44.7,
            lon: 169.15,
            startDate: day("2031-05-04"),
            endDate: day("2031-05-05"),
            notes: null,
            night: { kind: "free" },
          },
          {
            title: "Selby Bay",
            lat: -44.2,
            lon: 169.95,
            startDate: day("2031-05-05"),
            endDate: day("2031-05-05"),
            notes: null,
            night: { kind: "pass" },
          },
        ],
        legModes: ["road", "ferry"],
        nights: 3,
      },
    ],
    photoJourneyIds: [],
    album: { create: false, name: "Northvale loop" },
    unknownNights: 0,
  };
}

export const STOPOVER_KEY =
  "8c2d9e3f-4a5b-4c7d-8e8f-9a0b1c2d3e4f#9d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60";

/**
 * One stopover plan (spec 2026-10-11 §5.2): Port Carrow's day out — the
 * airport first, then the city, no nights. Synthetic fixtures only (public
 * repository).
 */
export function fixtureStopoverPlan(over: Partial<StopoverPlan> = {}): StopoverPlan {
  return {
    key: STOPOVER_KEY,
    name: "Northvale loop · Port Carrow",
    day: "2031-05-03",
    stations: [
      {
        title: "ZPC airport",
        lat: -44.72,
        lon: 169.17,
        startDate: day("2031-05-03"),
        endDate: day("2031-05-03"),
        notes: null,
        night: { kind: "pass" },
      },
      {
        title: "Port Carrow",
        lat: -44.7,
        lon: 169.15,
        startDate: day("2031-05-03"),
        endDate: day("2031-05-03"),
        notes: null,
        night: { kind: "pass" },
      },
    ],
    legModes: ["road"],
    album: { name: "Northvale loop · Port Carrow", assetIds: ["photo-a", "photo-b"] },
    ...over,
  };
}

/** The same stopover as the draft stored it (spec §2.3): its picture ids are the whole layover's. */
export function fixtureStoredStopover(over: Partial<StoredStopover> = {}): StoredStopover {
  return {
    key: STOPOVER_KEY,
    title: "Northvale loop · Port Carrow",
    city: "Port Carrow",
    day: "2031-05-03",
    inFlightId: "8c2d9e3f-4a5b-4c7d-8e8f-9a0b1c2d3e4f",
    outFlightId: "9d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
    airportIata: "ZPC",
    photoIds: ["photo-a", "photo-b"],
    stations: [],
    legs: [],
    ...over,
  };
}

/** The album name the scan computes for the fixture area as a pitstop (spec 2026-10-11 pitstops §6). */
export const PITSTOP_ALBUM = "Northvale loop · Northvale";

/**
 * The pitstop area's own album record the scan keeps (spec 2026-10-11 pitstops
 * §4): the name the review showed and the area's own picture set, which no DTO
 * may carry. Synthetic fixtures only (public repository).
 */
export function fixtureStoredPitstop(over: Partial<StoredPitstop> = {}): StoredPitstop {
  return {
    key: AREA_KEY,
    albumName: PITSTOP_ALBUM,
    day: "2031-05-02",
    assetIds: ["photo-a", "photo-b"],
    ...over,
  };
}
