/**
 * The trip builder's night plan (spec 2026-10-09 §C.10): the ONE rule for what
 * a set of night answers writes as roadtrip stations, whether those answers
 * form a plan, and what the roadtrips are called.
 *
 * Mirrored at `frontend/src/shared/tour/builderNightPlan.ts` — change both
 * together. The review page derives what it shows from these functions and the
 * commit handler re-derives and re-validates with the same ones, so the two
 * cannot disagree about a night. Pure and import-free, so both trees hold the
 * same file.
 */

/** A night's answer: a station key, or one of the three words below. */
export type NightAssign = string;

/** The night was spent at home. */
export const NIGHT_HOME = "home";
/** No photo says where; the user decides, the builder never guesses (decision 11). */
export const NIGHT_UNKNOWN = "unknown";
/** Airborne across local midnight. */
export const NIGHT_FLIGHT = "flight";
export const NIGHT_SPECIALS = [NIGHT_HOME, NIGHT_UNKNOWN, NIGHT_FLIGHT] as const;

/** What the plan needs of a station; `firstDay`/`lastDay` are its photo days after any pull. */
export interface NightPlanStation {
  key: string;
  title: string;
  lat: number;
  lon: number;
  firstDay: string;
  lastDay: string;
  notes?: string | null;
}

/** An area's span and its stations in travel order. */
export interface NightPlanArea {
  key: string;
  startDay: string;
  endDay: string;
  stationKeys: readonly string[];
}

/** S and E, the trip's own first and last day. Its nights are S … E−1. */
export interface NightPlanWindow {
  startDay: string;
  endDay: string;
}

/**
 * One roadtrip station row. A slept station gives one row per CONTIGUOUS run
 * of its nights — `startDate` the first night, `endDate` the last night + 1,
 * the span `countRoadtripNights` counts — and a station without nights one
 * pass row from `firstDay` to `lastDay`. `key` is the station key for the
 * first row and `<stationKey>@2`, `@3` … for each later run.
 */
export interface StationRow {
  key: string;
  stationKey: string;
  title: string;
  lat: number;
  lon: number;
  startDate: string;
  endDate: string;
  slept: boolean;
  notes?: string | null;
}

export const NIGHT_PLAN_ERROR_CODES = [
  "duplicateStation",
  "unknownStation",
  "nightOutsideWindow",
  "nightOutsideArea",
  "nightNotAdjacent",
  "overlappingSleptRows",
  "sleptRowOutsideWindow",
] as const;
export type NightPlanErrorCode = (typeof NIGHT_PLAN_ERROR_CODES)[number];

export interface NightPlanError {
  code: NightPlanErrorCode;
  stationKey: string | null;
  day: string | null;
}

/** What naming needs of an area that becomes a roadtrip, in travel order. */
export interface AreaNameInput {
  key: string;
  mainCity: string | null;
  startDay: string;
}

const DAY_MS = 86_400_000;

/** `day` moved by `n` calendar days, on the day string alone — no zone can shift it. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The window's nights, S … E−1; none for a one-day window. */
export function nightsOf(window: NightPlanWindow): string[] {
  const nights: string[] = [];
  for (let night = window.startDay; night < window.endDay; night = addDays(night, 1)) {
    nights.push(night);
  }
  return nights;
}
