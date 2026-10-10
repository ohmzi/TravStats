/**
 * Hand-built inputs for the night tests. Everything here is synthetic (the
 * repository is public): invented towns around 45°S 168°E, years from 2031.
 *
 * The photo, the station, the flight, the area and the residence are the test
 * tree's own builders (`placeFixtures`, `planFixtures`, `photoFixtures`) with
 * only what the night rules vary set on top, so a change to `PhotoPoint`,
 * `PlanStation`, `FlightAnchor` or `AreaPlan` is still made once. What lives
 * here is what no other fixture file has: the places the night rules measure
 * against, the clock (every time here reads UTC, so a flight's instants and a
 * photo's compare directly), the `area()` assembly with its `photoStation` and
 * `spanMs` maps, and `nightInputs`.
 *
 * Distances the tests lean on: Northvale to Eastmere is 214 km, so a drive
 * between them can be a night drive; Northvale to the roadside is 110 km, too
 * short for one; Kelmore, the invented residence, is 356 km from Northvale and
 * its airport is 10 km from it. Eastmere is not `photoFixtures`' Port Carrow,
 * which is 50 km from Northvale.
 */
import type { Coord } from "../../tour/tourDistance";
import type {
  AreaPlan,
  FlightAnchor,
  HomeAtDay,
  NightInputs,
  PhotoPoint,
  PlanLeg,
  PlanStation,
  ScanWindow,
  StationKind,
  StationSpan,
} from "../types";
import { makeAnchor, msAt } from "./photoFixtures";
import { KELMORE, NORTHVALE, photo as placePhoto } from "./placeFixtures";
import { groundArea, HOME, planOf, station as planStation, WINDOW } from "./planFixtures";

export type Place = Coord;

export { KELMORE, NORTHVALE };
export const KELMORE_AIRPORT: Place = { lat: -43.49, lon: 172.53 };
export const NORTHVALE_AIRPORT: Place = { lat: -45.02, lon: 168.74 };
/** 214 km from Northvale (`photoFixtures`' Port Carrow is 50 km from it). */
export const EASTMERE: Place = { lat: -44.4, lon: 171.25 };
/** On the road between Northvale and Eastmere, belonging to neither. */
export const ROADSIDE: Place = { lat: -44.7, lon: 170.0 };
/** Out on the strait between Northvale and Eastmere. */
export const STRAIT: Place = { lat: -44.75, lon: 170.2 };

export const KEY_KELMORE = "-871|3453|2031-05-02";
export const KEY_NORTHVALE = "-901|3374|2031-05-02";
export const KEY_EASTMERE = "-888|3425|2031-05-04";

/** `YYYY-MM-DD HH:MM` read as a UTC instant: the fixtures keep every clock on UTC. */
export function utc(local: string): number {
  return msAt(local, 0);
}

/** A photo at `local` (on a UTC clock) at `at`; null is an unlocated one. */
export function photo(
  id: string,
  local: string,
  at: Place | null,
  over: { atSea?: boolean } = {}
): PhotoPoint {
  return placePhoto(id, local, at ?? { lat: null, lon: null }, {
    tMs: utc(local),
    zone: "UTC",
    flags: { atSea: over.atSea ?? false },
  });
}

/** A station at `at` whose days are known and whose clock minutes are not. */
export function station(
  key: string,
  title: string,
  at: Place,
  firstDay: string,
  lastDay: string,
  kind: StationKind = "visit",
  over: Partial<PlanStation> = {}
): PlanStation {
  return planStation(key, {
    title,
    kind,
    lat: at.lat,
    lon: at.lon,
    firstDay,
    lastDay,
    firstLocal: null,
    lastLocal: null,
    ...over,
  });
}

export function leg(fromKey: string, toKey: string, mode: "road" | "ferry" = "road"): PlanLeg {
  return {
    fromKey,
    toKey,
    chordKm: 100,
    routedKm: null,
    mode,
    ferryEvidence: mode === "ferry" ? "router" : null,
  };
}

export interface AreaSpec {
  startDay: string;
  endDay: string;
  stations: PlanStation[];
  /** The movement photos of the area. */
  photos: PhotoPoint[];
  /** The at-sea photos of the area. */
  sea?: PhotoPoint[];
  /** Photo id → station key (or `home`), as `buildStations` hands it over. */
  placeOf: Record<string, string>;
  legs?: PlanLeg[];
  key?: string;
  afterFlightId?: string;
  beforeFlightId?: string;
}

