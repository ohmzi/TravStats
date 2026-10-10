/**
 * Stations (spec 2026-10-09 §C.9): the places a trip stopped, one per segment
 * worth a stop, with the facts the review page shows.
 *
 * A station's key is `round(lat/0.05)|round(lon/0.05)|firstDay` of the median
 * of its photos *as taken* and the day of the first one, so it survives a
 * re-scan, a snap onto the road and the after-landing pull of its first day.
 * A repeat of a key gets `~2`, `~3` … from one `taken` set per scan.
 */
import { medianPoint } from "./medians";
import { PREVIEWS_PER_STATION, STATION_KEY_GRID_DEG } from "./thresholds";
import { NIGHT_HOME } from "./types";
import type {
  Day,
  DraftStation,
  NamedCluster,
  PassedThrough,
  PhotoPoint,
  PlanStation,
  Segment,
  StationBuild,
  StationKind,
  StationSpan,
} from "./types";

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

export interface BuildStationsInput {
  segments: readonly Segment[];
  clusters: ReadonlyMap<string, NamedCluster>;
  photosById: ReadonlyMap<string, PhotoPoint>;
  taken: Set<string>;
}

const KIND_OF_ROLE: Record<Exclude<Segment["role"], "transit">, StationKind> = {
  visit: "visit",
  brief: "brief",
  excursion: "dayTrip",
};

/** The station of the nearest kept segment after `index`, else before it. */
function keptStationAround(
  segments: readonly Segment[],
  stationOfSegment: ReadonlyMap<string, string>,
  index: number
): string | undefined {
  for (let i = index + 1; i < segments.length; i++) {
    const key = stationOfSegment.get(segments[i].id);
    if (key !== undefined) return key;
  }
  for (let i = index - 1; i >= 0; i--) {
    const key = stationOfSegment.get(segments[i].id);
    if (key !== undefined) return key;
  }
  return undefined;
}

/**
 * One area's stations, in travel order. A visit or brief stop is a station, an
 * excursion a `dayTrip` station that names the station it left from, and
 * transit noise a "passed through" chip on its day. Every movement photo is
 * mapped to a station for the night rules: noise to the next kept station of
 * its area (else the previous one), and every photo of an area that is only
 * the home cluster to `NIGHT_HOME`.
 */
export function buildStations(input: BuildStationsInput): StationBuild {
  const stations: PlanStation[] = [];
  const photoStation = new Map<string, string>();
  const stationCluster = new Map<string, string>();
  const spanMs = new Map<string, StationSpan>();
  const previewPhotoIds = new Map<string, string[]>();
  const passedThrough = new Map<Day, PassedThrough[]>();
  const stationOfSegment = new Map<string, string>();

  for (const segment of input.segments) {
    const cluster = input.clusters.get(segment.clusterId);
    if (!cluster) {
      throw new Error(
        `Segment ${segment.id} is in cluster ${segment.clusterId}, which has no name`
      );
    }
    if (segment.role === "transit") {
      const chips = passedThrough.get(segment.firstDay) ?? [];
      chips.push({
        title: cluster.title,
        firstLocal: segment.firstLocal,
        photoCount: segment.photoIds.length,
      });
      passedThrough.set(segment.firstDay, chips);
      continue;
    }

    const photos = segment.photoIds.flatMap((id) => {
      const photo = input.photosById.get(id);
      return photo ? [photo] : [];
    });
    const located = photos.flatMap((photo) =>
      photo.lat !== null && photo.lon !== null ? [{ lat: photo.lat, lon: photo.lon }] : []
    );
    if (located.length === 0) throw new Error(`Segment ${segment.id} has no located photo`);

    const centre = medianPoint(located);
    const previous = stations[stations.length - 1];
    const key = claimKey(stationKeyOf(centre.lat, centre.lon, segment.firstDay), input.taken);
    stations.push({
      key,
      title: cluster.title,
      titleSource: cluster.titleSource,
      kind: KIND_OF_ROLE[segment.role],
      ...(segment.role === "excursion" && previous ? { excursionOf: previous.key } : {}),
      lat: centre.lat,
      lon: centre.lon,
      snappedKm: null,
      firstDay: segment.firstDay,
      lastDay: segment.lastDay,
      firstLocal: segment.firstLocal,
      lastLocal: segment.lastLocal,
      photoCount: photos.length,
      previewIdx: [],
      notes: defaultStationNotes({
        firstLocal: segment.firstLocal,
        lastLocal: segment.lastLocal,
        photoCount: photos.length,
      }),
    });
    stationOfSegment.set(segment.id, key);
    stationCluster.set(key, segment.clusterId);
    spanMs.set(key, { firstMs: segment.startMs, lastMs: segment.endMs });
    previewPhotoIds.set(key, pickPreviewIds(photos));
    for (const id of segment.photoIds) photoStation.set(id, key);
  }

  input.segments.forEach((segment, index) => {
    if (segment.role !== "transit") return;
    const key = keptStationAround(input.segments, stationOfSegment, index);
    if (key === undefined) return;
    for (const id of segment.photoIds) photoStation.set(id, key);
  });

  const homeOnly =
    stations.length > 0 &&
    stations.every(
      (station) => input.clusters.get(stationCluster.get(station.key) ?? "")?.isHome === true
    );
  if (homeOnly) {
    for (const id of [...photoStation.keys()]) photoStation.set(id, NIGHT_HOME);
  }

  return { stations, photoStation, stationCluster, spanMs, previewPhotoIds, passedThrough };
}
