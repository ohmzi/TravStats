import type {
  DraftArea,
  DraftDay,
  DraftFlight,
  DraftLeg,
  DraftStation,
  NightEntry,
  TripBuilderDraft,
} from "../../../types/tripBuilder";

// Synthetic fixtures only (public repository): invented places, shifted years.

export const DRAFT_ID = "4b9d6f1a-2c3e-4a5b-8d7e-9f0a1b2c3d4e";
export const FLIGHT_OUT = "f1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";
export const FLIGHT_ELSEWHERE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const JOURNEY = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
export const COMMIT_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";

export const KEY = {
  home: "-871|3453|2031-05-02",
  northvale: "-901|3374|2031-05-02",
  portCarrow: "-894|3383|2031-05-03",
  northvaleAgain: "-901|3374|2031-05-03",
  southbridge: "-908|3382|2031-05-05",
  tarnside: "-904|3388|2031-05-06",
} as const;

export function station(
  key: string,
  title: string,
  firstDay: string,
  lastDay: string,
  over: Partial<DraftStation> = {}
): DraftStation {
  return {
    key,
    title,
    titleSource: "geocode",
    kind: "visit",
    lat: -45.05,
    lon: 168.7,
    snappedKm: null,
    firstDay,
    lastDay,
    firstLocal: `${firstDay} 09:00`,
    lastLocal: `${lastDay} 17:30`,
    photoCount: 12,
    previewIdx: [0, 1],
    notes: null,
    ...over,
  };
}

export function leg(from: string, to: string, over: Partial<DraftLeg> = {}): DraftLeg {
  return {
    fromKey: from,
    toKey: to,
    chordKm: 40,
    routedKm: null,
    mode: "road",
    ferryEvidence: null,
    ...over,
  };
}

const HOME = station(KEY.home, "Kelmore", "2031-05-02", "2031-05-02", {
  kind: "home",
  titleSource: "home",
  lat: -43.53,
  lon: 172.64,
  firstLocal: null,
  lastLocal: null,
  photoCount: 0,
  previewIdx: [],
});

const NORTHVALE = station(KEY.northvale, "Northvale", "2031-05-02", "2031-05-03", {
  photoCount: 30,
  previewIdx: [0, 1, 2],
  notes: "First photo 09:00 · last 17:30 · 30 photos",
});
const PORT_CARROW = station(KEY.portCarrow, "Port Carrow", "2031-05-03", "2031-05-03", {
  kind: "dayTrip",
  excursionOf: KEY.northvale,
  lat: -44.7,
  lon: 169.15,
  photoCount: 6,
  previewIdx: [3],
});
const NORTHVALE_AGAIN = station(KEY.northvaleAgain, "Northvale", "2031-05-03", "2031-05-03", {
  kind: "brief",
  photoCount: 5,
  previewIdx: [4],
});
const SOUTHBRIDGE = station(KEY.southbridge, "Southbridge", "2031-05-05", "2031-05-05", {
  lat: -45.4,
  lon: 169.1,
  photoCount: 14,
  previewIdx: [5, 6],
});
const TARNSIDE = station(KEY.tarnside, "Tarnside", "2031-05-06", "2031-05-06", {
  lat: -45.2,
  lon: 169.4,
  photoCount: 6,
  previewIdx: [7],
});

const NO_HOME = { offered: false, defaultOn: false };

/** Home → Northvale → (day trip to Port Carrow) → Northvale. Flown to Southbridge → Tarnside. */
export const AREAS: DraftArea[] = [
  {
    key: "2031-05-02#1",
    defaultAs: "roadtrip",
    suggestedName: "Southern loop · Northvale",
    mainCity: "Northvale",
    startDay: "2031-05-02",
    endDay: "2031-05-03",
    home: {
      start: { offered: true, defaultOn: true, station: HOME },
      end: NO_HOME,
      unconfirmed: false,
    },
    stations: [HOME, NORTHVALE, PORT_CARROW, NORTHVALE_AGAIN],
    legs: [
      leg(KEY.home, KEY.northvale, { chordKm: 12.3, routedKm: 14.1 }),
      leg(KEY.northvale, KEY.portCarrow, { chordKm: 52.6, routedKm: 58 }),
      leg(KEY.portCarrow, KEY.northvaleAgain, { chordKm: 52.6 }),
    ],
  },
  {
    key: "2031-05-05#1",
    defaultAs: "roadtrip",
    suggestedName: "Southern loop · Southbridge",
    mainCity: "Southbridge",
    startDay: "2031-05-05",
    endDay: "2031-05-06",
    afterFlightId: FLIGHT_OUT,
    home: { start: NO_HOME, end: NO_HOME, unconfirmed: false },
    stations: [SOUTHBRIDGE, TARNSIDE],
    legs: [leg(KEY.southbridge, KEY.tarnside, { chordKm: 30.4 })],
  },
];

