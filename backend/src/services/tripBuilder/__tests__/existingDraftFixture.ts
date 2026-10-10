/**
 * A derived draft for the Northvale loop fixture (Task 148): the photos show
 * Northvale, Port Carrow, Southbridge and Tarnside, in that order.
 *
 *   Northvale   5/2–5/3   nights 5/2, 5/3          → row 5/2–5/4 slept   (stored A: same)
 *   Port Carrow 5/4       night 5/4                → row 5/4–5/5 slept   (stored B: changed)
 *   Southbridge 5/5–5/6   night 5/5                → row 5/5–5/6 slept   (new)
 *   Tarnside    5/7–5/9   nights unknown           → row 5/7–5/9 pass    (stored S, a stay: same)
 *   Kelmore (stored C) is not in the photos.
 */
import type { DraftArea, DraftFlight, DraftStation, NightEntry, TripBuilderDraft } from "../types";

export const K = {
  northvale: "-901|3374|2031-05-02",
  portCarrow: "-894|3383|2031-05-04",
  southbridge: "-909|3382|2031-05-05",
  tarnside: "-904|3388|2031-05-07",
} as const;

const AT = {
  northvale: { lat: -45.05, lon: 168.7 },
  portCarrow: { lat: -44.7, lon: 169.15 },
  southbridge: { lat: -45.45, lon: 169.1 },
  tarnside: { lat: -45.2, lon: 169.4 },
} as const;

export function derivedStation(
  key: string,
  title: string,
  at: { lat: number; lon: number },
  firstDay: string,
  lastDay: string,
  over: Partial<DraftStation> = {}
): DraftStation {
  return {
    key,
    title,
    titleSource: "geocode",
    kind: "visit",
    ...at,
    snappedKm: null,
    firstDay,
    lastDay,
    firstLocal: `${firstDay} 09:10`,
    lastLocal: `${lastDay} 17:40`,
    photoCount: 12,
    previewIdx: [0],
    notes: "First photo 09:10 · last 17:40 · 12 photos",
    ...over,
  };
}

export function derivedStations(): DraftStation[] {
  return [
    derivedStation(K.northvale, "Northvale", AT.northvale, "2031-05-02", "2031-05-03"),
    derivedStation(K.portCarrow, "Port Carrow", AT.portCarrow, "2031-05-04", "2031-05-04"),
    derivedStation(K.southbridge, "Southbridge", AT.southbridge, "2031-05-05", "2031-05-06"),
    derivedStation(K.tarnside, "Tarnside", AT.tarnside, "2031-05-07", "2031-05-09"),
  ];
}

const night = (assign: string): NightEntry => ({
  assign,
  reason: "lastPhoto",
  suggestedStationKeys: [],
});

export const NIGHTS: Record<string, NightEntry> = {
  "2031-05-02": night(K.northvale),
  "2031-05-03": night(K.northvale),
  "2031-05-04": night(K.portCarrow),
  "2031-05-05": night(K.southbridge),
  "2031-05-06": night("unknown"),
  "2031-05-07": night("unknown"),
  "2031-05-08": night("unknown"),
};

export function area(over: Partial<DraftArea> = {}): DraftArea {
  const stations = over.stations ?? derivedStations();
  return {
    key: "2031-05-02#1",
    defaultAs: "roadtrip",
    suggestedName: "Northvale loop",
    mainCity: "Northvale",
    startDay: "2031-05-02",
    endDay: "2031-05-09",
    home: {
      start: { offered: false, defaultOn: false },
      end: { offered: false, defaultOn: false },
      unconfirmed: false,
    },
    stations,
    legs: stations.slice(1).map((s, i) => ({
      fromKey: stations[i].key,
      toKey: s.key,
      chordKm: 40,
      routedKm: null,
      mode: s.key === K.tarnside ? "ferry" : "road",
      ferryEvidence: s.key === K.tarnside ? "seaPhotos" : null,
    })),
    ...over,
  };
}

export function flight(over: Partial<DraftFlight> = {}): DraftFlight {
  return {
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    label: "ZZ101 ZZA→ZZB",
    depIata: "ZZA",
    arrIata: "ZZB",
    depLocal: "2031-05-02 07:00",
    arrLocal: "2031-05-02 08:40",
    precise: true,
    currentTrip: null,
    defaultAssign: false,
    locked: false,
    ...over,
  };
}

export function draft(
  tripId: string,
  areas: DraftArea[] = [area()],
  over: Partial<TripBuilderDraft> = {}
): TripBuilderDraft {
  return {
    id: "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
    expiresAt: "2031-05-10T14:00:00.000Z",
    window: {
      startDay: "2031-05-02",
      endDay: "2031-05-09",
      checkedFrom: "2031-04-29",
      checkedTo: "2031-05-12",
    },
    options: { inspect: true, createAlbum: false },
    target: { kind: "existing", tripId, tripName: "Northvale loop" },
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
    nights: NIGHTS,
    areas,
    photoJourneys: [],
    album: null,
    warnings: [],
    ...over,
  };
}
