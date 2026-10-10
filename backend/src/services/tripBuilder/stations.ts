/**
 * Stations (spec 2026-10-09 §C.9): the places a trip stopped, one per segment
 * worth a stop, with the facts the review page shows.
 *
 * A station's key is `round(lat/0.05)|round(lon/0.05)|firstDay` of the median
 * of its photos *as taken* and the day of the first one, so it survives a
 * re-scan, a snap onto the road and the after-landing pull of its first day.
 * A repeat of a key gets `~2`, `~3` … from one `taken` set per scan.
 */
import { PREVIEWS_PER_STATION, STATION_KEY_GRID_DEG } from "./thresholds";
import type { Day, DraftStation, PhotoPoint } from "./types";

/** `round(lat/0.05)|round(lon/0.05)|firstDay`: the station's identity across re-scans. */
export function stationKeyOf(lat: number, lon: number, firstDay: Day): string {
  return `${Math.round(lat / STATION_KEY_GRID_DEG)}|${Math.round(lon / STATION_KEY_GRID_DEG)}|${firstDay}`;
}

/** `base`, or `base~2`, `base~3` … when taken; the key returned is added to `taken`. */
export function claimKey(base: string, taken: Set<string>): string {
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}~${n}`;
  taken.add(key);
  return key;
}

/** `count` items spread evenly through `items`, in order. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return [...items];
  return Array.from(
    { length: count },
    (_, i) => items[Math.floor(((i + 0.5) * items.length) / count)]
  );
}

/** Up to `max` photo ids for a station's thumbnails: favourites first, then an even spread. */
export function pickPreviewIds(
  photos: readonly PhotoPoint[],
  max: number = PREVIEWS_PER_STATION
): string[] {
  const ordered = [...photos].sort((a, b) => a.tMs - b.tMs);
  const favourites = spread(
    ordered.filter((photo) => photo.isFavorite),
    max
  );
  const others = spread(
    ordered.filter((photo) => !photo.isFavorite),
    max - favourites.length
  );
  return [...favourites, ...others].map((photo) => photo.id);
}

/** "First photo 16:00 · last 08:00 · 3 photos", or null for a station with no photos of its own. */
export function defaultStationNotes(
  station: Pick<DraftStation, "firstLocal" | "lastLocal" | "photoCount">
): string | null {
  if (!station.firstLocal || !station.lastLocal) return null;
  const photos = station.photoCount === 1 ? "1 photo" : `${station.photoCount} photos`;
  return `First photo ${station.firstLocal.slice(11, 16)} · last ${station.lastLocal.slice(11, 16)} · ${photos}`;
}