const entry = (
  assign: string,
  reason: NightEntry["reason"],
  suggested: string[] = []
): NightEntry => ({
  assign,
  reason,
  suggestedStationKeys: suggested,
});

const FLIGHTS: DraftFlight[] = [
  {
    id: FLIGHT_OUT,
    label: "ZZ101 ZNV→ZSB",
    depIata: "ZNV",
    arrIata: "ZSB",
    depLocal: "2031-05-04 09:10",
    arrLocal: "2031-05-04 11:40",
    precise: true,
    currentTrip: null,
    defaultAssign: true,
    locked: false,
  },
  {
    id: FLIGHT_ELSEWHERE,
    label: "ZZ202 ZSB→ZNV",
    depIata: "ZSB",
    arrIata: "ZNV",
    depLocal: "2031-05-07",
    arrLocal: "2031-05-07",
    precise: false,
    currentTrip: { id: "9c8b7a65-4321-4fed-8cba-0987654321ab", name: "Kelmore weekend" },
    defaultAssign: false,
    locked: false,
  },
];

const day = (
  d: string,
  photos: number,
  located: number,
  stationKeys: string[] = [],
  flightIds: string[] = []
): DraftDay => ({ day: d, photos, located, stationKeys, flightIds, passedThrough: [] });

const DAYS: DraftDay[] = [
  day("2031-05-02", 30, 28, [KEY.northvale]),
  day("2031-05-03", 22, 22, [KEY.northvale, KEY.portCarrow, KEY.northvaleAgain]),
  day("2031-05-04", 0, 0, [], [FLIGHT_OUT]),
  day("2031-05-05", 14, 14, [KEY.southbridge]),
  day("2031-05-06", 6, 6, [KEY.tarnside]),
  day("2031-05-07", 0, 0, [], [FLIGHT_ELSEWHERE]),
];

/**
 * Six days, five nights. 02 and 03 at Northvale, 04 in the air, 05 at
 * Southbridge, and 06 unknown (Tarnside is the suggestion).
 */
export function reviewDraft(over: Partial<TripBuilderDraft> = {}): TripBuilderDraft {
  return {
    id: DRAFT_ID,
    expiresAt: "2031-05-10T14:00:00.000Z",
    window: {
      startDay: "2031-05-02",
      endDay: "2031-05-07",
      checkedFrom: "2031-04-29",
      checkedTo: "2031-05-10",
    },
    options: { inspect: true, createAlbum: true },
    target: { kind: "new" },
    tripName: "Southern loop",
    countries: ["NZ"],
    originLabel: "Kelmore",
    destinationLabel: "Southbridge",
    stats: {
      assets: 72,
      images: 68,
      videos: 4,
      located: 70,
      excluded: {
        partner: 2,
        hiddenLivePart: 1,
        misdated: 0,
        inFlight: 3,
        atSea: 0,
        unlocated: 2,
        dayGuessed: 0,
      },
      truncated: false,
    },
    flights: FLIGHTS,
    days: DAYS,
    nights: {
      "2031-05-02": entry(KEY.northvale, "lastPhoto"),
      "2031-05-03": entry(KEY.northvaleAgain, "lastPhoto"),
      "2031-05-04": entry("flight", "flight"),
      "2031-05-05": entry(KEY.southbridge, "afterLanding"),
      "2031-05-06": entry("unknown", "unknown", [KEY.tarnside]),
    },
    areas: AREAS,
    photoJourneys: [
      { id: JOURNEY, startDay: "2031-05-03", endDay: "2031-05-04", defaultTick: true },
    ],
    album: {
      name: "Southern loop",
      existing: null,
      assetCount: 72,
      images: 68,
      videos: 4,
      allowed: true,
      missingScopes: [],
    },
    warnings: [],
    ...over,
  };
}
