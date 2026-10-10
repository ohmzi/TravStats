/**
 * Medians for a place (spec 2026-10-09 §C.5, §C.9): a place is the middle of
 * where its photos were taken, taken per axis, so one stray frame cannot drag it.
 */
import type { Coord } from "../tour/tourDistance";

/** The middle value; the mean of the two middle ones for an even count. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median of no values");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const wrapOffset = (degrees: number): number =>
  degrees > 180 ? degrees - 360 : degrees < -180 ? degrees + 360 : degrees;

/**
 * The median of longitudes. Values within half the world of each other are
 * medianed as they are. Values that straddle the antimeridian are measured from
 * the first one instead, so 179.9° and −179.9° meet at 180°, not back at 0°.
 */
export function medianLongitude(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median of no values");
  let low = values[0];
  let high = values[0];
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (high - low <= 180) return median(values);
  const reference = values[0];
  const shifted = reference + median(values.map((value) => wrapOffset(value - reference)));
  return shifted > 180 ? shifted - 360 : shifted < -180 ? shifted + 360 : shifted;
}

/** Per-axis median of a set of coordinates. */
export function medianPoint(points: readonly Coord[]): Coord {
  return {
    lat: median(points.map((point) => point.lat)),
    lon: medianLongitude(points.map((point) => point.lon)),
  };
}
