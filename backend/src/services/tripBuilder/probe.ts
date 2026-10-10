/**
 * Asking the self-hosted road router about a scan's stations and legs
 * (spec 2026-10-09 §C.7).
 *
 * Only the custom OSRM can be asked: it is local and has no quota, which a
 * hosted provider's does not allow for dozens of questions per scan. With any
 * other provider, or none, the scan runs without road evidence; `RoadAccess`
 * says which, so the draft can warn `noRouting` or `cannotSnap` instead of
 * quietly drawing straight lines.
 */
import logger from "../../utils/logger";
import { distanceKm } from "../photoJourneys/cluster";
import { resolveRouteProvider } from "../tour/routing/resolveProvider";
import type { RouteProbe } from "../tour/routing/types";
import type { Coord } from "../tour/tourDistance";
import { PROBE_CONCURRENCY, SNAP_MAX_KM, SNAP_MIN_KM } from "./thresholds";
import type { PlanStation, StationKind } from "./types";

/** The two questions the builder asks of the road router. */
export interface RoadProbes {
  probe(a: Coord, b: Coord): Promise<RouteProbe | null>;
  snap(c: Coord): Promise<Coord | null>;
}

export interface RoadAccess {
  /** Some routing provider is configured and usable. */
  available: boolean;
  /** That provider is the self-hosted OSRM, which answers `probe` and `snap`. */
  canProbe: boolean;
  /** The two questions bound to that provider; null unless `canProbe`. */
  probes: RoadProbes | null;
}

const NO_ROADS: RoadAccess = { available: false, canProbe: false, probes: null };

/** What roads the scan can ask about for this user. Never throws. */
export async function resolveRoadProbes(userId: string): Promise<RoadAccess> {
  const provider = await resolveRouteProvider(userId).catch((err: unknown) => {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "trip builder could not resolve a routing provider; scanning without road evidence"
    );
    return null;
  });
  if (provider === null) return NO_ROADS;
  if (provider.id !== "custom" || !provider.probe || !provider.snap) {
    return { available: true, canProbe: false, probes: null };
  }
  return {
    available: true,
    canProbe: true,
    probes: {
      probe: async (a, b) => (await provider.probe?.(a, b)) ?? null,
      snap: async (c) => (await provider.snap?.(c)) ?? null,
    },
  };
}

/**
 * `fn` over `items`, at most `limit` at a time, results in input order. A
 * rejection rejects the whole map; the probes never throw, so none does.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(limit)), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/** Kinds whose coordinates are a photo median; an added airport or home station is exact. */
const SNAPPED_KINDS: ReadonlySet<StationKind> = new Set<StationKind>(["visit", "brief", "dayTrip"]);

/** One road question; a failure reads as "no answer" (the probes never throw, this is belt and braces). */
async function attempt<T>(ask: () => Promise<T | null>): Promise<T | null> {
  try {
    return await ask();
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "trip builder road probe failed"
    );
    return null;
  }
}

/**
 * Moves each photographed station onto the road. A median 0.9 to 10 km from
 * the nearest road is moved there (`snappedKm` says how far); one closer is
 * left alone; one further than 10 km, or one the router has no road for, is
 * left alone and reported in `noRoadData`. Without probes nothing moves and
 * nothing is reported: the draft warns `cannotSnap` instead.
 */
export async function snapStations(
  stations: readonly PlanStation[],
  probes: RoadProbes | null
): Promise<{ stations: PlanStation[]; noRoadData: string[] }> {
  if (probes === null) return { stations: [...stations], noRoadData: [] };
  const outcomes = await mapWithConcurrency(stations, PROBE_CONCURRENCY, async (station) => {
    if (!SNAPPED_KINDS.has(station.kind)) return { station, noRoad: false };
    const road = await attempt(() => probes.snap({ lat: station.lat, lon: station.lon }));
    if (road === null) return { station, noRoad: true };
    const movedKm = distanceKm(station, road);
    if (movedKm > SNAP_MAX_KM) return { station, noRoad: true };
    if (movedKm < SNAP_MIN_KM) return { station, noRoad: false };
    const snapped = {
      ...station,
      lat: road.lat,
      lon: road.lon,
      snappedKm: Math.round(movedKm * 100) / 100,
    };
    return { station: snapped, noRoad: false };
  });
  return {
    stations: outcomes.map((outcome) => outcome.station),
    noRoadData: outcomes.filter((outcome) => outcome.noRoad).map((outcome) => outcome.station.key),
  };
}

/** The router's answer for each leg `stations[i]` → `stations[i + 1]`; all null without probes. */
export async function probeLegs(
  stations: readonly PlanStation[],
  probes: RoadProbes | null
): Promise<Array<RouteProbe | null>> {
  const pairs = stations.slice(1).map((to, i) => [stations[i], to] as const);
  if (probes === null) return pairs.map(() => null);
  return mapWithConcurrency(pairs, PROBE_CONCURRENCY, ([from, to]) =>
    attempt(() => probes.probe(from, to))
  );
}

/**
 * The stations at either end of a leg the router found no route for, once
 * each and in order: the `noRoadData` that `snapStations` cannot see. Call it
 * only when probes were asked; without them every answer is null.
 */
export function stationsWithoutRoute(
  stations: readonly Pick<PlanStation, "key">[],
  probes: ReadonlyArray<RouteProbe | null>
): string[] {
  const keys = new Set<string>();
  probes.forEach((probe, i) => {
    if (probe !== null || !stations[i] || !stations[i + 1]) return;
    keys.add(stations[i].key);
    keys.add(stations[i + 1].key);
  });
  return [...keys];
}
