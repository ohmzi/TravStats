/**
 * Areas (spec 2026-10-09 §C.11): what becomes of each stretch of ground travel.
 *
 * Which areas are one timeline stop and which a roadtrip, which city names a
 * roadtrip, the countries a trip names and the two ends of its journey band.
 * The roadtrip names themselves come from `roadtripAreaNames`
 * (shared/tour/builderNightPlan.ts), fed with `mainCityOf` and each area's start day.
 */
import type { Day, GroundArea } from "./types";

/** `<startDay>#<n>`: how an area is named across a re-scan and in the commit body. */
export function areaKeyOf(startDay: Day, ordinal: number): string {
  return `${startDay}#${ordinal}`;
}

/** The parts with their keys; `n` counts from 1 among the areas that start on the same day. */
export function keyAreas<T extends { area: GroundArea }>(
  parts: readonly T[]
): Array<T & { key: string }> {
  const seen = new Map<Day, number>();
  return parts.map((part) => {
    const ordinal = (seen.get(part.area.startDay) ?? 0) + 1;
    seen.set(part.area.startDay, ordinal);
    return { ...part, key: areaKeyOf(part.area.startDay, ordinal) };
  });
}
