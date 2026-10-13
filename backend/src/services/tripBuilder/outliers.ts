/**
 * The far outliers of one area (owner ruling 2026-10-13, "Sumayya's
 * wedding"): a small cluster of photos in a place the area was not at — a
 * stale camera fix, another device left behind, a picture taken somewhere
 * else. The owner's words: "clearly the flight is to a city and some pictures
 * are from there but some other picture or video are from another city,
 * clearly that doesn't make sense, so logic is to ignore them."
 *
 * A cluster is ignored when it holds LESS than `OUTLIER_MAX_SHARE` of the
 * area's located photos (a handful, not a stop) AND its centre lies farther
 * than `OUTLIER_MIN_KM` from the area's main cluster (the app's own "this
 * jump was flown, not driven" distance). It then shapes nothing: no segment,
 * no station, no leg, no night, and no implicit-flight gap — so it never
 * splits the area. A real drive's second stop is comparably sized, so the
 * share test keeps it, and an area with no far cluster comes back untouched.
 *
 * The ignored photos stay the trip's own everywhere else: they count in the
 * window's stats and in the album, exactly like the photos kept out of
 * movement for any other reason. Only the derivation does not see them, and
 * the review says so ("N photos sat far from the stay and were ignored").
 *
 * Pure: the area's movement photos and the window's clusters come in as
 * values.
 */
import { distanceKm } from "../photoJourneys/cluster";
import { OUTLIER_MAX_SHARE, OUTLIER_MIN_KM } from "./thresholds";
import type { CityCluster, PhotoPoint } from "./types";

export interface OutlierDrop {
  /** The area's photos minus every ignored cluster's, in their original order. */
  kept: PhotoPoint[];
  /** The ignored photos, in their original order. */
  dropped: PhotoPoint[];
}

/** The photos of one area grouped by cluster id, in the order the photos appear. */
function byCluster(
  members: readonly PhotoPoint[],
  clusterOf: ReadonlyMap<string, string>
): Map<string, PhotoPoint[]> {
  const groups = new Map<string, PhotoPoint[]>();
  for (const photo of members) {
    const id = clusterOf.get(photo.id);
    if (id === undefined) continue;
    const group = groups.get(id);
    if (group) group.push(photo);
    else groups.set(id, [photo]);
  }
  return groups;
}

/**
 * The area's main cluster: the one holding the most of its photos, ties going
 * to the one seen first — the same rule `mainCityOf` reads for names, so the
 * area's bulk is one answer everywhere. Null when the area has no clustered
 * photo at all.
 */
function mainClusterId(groups: ReadonlyMap<string, PhotoPoint[]>): string | null {
  let main: string | null = null;
  let most = -1;
  for (const [id, photos] of groups) {
    if (photos.length > most) {
      main = id;
      most = photos.length;
    }
  }
  return main;
}

/**
 * The area's photos without its far outliers. With fewer than two clusters,
 * or a main cluster nothing is far from, the input comes back unchanged.
 */
export function dropFarOutliers(
  members: readonly PhotoPoint[],
  clusterOf: ReadonlyMap<string, string>,
  clusterById: ReadonlyMap<string, CityCluster>
): OutlierDrop {
  const groups = byCluster(members, clusterOf);
  const mainId = groups.size < 2 ? null : mainClusterId(groups);
  const main = mainId === null ? undefined : clusterById.get(mainId);
  if (main === undefined) return { kept: [...members], dropped: [] };

  const droppedIds = new Set<string>();
  for (const [id, photos] of groups) {
    if (id === mainId) continue;
    const cluster = clusterById.get(id);
    if (cluster === undefined) continue;
    if (photos.length >= members.length * OUTLIER_MAX_SHARE) continue;
    if (distanceKm(cluster, main) <= OUTLIER_MIN_KM) continue;
    for (const photo of photos) droppedIds.add(photo.id);
  }
  if (droppedIds.size === 0) return { kept: [...members], dropped: [] };
  return {
    kept: members.filter((photo) => !droppedIds.has(photo.id)),
    dropped: members.filter((photo) => droppedIds.has(photo.id)),
  };
}
