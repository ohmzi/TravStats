import type {
  AreaHome,
  AreaPlan,
  FlightAnchor,
  GroundArea,
  HomeAtDay,
  PlanStation,
  ScanWindow,
} from "../types";
import { KELMORE, NORTHVALE } from "./placeFixtures";

/** The window every plan-level test scans: 2 to 9 May 2031. */
export const WINDOW: ScanWindow = {
  startDay: "2031-05-02",
  endDay: "2031-05-09",
  contextFromDay: "2031-04-29",
  contextToDay: "2031-05-12",
  fetchFrom: new Date("2031-04-28T10:00:00Z"),
  fetchTo: new Date("2031-05-13T12:00:00Z"),
};

/** "Kelmore, Westshire": a confirmed residence with one home airport. */
export const HOME: HomeAtDay = {
  name: "Kelmore, Westshire",
  lat: KELMORE.lat,
  lon: KELMORE.lon,
  confirmed: true,
  zone: "Pacific/Auckland",
  airports: new Set(["KMR"]),
};

/** An area with neither home end offered. */
export const noHome = (): AreaHome => ({
  start: { offered: false, defaultOn: false },
  end: { offered: false, defaultOn: false },
  unconfirmed: false,
});

/** ZZ101 from Kelmore (KMR) to Northvale (NVL), the morning of 2 May. */
export function anchor(overrides: Partial<FlightAnchor> = {}): FlightAnchor {
  return {
    id: "f1",
    label: "ZZ101 KMR→NVL",
    depIata: "KMR",
    arrIata: "NVL",
    dep: { lat: -43.49, lon: 172.53 },
    arr: { lat: -45.02, lon: 168.74 },
    depZone: "Pacific/Auckland",
    arrZone: "Pacific/Auckland",
    depDay: "2031-05-02",
    arrDay: "2031-05-02",
    depClock: "08:30",
    arrClock: "10:05",
    precise: true,
    depMs: Date.parse("2031-05-01T20:30:00Z"),
    arrMs: Date.parse("2031-05-01T22:05:00Z"),
    hasActualDep: false,
    hasActualArr: false,
    tripId: null,
    tripName: null,
    listed: true,
    defaultAssign: true,
    locked: false,
    ...overrides,
  };
}

export function groundArea(overrides: Partial<GroundArea> = {}): GroundArea {
  return {
    photoIds: [],
    seaPhotoIds: [],
    afterFlightId: null,
    beforeFlightId: null,
    startMs: 0,
    endMs: 0,
    startDay: "2031-05-02",
    endDay: "2031-05-09",
    ...overrides,
  };
}

/** A visit at Northvale, 10 photos over 2 and 3 May. */
export function station(key: string, overrides: Partial<PlanStation> = {}): PlanStation {
  return {
    key,
    title: "Northvale",
    titleSource: "immich",
    kind: "visit",
    lat: NORTHVALE.lat,
    lon: NORTHVALE.lon,
    snappedKm: null,
    firstDay: "2031-05-02",
    lastDay: "2031-05-03",
    firstLocal: "2031-05-02 10:00",
    lastLocal: "2031-05-03 09:00",
    photoCount: 10,
    previewIdx: [],
    notes: null,
    ...overrides,
  };
}

/** An area plan holding `stations`, with no legs, maps or home ends unless overridden. */
export function planOf(stations: PlanStation[], overrides: Partial<AreaPlan> = {}): AreaPlan {
  return {
    key: "2031-05-02#1",
    area: groundArea(),
    segments: [],
    legs: [],
    home: noHome(),
    stations,
    photoStation: new Map(),
    stationCluster: new Map(),
    spanMs: new Map(),
    previewPhotoIds: new Map(),
    passedThrough: new Map(),
    ...overrides,
  };
}
