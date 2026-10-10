/**
 * Hand-built inputs for the night tests. Everything here is synthetic (the
 * repository is public): invented towns around 45°S 168°E, years from 2031.
 *
 * Distances the tests lean on: Northvale to Port Carrow is 214 km, so a drive
 * between them can be a night drive; Northvale to the roadside is 110 km, too
 * short for one; Kelmore, the invented residence, is 356 km from Northvale and
 * its airport is 10 km from it.
 */
import type {
  AreaHome,
  AreaPlan,
  FlightAnchor,
  GroundArea,
  HomeAtDay,
  NightInputs,
  PhotoPoint,
  PlanLeg,
  PlanStation,
  ScanWindow,
  StationKind,
  StationSpan,
} from "../types";

export interface Place {
  lat: number;
  lon: number;
}

export const KELMORE: Place = { lat: -43.53, lon: 172.64 };
export const KELMORE_AIRPORT: Place = { lat: -43.49, lon: 172.53 };
export const NORTHVALE: Place = { lat: -45.05, lon: 168.7 };
export const NORTHVALE_AIRPORT: Place = { lat: -45.02, lon: 168.74 };
export const PORT_CARROW: Place = { lat: -44.4, lon: 171.25 };
/** On the road between Northvale and Port Carrow, belonging to neither. */
export const ROADSIDE: Place = { lat: -44.7, lon: 170.0 };
/** Out on the strait between Northvale and Port Carrow. */
export const STRAIT: Place = { lat: -44.75, lon: 170.2 };

export const KEY_KELMORE = "-871|3453|2031-05-02";
export const KEY_NORTHVALE = "-901|3374|2031-05-02";
export const KEY_PORT_CARROW = "-888|3425|2031-05-04";

const HOUR_MS = 3_600_000;

/** `YYYY-MM-DD HH:MM` read as a UTC instant: the fixtures keep every clock on UTC. */
export function utc(local: string): number {
  return Date.parse(`${local.replace(" ", "T")}:00Z`);
}

/** A photo at `local` (on a UTC clock) at `at`; null is an unlocated one. */
export function photo(
  id: string,
  local: string,
  at: Place | null,
  over: { atSea?: boolean } = {}
): PhotoPoint {
  const tMs = utc(local);
  return {
    id,
    type: "IMAGE",
    ownerId: "owner-1",
    visibility: "timeline",
    tMs,
    zone: "UTC",
    local,
    day: local.slice(0, 10),
    nightDay: new Date(tMs - 4 * HOUR_MS).toISOString().slice(0, 10),
    lat: at?.lat ?? null,
    lon: at?.lon ?? null,
    city: null,
    state: null,
    country: null,
    make: null,
    model: null,
    originalFileName: `${id}.jpg`,
    isFavorite: false,
    duplicateId: null,
    flags: {
      clockCase: "A",
      zoneSource: "gps",
      dayGuessed: false,
      exifZoneOverridden: false,
      located: at !== null,
      duplicate: false,
      misdated: null,
      atSea: over.atSea ?? false,
      inFlight: false,
      layover: false,
    },
  };
}

export function station(
  key: string,
  title: string,
  at: Place,
  firstDay: string,
  lastDay: string,
  kind: StationKind = "visit",
  over: Partial<PlanStation> = {}
): PlanStation {
  return {
    key,
    title,
    titleSource: "immich",
    kind,
    lat: at.lat,
    lon: at.lon,
    snappedKm: null,
    firstDay,
    lastDay,
    firstLocal: null,
    lastLocal: null,
    photoCount: 10,
    previewIdx: [],
    notes: null,
    ...over,
  };
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

const NO_HOME_END = { offered: false, defaultOn: false };
const NO_HOME: AreaHome = { start: NO_HOME_END, end: NO_HOME_END, unconfirmed: false };

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
  const ground: GroundArea = {
    photoIds: spec.photos.map((p) => p.id),
    seaPhotoIds: (spec.sea ?? []).map((p) => p.id),
    afterFlightId: spec.afterFlightId ?? null,
    beforeFlightId: spec.beforeFlightId ?? null,
    startMs: Math.min(...all),
    endMs: Math.max(...all),
    startDay: spec.startDay,
    endDay: spec.endDay,
  };
  const plan: AreaPlan = {
    key: spec.key ?? `${spec.startDay}#1`,
    area: ground,
    segments: [],
    stations: spec.stations,
    photoStation: new Map(Object.entries(spec.placeOf)),
    stationCluster: new Map(),
    spanMs,
    previewPhotoIds: new Map(),
    passedThrough: new Map(),
    legs: spec.legs ?? [],
    home: NO_HOME,
  };
  return { plan, photos: [...spec.photos, ...(spec.sea ?? [])] };
}

/** A flight on day granularity: no instants, no clocks, unless `over` says so. */
export function flight(id: string, over: Partial<FlightAnchor> = {}): FlightAnchor {
  return {
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
    hasActualDep: false,
    hasActualArr: false,
    tripId: null,
    tripName: null,
    listed: true,
    defaultAssign: true,
    locked: false,
    ...over,
  };
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

export const KELMORE_HOME: HomeAtDay = {
  name: "Kelmore, Westshire",
  lat: KELMORE.lat,
  lon: KELMORE.lon,
  confirmed: true,
  zone: "UTC",
  airports: new Set(["ZKE"]),
};

export function scanWindow(startDay: string, endDay: string): ScanWindow {
  return {
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
