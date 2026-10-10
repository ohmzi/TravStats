/**
 * Naming the city clusters (spec 2026-10-09 §C.5).
 *
 * A station's title comes from the first source that has one:
 *
 *   1. a station title the user already has, within `TITLE_REUSE_KM` — which
 *      keeps "City, Province" spelled the way the rest of their roadtrips are;
 *   2. the city most of the cluster's photos carry from Immich;
 *   3. a Nominatim reverse geocode of the median, at most `MAX_GEOCODE_LOOKUPS`
 *      per scan and spent on the biggest clusters first;
 *   4. the coordinates to two decimals, flagged for a rename.
 *
 * The home cluster skips the geocoder and takes the residence's town. Two
 * clusters that end up with the same title more than `CITY_LINK_KM` apart are
 * told apart by their state ("Springfield, Westshire").
 */
import { prisma } from "../../db";
import type { GeocodeParts } from "../geo/nominatim";
import { distanceKm } from "../photoJourneys/cluster";
import { isHomeCluster } from "./home";
import { MAX_GEOCODE_LOOKUPS, TITLE_REUSE_KM } from "./thresholds";
import type {
  Bbox,
  CityCluster,
  ExistingTitle,
  HomeAtDay,
  NamedCluster,
  TitleSource,
} from "./types";

export interface NameClusterDeps {
  /** The user's roadtrip station titles near the clusters (`loadExistingTitles`). */
  existingTitles: readonly ExistingTitle[];
  /** `reverseGeocode` (services/geo/nominatim.ts): never throws, null when it has no answer. */
  reverseGeocode(lat: number, lon: number): Promise<GeocodeParts | null>;
  /** The residence on the first day of the window, or null without a home. */
  home: HomeAtDay | null;
}

const KM_PER_DEGREE = (Math.PI * 6371) / 180;
const MAX_BBOX_LATITUDE = 89.9;
/** An inverted box contains nothing, so a query on it is skipped. */
const EMPTY_BBOX: Bbox = { minLat: 1, maxLat: -1, minLon: 1, maxLon: -1 };
/** If a user has more stations than this inside one trip's box, the newest are kept. */
const MAX_EXISTING_TITLES = 5000;

/** The box holding every cluster median, `padKm` wider on each side. Empty for no clusters. */
export function bboxOf(clusters: readonly CityCluster[], padKm: number): Bbox {
  if (clusters.length === 0) return { ...EMPTY_BBOX };
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const { lat, lon } of clusters) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  const latPad = padKm / KM_PER_DEGREE;
  const widest = Math.min(Math.max(Math.abs(minLat), Math.abs(maxLat)) + latPad, MAX_BBOX_LATITUDE);
  const lonPad = padKm / (KM_PER_DEGREE * Math.cos((widest * Math.PI) / 180));
  return {
    minLat: Math.max(-90, minLat - latPad),
    maxLat: Math.min(90, maxLat + latPad),
    minLon: Math.max(-180, minLon - lonPad),
    maxLon: Math.min(180, maxLon + lonPad),
  };
}

/** The titles of the user's own roadtrip stations inside `bbox`, newest first. */
export async function loadExistingTitles(userId: string, bbox: Bbox): Promise<ExistingTitle[]> {
  if (bbox.minLat > bbox.maxLat || bbox.minLon > bbox.maxLon) return [];
  const stations = await prisma.tripStop.findMany({
    where: {
      route: { userId, kind: "roadtrip" },
      viaPoint: false,
      lat: { gte: bbox.minLat, lte: bbox.maxLat },
      lon: { gte: bbox.minLon, lte: bbox.maxLon },
    },
    select: { title: true, lat: true, lon: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_EXISTING_TITLES,
  });
  const titles: ExistingTitle[] = [];
  for (const { title, lat, lon } of stations) {
    const trimmed = title.trim();
    if (trimmed && lat !== null && lon !== null) titles.push({ title: trimmed, lat, lon });
  }
  return titles;
}

interface Title {
  text: string;
  source: TitleSource;
}

/** The nearest of the user's own titles within `TITLE_REUSE_KM`; the first wins a tie. */
function reusedTitle(cluster: CityCluster, existing: readonly ExistingTitle[]): Title | null {
  let nearest: ExistingTitle | null = null;
  let nearestKm = Infinity;
  for (const candidate of existing) {
    const km = distanceKm(cluster, candidate);
    if (km <= TITLE_REUSE_KM && km < nearestKm) {
      nearest = candidate;
      nearestKm = km;
    }
  }
  return nearest === null ? null : { text: nearest.title, source: "existing" };
}

function immichTitle(cluster: CityCluster): Title | null {
  const city = cluster.immichCity?.trim();
  return city ? { text: city, source: "immich" } : null;
}

/** "Kelmore, Westshire" → "Kelmore". */
function townOf(home: HomeAtDay): string {
  return home.name.split(",")[0].trim() || home.name.trim();
}

async function geocodedCity(deps: NameClusterDeps, cluster: CityCluster): Promise<string | null> {
  try {
    const parts = await deps.reverseGeocode(cluster.lat, cluster.lon);
    return parts?.city?.trim() || null;
  } catch {
    return null;
  }
}

/** The clusters with a title, in the order given. */
export async function nameClusters(
  clusters: readonly CityCluster[],
  deps: NameClusterDeps
): Promise<NamedCluster[]> {
  const titles = new Map<string, Title>();
  const isHome = new Map(
    clusters.map((cluster) => [cluster.id, isHomeCluster(cluster, deps.home)])
  );
  const unresolved: CityCluster[] = [];

  for (const cluster of clusters) {
    const known = reusedTitle(cluster, deps.existingTitles) ?? immichTitle(cluster);
    if (known) titles.set(cluster.id, known);
    else if (deps.home && isHome.get(cluster.id)) {
      titles.set(cluster.id, { text: townOf(deps.home), source: "home" });
    } else unresolved.push(cluster);
  }

  // The biggest clusters are the stops that matter when the lookups run out.
  const biggestFirst = [...unresolved].sort((a, b) => b.photoIds.length - a.photoIds.length);
  for (const cluster of biggestFirst.slice(0, MAX_GEOCODE_LOOKUPS)) {
    const city = await geocodedCity(deps, cluster);
    if (city) titles.set(cluster.id, { text: city, source: "geocode" });
  }

  return clusters.map((cluster) => {
    const title = titles.get(cluster.id) ?? {
      text: `${cluster.lat.toFixed(2)}, ${cluster.lon.toFixed(2)}`,
      source: "coords" as const,
    };
    return {
      ...cluster,
      title: title.text,
      titleSource: title.source,
      isHome: isHome.get(cluster.id) === true,
    };
  });
}
