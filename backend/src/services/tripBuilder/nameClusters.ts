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
import type { Bbox, CityCluster, ExistingTitle } from "./types";

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
