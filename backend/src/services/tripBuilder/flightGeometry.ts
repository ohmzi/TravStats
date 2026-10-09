/**
 * Plane geometry for the flight rules (spec 2026-10-09 §C.4): where a point lies against the
 * corridor of a flight, and whether a handful of photos could have been taken from a plane at
 * all. Pure, no clock.
 */
import { distanceKm } from "../photoJourneys/cluster";
import type { Coord } from "../tour/tourDistance";
import { STATIONARY_GROUP_KM, STATIONARY_GROUP_MIN, STATIONARY_GROUP_PHOTOS } from "./thresholds";
import type { PhotoPoint } from "./types";

const EARTH_RADIUS_KM = 6371;
const MINUTE_MS = 60_000;

/** What the geometry reads of a photo: where it was taken. */
export type Located = Pick<PhotoPoint, "lat" | "lon">;
/** … and, for the stationary test, when. */
export type LocatedInTime = Located & Pick<PhotoPoint, "tMs">;

const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));

/** The photo's position, or null for a photo without a usable GPS fix. */
export function coordOf(photo: Located): Coord | null {
  return photo.lat === null || photo.lon === null ? null : { lat: photo.lat, lon: photo.lon };
}

/** Initial bearing from `from` to `to`, in radians. */
function bearing(from: Coord, to: Coord): number {
  const dLon = rad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(rad(to.lat));
  const x =
    Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) -
    Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(dLon);
  return Math.atan2(y, x);
}

/** Where a point lies against the great-circle track of a flight. */
export interface CorridorFix {
  /** Distance from the track, always positive. */
  crossKm: number;
  /** Distance along the track from the departure; negative behind it, over `lengthKm` beyond the arrival. */
  alongKm: number;
  /** The length of the track. */
  lengthKm: number;
}

/** Cross-track and along-track distance of `at` against the track `from` → `to` (spherical earth). */
export function corridorFix(from: Coord, to: Coord, at: Coord): CorridorFix {
  const angular = distanceKm(from, at) / EARTH_RADIUS_KM;
  const delta = bearing(from, at) - bearing(from, to);
  const crossAngle = Math.asin(clampUnit(Math.sin(angular) * Math.sin(delta)));
  const alongAngle = Math.acos(clampUnit(Math.cos(angular) / Math.cos(crossAngle)));
  return {
    crossKm: Math.abs(crossAngle) * EARTH_RADIUS_KM,
    alongKm: (Math.cos(delta) < 0 ? -alongAngle : alongAngle) * EARTH_RADIUS_KM,
    lengthKm: distanceKm(from, to),
  };
}

/**
 * A photo is part of a stationary group when at least STATIONARY_GROUP_PHOTOS photos of `pool`
 * (itself included) lie within STATIONARY_GROUP_KM of it and span at least STATIONARY_GROUP_MIN
 * minutes. A plane cannot do that, so such a photo is never in flight.
 */
export function isStationary(photo: LocatedInTime, pool: readonly LocatedInTime[]): boolean {
  const here = coordOf(photo);
  if (!here) return false;
  let count = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const other of pool) {
    const there = coordOf(other);
    if (!there || distanceKm(here, there) > STATIONARY_GROUP_KM) continue;
    count += 1;
    first = Math.min(first, other.tMs);
    last = Math.max(last, other.tMs);
  }
  return count >= STATIONARY_GROUP_PHOTOS && last - first >= STATIONARY_GROUP_MIN * MINUTE_MS;
}
