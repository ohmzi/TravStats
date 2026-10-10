/**
 * Surgery on one area's station chain (spec §C.10, §G): the stations in travel
 * order and the legs between them, kept in step.
 *
 * `legs[i]` always joins `stations[i]` to `stations[i + 1]` (contract C.1). Every
 * function here takes a chain and returns a new one, or null when the change is
 * not one the review page allows; none mutates its argument. Pure and free of
 * React, so the reducer and its tests stay small.
 */
import type { NightAssign, NightPlanStation } from "../../shared/tour/builderNightPlan";
import { greatCircleKm } from "../../shared/flightDuration";
import type {
  BuilderLegMode,
  DraftLeg,
  DraftStation,
  FerryEvidence,
} from "../../types/tripBuilder";

/** Thumbnails per station card (`PREVIEWS_PER_STATION` of the server's thresholds). */
export const MAX_STATION_PREVIEWS = 6;

/** The return from an excursion counts as the same place when it is this close (`CITY_LINK_KM` of the server's thresholds). */
const SAME_PLACE_KM = 30;

export interface Chain {
  stations: DraftStation[];
  legs: DraftLeg[];
}

type Point = Pick<DraftStation, "lat" | "lon">;

/** Straight-line km between two stations, to a tenth: what a leg without a route shows. */
export function chordKmBetween(a: Point, b: Point): number {
  return Math.round(greatCircleKm(a.lat, a.lon, b.lat, b.lon) * 10) / 10;
}

/** A leg the reviewer made: straight, with no route yet. */
export function straightLeg(
  from: DraftStation,
  to: DraftStation,
  mode: BuilderLegMode = "road",
  evidence: FerryEvidence | null = null
): DraftLeg {
  return {
    fromKey: from.key,
    toKey: to.key,
    chordKm: chordKmBetween(from, to),
    routedKm: null,
    mode,
    ferryEvidence: mode === "ferry" ? evidence : null,
  };
}

/** True when every leg joins the two stations it sits between. */
export function legsFitStations(chain: Chain): boolean {
  return (
    chain.legs.length === Math.max(0, chain.stations.length - 1) &&
    chain.legs.every(
      (leg, i) => leg.fromKey === chain.stations[i].key && leg.toKey === chain.stations[i + 1].key
    )
  );
}

/** What the night plan needs of a station. */
export function toPlanStation(
  station: Pick<DraftStation, "key" | "title" | "lat" | "lon" | "firstDay" | "lastDay"> & {
    notes?: string | null;
  }
): NightPlanStation {
  return {
    key: station.key,
    title: station.title,
    lat: station.lat,
    lon: station.lon,
    firstDay: station.firstDay,
    lastDay: station.lastDay,
    notes: station.notes,
  };
}

/** The note a scan pre-fills (mirror of `defaultStationNotes` in the server's `stations.ts`). */
export function defaultStationNotes(
  station: Pick<DraftStation, "firstLocal" | "lastLocal" | "photoCount">
): string | null {
  if (!station.firstLocal || !station.lastLocal) return null;
  const photos = station.photoCount === 1 ? "1 photo" : `${station.photoCount} photos`;
  return `First photo ${station.firstLocal.slice(11, 16)} · last ${station.lastLocal.slice(11, 16)} · ${photos}`;
}

const untouched = (station: DraftStation): boolean =>
  station.notes === null || station.notes === defaultStationNotes(station);

const WITH_PHOTOS: ReadonlySet<DraftStation["kind"]> = new Set(["visit", "brief", "dayTrip"]);

function mergedKind(a: DraftStation["kind"], b: DraftStation["kind"]): DraftStation["kind"] {
  if (a === "visit" || b === "visit") return "visit";
  if (a === "brief" || b === "brief") return "brief";
  return "dayTrip";
}

/** `first` followed by `second` as one stop, under `first`'s key, title and place. */
function absorb(first: DraftStation, second: DraftStation): DraftStation {
  const kind = mergedKind(first.kind, second.kind);
  const { excursionOf, ...rest } = first;
  const joined: DraftStation = {
    ...rest,
    kind,
    firstDay: first.firstDay < second.firstDay ? first.firstDay : second.firstDay,
    lastDay: second.lastDay > first.lastDay ? second.lastDay : first.lastDay,
    lastLocal: second.lastLocal ?? first.lastLocal,
    photoCount: first.photoCount + second.photoCount,
    previewIdx: [...new Set([...first.previewIdx, ...second.previewIdx])].slice(
      0,
      MAX_STATION_PREVIEWS
    ),
    ...(kind === "dayTrip" && excursionOf !== undefined ? { excursionOf } : {}),
  };
  if (untouched(first) && untouched(second)) {
    joined.notes = defaultStationNotes(joined);
  } else {
    joined.notes = untouched(first) ? second.notes : first.notes;
  }
  return joined;
}

/** A station's key was replaced: every excursion that named it as its base now names `to`. */
function repointExcursions(stations: DraftStation[], from: string, to: string | null): void {
  stations.forEach((station, i) => {
    if (station.excursionOf !== from) return;
    const { excursionOf: _base, ...rest } = station;
    stations[i] = to === null ? rest : { ...rest, excursionOf: to };
  });
}

