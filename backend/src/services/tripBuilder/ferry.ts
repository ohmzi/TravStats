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
import { distanceKm } from "../photoJourneys/cluster";
import type { Coord } from "../tour/tourDistance";
import {
  FERRY_CHIP_MIN_CHORD_KM,
  FERRY_CHIP_WATER_FRACTION,
  FERRY_CHIP_WATER_RUN_KM,
  FERRY_MIN_SEA_PHOTOS,
  FERRY_PROBE_SHARE,
} from "./thresholds";
import type { CountryAt, LegEvidence, PhotoPoint, PlanLeg } from "./types";

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

/** The chord is sampled about once a kilometre: never fewer than 8 or more than 400 times. */
const MIN_CHORD_STEPS = 8;
const MAX_CHORD_STEPS = 400;

/** A longitude brought into [−180, 180). */
function wrapLongitude(lon: number): number {
  return ((lon + 540) % 360) - 180;
}

/**
 * Whether the straight line between two stations runs over enough water to be
 * worth a "looks like a water crossing" chip: a chord of at least 20 km of
 * which at least half is water, or on which one stretch of water is at least
 * 30 km long. A point is water when `countryAt` names no country there.
 *
 * Only a chip. A bay, an estuary or a bridge passes this test as readily as a
 * ferry does, which is why `decideLegMode` never lets it change a leg's mode.
 */
export function looksLikeWaterCrossing(a: Coord, b: Coord, countryAt: CountryAt): boolean {
  const chordKm = distanceKm(a, b);
  if (chordKm < FERRY_CHIP_MIN_CHORD_KM) return false;
  const steps = Math.min(MAX_CHORD_STEPS, Math.max(MIN_CHORD_STEPS, Math.ceil(chordKm)));
  const stepKm = chordKm / steps;
  // The short way round, so a chord over the antimeridian is not drawn through Greenwich.
  const dLon = wrapLongitude(b.lon - a.lon);

  let water = 0;
  let run = 0;
  let longestRun = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = a.lat + (b.lat - a.lat) * t;
    const lon = wrapLongitude(a.lon + dLon * t);
    if (countryAt(lat, lon) === null) {
      water++;
      run++;
      longestRun = Math.max(longestRun, run);
    } else {
      run = 0;
    }
  }
  const waterShare = water / (steps + 1);
  return waterShare >= FERRY_CHIP_WATER_FRACTION || longestRun * stepKm >= FERRY_CHIP_WATER_RUN_KM;
}
