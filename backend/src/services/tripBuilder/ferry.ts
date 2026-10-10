/**
 * Which legs between stations are ferries (spec 2026-10-09 §C.7).
 *
 * A leg defaults to `ferry` on evidence the trip itself holds: the road
 * router's own ferry steps, or photos taken out at sea between the two
 * stations. The land-polygon test only raises a chip ("looks like a water
 * crossing"); it never changes the default, because a bay or a long bridge
 * crosses as much water as a ferry does.
 *
 * Pure: the router's answers, the sea photos and the country test come in.
 */
import { FERRY_MIN_SEA_PHOTOS, FERRY_PROBE_SHARE } from "./thresholds";
import type { LegEvidence, PhotoPoint, PlanLeg } from "./types";

/** How many at-sea photos were taken after `fromLastMs` and before `toFirstMs`. */
export function countSeaPhotosBetween(
  fromLastMs: number,
  toFirstMs: number,
  seaPhotos: readonly Pick<PhotoPoint, "tMs">[]
): number {
  return seaPhotos.filter((photo) => photo.tMs > fromLastMs && photo.tMs < toFirstMs).length;
}

/**
 * The mode a leg starts out in, and why it may be a ferry.
 *
 * - `router`: the route's ferry steps cover at least half of it.
 * - `seaPhotos`: at least two photos were taken at sea between the stations.
 * - `chip`: only the water test fired; the leg stays `road`.
 *
 * `routedKm` is the router's own distance, kept even when the leg is a road
 * leg so the preview can show it.
 */
export function decideLegMode(
  evidence: LegEvidence
): Pick<PlanLeg, "mode" | "ferryEvidence" | "routedKm"> {
  const { probe } = evidence;
  const routedKm = probe ? probe.distanceKm : null;
  if (probe && probe.ferryKm > 0 && probe.ferryKm >= FERRY_PROBE_SHARE * probe.distanceKm) {
    return { mode: "ferry", ferryEvidence: "router", routedKm };
  }
  if (evidence.seaPhotosBetween >= FERRY_MIN_SEA_PHOTOS) {
    return { mode: "ferry", ferryEvidence: "seaPhotos", routedKm };
  }
  if (evidence.waterChip) return { mode: "road", ferryEvidence: "chip", routedKm };
  return { mode: "road", ferryEvidence: null, routedKm };
}
