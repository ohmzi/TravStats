import type { DraftArea, DraftStation, TripBuilderDraft } from "../../../types/tripBuilder";

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