export interface AreaFixture {
  plan: AreaPlan;
  photos: PhotoPoint[];
}

export function area(spec: AreaSpec): AreaFixture {
  const times = new Map(spec.photos.map((p) => [p.id, p.tMs] as const));
  const spanMs = new Map<string, StationSpan>();
  for (const [id, key] of Object.entries(spec.placeOf)) {
    const tMs = times.get(id);
    if (tMs === undefined || key === "home") continue;
    const seen = spanMs.get(key);
    spanMs.set(key, {
      firstMs: Math.min(seen?.firstMs ?? tMs, tMs),
      lastMs: Math.max(seen?.lastMs ?? tMs, tMs),
    });
  }
  const all = [...times.values()];
  const plan = planOf(spec.stations, {
    key: spec.key ?? `${spec.startDay}#1`,
    area: groundArea({
      photoIds: spec.photos.map((p) => p.id),
      seaPhotoIds: (spec.sea ?? []).map((p) => p.id),
      afterFlightId: spec.afterFlightId ?? null,
      beforeFlightId: spec.beforeFlightId ?? null,
      startMs: Math.min(...all),
      endMs: Math.max(...all),
      startDay: spec.startDay,
      endDay: spec.endDay,
    }),
    photoStation: new Map(Object.entries(spec.placeOf)),
    spanMs,
    legs: spec.legs ?? [],
  });
  return { plan, photos: [...spec.photos, ...(spec.sea ?? [])] };
}

/** Flight ZZ101 on day granularity: no instants, no clocks, unless `over` says so. */
export function flight(id: string, over: Partial<FlightAnchor> = {}): FlightAnchor {
  return makeAnchor({
    id,
    label: "ZZ101 ZKE→ZNV",
    depIata: "ZKE",
    arrIata: "ZNV",
    dep: KELMORE_AIRPORT,
    arr: NORTHVALE_AIRPORT,
    depZone: "UTC",
    arrZone: "UTC",
    depDay: "2031-05-02",
    arrDay: "2031-05-02",
    depClock: null,
    arrClock: null,
    precise: false,
    depMs: null,
    arrMs: null,
    ...over,
  });
}

/** A flight with exact instants, given as `YYYY-MM-DD HH:MM` on a UTC clock. */
export function preciseFlight(
  id: string,
  dep: string,
  arr: string,
  over: Partial<FlightAnchor> = {}
): FlightAnchor {
  return flight(id, {
    precise: true,
    depMs: utc(dep),
    arrMs: utc(arr),
    depDay: dep.slice(0, 10),
    arrDay: arr.slice(0, 10),
    depClock: dep.slice(11, 16),
    arrClock: arr.slice(11, 16),
    ...over,
  });
}

/** The residence of `planFixtures`, on a UTC clock and with the airport the fixture flights leave from. */
export const KELMORE_HOME: HomeAtDay = { ...HOME, zone: "UTC", airports: new Set(["ZKE"]) };

export function scanWindow(startDay: string, endDay: string): ScanWindow {
  return {
    ...WINDOW,
    startDay,
    endDay,
    contextFromDay: startDay,
    contextToDay: endDay,
    fetchFrom: new Date(utc(`${startDay} 00:00`)),
    fetchTo: new Date(utc(`${endDay} 00:00`)),
  };
}

/** Night inputs for the window S … E over the given areas; the residence is Kelmore unless `home` says otherwise. */
export function nightInputs(
  startDay: string,
  endDay: string,
  fixtures: readonly AreaFixture[],
  extra: { anchors?: FlightAnchor[]; home?: HomeAtDay | null } = {}
): NightInputs {
  const photosById = new Map<string, PhotoPoint>();
  for (const fixture of fixtures) {
    for (const p of fixture.photos) photosById.set(p.id, p);
  }
  const home = extra.home === undefined ? KELMORE_HOME : extra.home;
  return {
    window: scanWindow(startDay, endDay),
    areas: fixtures.map((fixture) => fixture.plan),
    photosById,
    anchors: extra.anchors ?? [],
    homeAt: () => home,
  };
}
