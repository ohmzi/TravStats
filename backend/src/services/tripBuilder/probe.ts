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
import { resolveRouteProvider } from "../tour/routing/resolveProvider";
import type { RouteProbe } from "../tour/routing/types";
import type { Coord } from "../tour/tourDistance";

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
