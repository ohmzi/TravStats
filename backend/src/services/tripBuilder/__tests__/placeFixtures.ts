import type { LocalMinute, PhotoPoint } from "../types";
import { makePhoto, NORTHVALE, type PhotoInput } from "./photoFixtures";

/**
 * Synthetic places for the city-cluster tests (public repository: invented
 * names, no real itinerary). Northvale and Port Carrow are `photoFixtures`'
 * own, re-exported so one test file can import every place from here; the
 * clock is NZST (UTC+12), which holds all of May to September.
 */
export { NORTHVALE, PORT_CARROW } from "./photoFixtures";

/** "Kelmore, Westshire": the invented home town, about 355 km from Northvale. */
export const KELMORE = { lat: -43.53, lon: 172.64 } as const;

/**
 * One photo taken at `local` (NZST) at `at`, built on `makePhoto`. Unlike
 * `makePhoto` it carries no Immich city or state unless `overrides` gives
 * them, and it is `located` exactly when both coordinates are present.
 */
export function photo(
  id: string,
  local: LocalMinute,
  at: { lat: number | null; lon: number | null },
  overrides: PhotoInput = {}
): PhotoPoint {
  const { flags, ...rest } = overrides;
  return makePhoto({
    id,
    local,
    lat: at.lat,
    lon: at.lon,
    city: null,
    state: null,
    flags: { located: at.lat !== null && at.lon !== null, ...flags },
    ...rest,
  });
}

/** One step of a walk: a photo id, when it was taken, and the city cluster it falls in. */
export type Step = readonly [id: string, local: LocalMinute, clusterId: string];

/** Photos at the steps (all at Northvale's coordinates), and the cluster each one belongs to. */
export function walk(steps: readonly Step[]): {
  photos: PhotoPoint[];
  clusterOf: Map<string, string>;
  byId: Map<string, PhotoPoint>;
} {
  const photos = steps.map(([id, local]) => photo(id, local, NORTHVALE));
  return {
    photos,
    clusterOf: new Map(steps.map(([id, , clusterId]) => [id, clusterId] as const)),
    byId: new Map(photos.map((p) => [p.id, p] as const)),
  };
}
