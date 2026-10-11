import type { DraftArea, DraftStation, TripBuilderDraft } from "../../../types/tripBuilder";

/** The keys of `matchedStopDraft`'s one area. */
export const STOP_KEY = {
  harbour: "-894|3383|2031-05-04",
  market: "-894|3383|2031-05-05",
} as const;

// Synthetic fixtures only (public repository).
export const KEY = {
  northvale: "-901|3374|2031-05-02",
  portCarrow: "-894|3383|2031-05-04",
  southbridge: "-909|3382|2031-05-05",
  kelmore: "-908|3370|2031-05-06",
  tarnside: "-904|3388|2031-05-07",
  harbour: "-894|3383|2031-05-04~2",
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
    firstLocal: null,
    lastLocal: null,
    photoCount: 12,
    previewIdx: [0],
    notes: null,
    ...over,
  };
}

/** Northvale (same), Port Carrow (changed), Southbridge (new); Kelmore and Tarnside not seen; a stop not seen. */
export function existingDraft(over: Partial<TripBuilderDraft> = {}): TripBuilderDraft {
  const stations = [
    station(KEY.northvale, "Northvale Lodge", "2031-05-02", "2031-05-03", {
      status: "same",
      existingId: "st-a",
      before: { startDate: "2031-05-02", endDate: "2031-05-04", slept: true, stay: false },
    }),
    station(KEY.portCarrow, "Port Carrow", "2031-05-04", "2031-05-04", {
      status: "changed",
      existingId: "st-b",
      before: { startDate: "2031-05-04", endDate: "2031-05-06", slept: false, stay: false },
    }),
    station(KEY.southbridge, "Southbridge", "2031-05-05", "2031-05-06", { status: "new" }),
  ];
  const notSeen = [
    station(KEY.kelmore, "Kelmore", "2031-05-06", "2031-05-07", {
      status: "notSeen",
      existingId: "st-c",
      titleSource: "existing",
      notSeen: { defaultKeep: true, reason: "notInPhotos" },
    }),
    station(KEY.tarnside, "Tarnside", "2031-05-07", "2031-05-09", {
      status: "notSeen",
      existingId: "st-d",
      titleSource: "existing",
      notSeen: { defaultKeep: false, reason: "outsideWindow" },
    }),
  ];
  const area: DraftArea = {
    key: "2031-05-02#1",
    defaultAs: "roadtrip",
    suggestedName: "Northvale loop",
    mainCity: "Northvale",
    startDay: "2031-05-02",
    endDay: "2031-05-06",
    home: {
      start: { offered: false, defaultOn: false },
      end: { offered: false, defaultOn: false },
      unconfirmed: false,
    },
    stations,
    legs: [
      {
        fromKey: KEY.northvale,
        toKey: KEY.portCarrow,
        chordKm: 52,
        routedKm: 55,
        mode: "road",
        ferryEvidence: null,
      },
      {
        fromKey: KEY.portCarrow,
        toKey: KEY.southbridge,
        chordKm: 60,
        routedKm: null,
        mode: "road",
        ferryEvidence: null,
      },
    ],
    roadtripId: "r1",
    notSeen,
  };
  const entry = (assign: string) => ({
    assign,
    reason: "lastPhoto" as const,
    suggestedStationKeys: [],
  });
  return {
    id: "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
    expiresAt: "2031-05-10T14:00:00.000Z",
    window: {
      startDay: "2031-05-02",
      endDay: "2031-05-07",
      checkedFrom: "2031-04-29",
      checkedTo: "2031-05-10",
    },
    options: { inspect: true, createAlbum: true },
    target: {
      kind: "existing",
      tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
      tripName: "Northvale loop",
    },
    tripName: "Northvale loop",
    countries: ["NZ"],
    originLabel: null,
    destinationLabel: null,
    stats: {
      assets: 40,
      images: 38,
      videos: 2,
      located: 36,
      excluded: {
        partner: 0,
        hiddenLivePart: 0,
        misdated: 0,
        inFlight: 0,
        atSea: 0,
        unlocated: 4,
        dayGuessed: 0,
      },
      truncated: false,
    },
    flights: [],
    days: [],
    nights: {
      "2031-05-02": entry(KEY.northvale),
      "2031-05-03": entry(KEY.northvale),
      "2031-05-04": entry(KEY.portCarrow),
      "2031-05-05": entry(KEY.southbridge),
      "2031-05-06": entry("unknown"),
    },
    areas: [area],
    photoJourneys: [],
    album: {
      name: "Northvale loop",
      existing: null,
      assetCount: 40,
      images: 38,
      videos: 2,
      allowed: true,
      missingScopes: [],
      sync: {
        target: "linked",
        toAdd: 4,
        alreadyIn: 36,
        removable: { count: 3, defaultOn: true, allowed: true },
      },
    },
    notSeenStops: [
      station(KEY.harbour, "Port Carrow Harbour", "2031-05-04", "2031-05-04", {
        status: "notSeen",
        existingId: "stop-h",
        titleSource: "existing",
        notSeen: { defaultKeep: true, reason: "notInPhotos" },
      }),
    ],
    warnings: [],
    ...over,
  };
}

/**
 * A trip whose only area is a `stops` area matched to one stored stop (`stop-m`,
 * on its anchor): the second station is one more run of it, with no status.
 */
export function matchedStopDraft(over: Partial<TripBuilderDraft> = {}): TripBuilderDraft {
  const harbour = station(STOP_KEY.harbour, "Port Carrow Harbour", "2031-05-04", "2031-05-04", {
    status: "changed",
    existingId: "stop-m",
    titleSource: "existing",
    before: { startDate: "2031-05-04", endDate: "2031-05-05", slept: false, stay: false },
  });
  const market = station(STOP_KEY.market, "Kelmore Market", "2031-05-05", "2031-05-05", {
    photoCount: 5,
  });
  const area: DraftArea = {
    key: "2031-05-04#1",
    defaultAs: "stops",
    suggestedName: "Port Carrow",
    mainCity: null,
    startDay: "2031-05-04",
    endDay: "2031-05-05",
    home: {
      start: { offered: false, defaultOn: false },
      end: { offered: false, defaultOn: false },
      unconfirmed: false,
    },
    stations: [harbour, market],
    legs: [
      {
        fromKey: STOP_KEY.harbour,
        toKey: STOP_KEY.market,
        chordKm: 4,
        routedKm: null,
        mode: "road",
        ferryEvidence: null,
      },
    ],
  };
  return existingDraft({
    areas: [area],
    days: [
      {
        day: "2031-05-04",
        photos: 6,
        located: 6,
        stationKeys: [STOP_KEY.harbour],
        flightIds: [],
        passedThrough: [],
      },
      {
        day: "2031-05-05",
        photos: 5,
        located: 5,
        stationKeys: [STOP_KEY.market],
        flightIds: [],
        passedThrough: [],
      },
    ],
    nights: {
      "2031-05-04": { assign: STOP_KEY.harbour, reason: "lastPhoto", suggestedStationKeys: [] },
      "2031-05-05": { assign: "unknown", reason: "unknown", suggestedStationKeys: [] },
    },
    notSeenStops: [],
    ...over,
  });
}