/** The leg that left an absorbed station, now leaving `joined` for the station after it. */
function onwardLeg(
  leg: DraftLeg | undefined,
  joined: DraftStation,
  following: DraftStation | undefined
): DraftLeg[] {
  if (leg === undefined || following === undefined) return [];
  return [
    { ...leg, fromKey: joined.key, chordKm: chordKmBetween(joined, following), routedKm: null },
  ];
}

/**
 * Takes the station at `index` out. Its two legs become one straight leg between
 * its neighbours, and that leg is a ferry when either of the two was: the
 * crossing is still somewhere on the way.
 */
export function removeStationAt(chain: Chain, index: number): Chain | null {
  const { stations, legs } = chain;
  if (index < 0 || index >= stations.length) return null;
  const removed = stations[index];
  const nextStations = [...stations.slice(0, index), ...stations.slice(index + 1)];
  repointExcursions(nextStations, removed.key, null);
  let nextLegs: DraftLeg[];
  if (index === 0) {
    nextLegs = legs.slice(1);
  } else if (index === stations.length - 1) {
    nextLegs = legs.slice(0, -1);
  } else {
    const before = legs[index - 1];
    const after = legs[index];
    const ferry = before.mode === "ferry" ? before : after.mode === "ferry" ? after : null;
    const bridge = straightLeg(
      stations[index - 1],
      stations[index + 1],
      ferry === null ? "road" : "ferry",
      ferry?.ferryEvidence ?? null
    );
    nextLegs = [...legs.slice(0, index - 1), bridge, ...legs.slice(index + 1)];
  }
  return { stations: nextStations, legs: nextLegs };
}

/**
 * The station at `index` and the one after it become one stop. Both must be
 * places with photos: a home or an airport anchor is never joined to a city.
 */
export function mergeWithNext(chain: Chain, index: number): Chain | null {
  const { stations, legs } = chain;
  if (index < 0 || index + 1 >= stations.length) return null;
  const first = stations[index];
  const second = stations[index + 1];
  if (!WITH_PHOTOS.has(first.kind) || !WITH_PHOTOS.has(second.kind)) return null;
  const joined = absorb(first, second);
  const nextStations = [...stations.slice(0, index), joined, ...stations.slice(index + 2)];
  repointExcursions(nextStations, second.key, joined.key);
  const nextLegs = [
    ...legs.slice(0, index),
    ...onwardLeg(legs[index + 1], joined, stations[index + 2]),
    ...legs.slice(index + 2),
  ];
  return { stations: nextStations, legs: nextLegs };
}

export interface Fold {
  chain: Chain;
  /** The station that took the return in; the night answers of `dropped` move to it. */
  into: string;
  dropped: string[];
}

/**
 * The excursion at `index` is folded away: it comes out, and the stop the
 * traveller returned to is taken into the one they left from. Only for the shape
 * the scan makes: base, excursion, return, side by side, the return within a
 * city's reach of the base (a rename of either does not matter).
 */
export function foldDayTrip(chain: Chain, index: number): Fold | null {
  const { stations, legs } = chain;
  const trip = stations[index];
  if (trip === undefined || trip.kind !== "dayTrip" || index < 1) return null;
  const base = stations[index - 1];
  const back = stations[index + 1];
  if (base.key !== trip.excursionOf || back === undefined) return null;
  if (!WITH_PHOTOS.has(base.kind) || !WITH_PHOTOS.has(back.kind)) return null;
  if (back.kind === "dayTrip" || chordKmBetween(base, back) > SAME_PLACE_KM) return null;
  const joined = absorb(base, back);
  const nextStations = [...stations.slice(0, index - 1), joined, ...stations.slice(index + 2)];
  repointExcursions(nextStations, back.key, joined.key);
  const nextLegs = [
    ...legs.slice(0, index - 1),
    ...onwardLeg(legs[index + 1], joined, stations[index + 2]),
    ...legs.slice(index + 2),
  ];
  return {
    chain: { stations: nextStations, legs: nextLegs },
    into: joined.key,
    dropped: [trip.key, back.key],
  };
}

/** Puts the home station at the start or the end of the chain, joined to its neighbour by a road. */
export function addHomeAt(chain: Chain, end: "start" | "end", home: DraftStation): Chain | null {
  const { stations, legs } = chain;
  if (stations.some((station) => station.key === home.key)) return null;
  if (stations.length === 0) return { stations: [home], legs: [] };
  if (end === "start") {
    return { stations: [home, ...stations], legs: [straightLeg(home, stations[0]), ...legs] };
  }
  const last = stations[stations.length - 1];
  return { stations: [...stations, home], legs: [...legs, straightLeg(last, home)] };
}

/** Takes the home station off the start or the end of the chain; null when that end is not home. */
export function removeHomeAt(chain: Chain, end: "start" | "end"): Chain | null {
  const index = end === "start" ? 0 : chain.stations.length - 1;
  if (chain.stations[index]?.kind !== "home") return null;
  return removeStationAt(chain, index);
}

/** The answers of `nights`, with every one that names a station in `from` now naming `to`. */
export function repointNights(
  nights: Readonly<Record<string, NightAssign>>,
  from: readonly string[],
  to: NightAssign
): Record<string, NightAssign> {
  const moved = new Set(from);
  return Object.fromEntries(
    Object.entries(nights).map(([day, assign]) => [day, moved.has(assign) ? to : assign])
  );
}
