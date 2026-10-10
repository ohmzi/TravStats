import type { LocalMinute, PhotoPoint } from "../types";
import { makePhoto, type PhotoInput } from "./photoFixtures";

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
