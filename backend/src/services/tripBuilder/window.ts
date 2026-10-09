/**
 * The trip's window (spec 2026-10-09 §C.1, decision 10).
 *
 * A photo belongs to the trip when its OWN day — the calendar day on the
 * clock of the place it was taken — lies in [S, E]. Immich filters by instant
 * only, so the fetch reaches far enough that every photo whose local day can
 * lie in the context span [S − 3, E + 3] comes back on any clock on Earth:
 * from that span's first midnight at UTC+14 to its last midnight at UTC−12.
 * `clean.ts` then keeps or drops each photo by its own day. That is the fix
 * for the old album window, which cut at UTC midnight and lost the last
 * evening's photos.
 */
import { addDays } from "../../shared/tour/builderNightPlan";
import { toDbDate } from "../../shared/time/localDate";
import { CONTEXT_PAD_DAYS, WINDOW_PAD_AFTER_H, WINDOW_PAD_BEFORE_H } from "./thresholds";
import type { Day, ScanWindow } from "./types";

const HOUR_MS = 3_600_000;

/** The window of a scan from S to E; the request schema already refused E < S and over-long spans. */
export function scanWindow(startDay: Day, endDay: Day): ScanWindow {
  const contextFromDay = addDays(startDay, -CONTEXT_PAD_DAYS);
  const contextToDay = addDays(endDay, CONTEXT_PAD_DAYS);
  return {
    startDay,
    endDay,
    contextFromDay,
    contextToDay,
    fetchFrom: new Date(toDbDate(contextFromDay).getTime() - WINDOW_PAD_BEFORE_H * HOUR_MS),
    fetchTo: new Date(toDbDate(addDays(contextToDay, 1)).getTime() + WINDOW_PAD_AFTER_H * HOUR_MS),
  };
}

/** S ≤ day ≤ E. `YYYY-MM-DD` strings compare as days. */
export function inWindow(day: Day, window: ScanWindow): boolean {
  return day >= window.startDay && day <= window.endDay;
}

/** Every day S … E. The nights S … E−1 are `nightsOf` in shared/tour/builderNightPlan.ts. */
export function windowDays(window: ScanWindow): Day[] {
  const days: Day[] = [];
  for (let day = window.startDay; day <= window.endDay; day = addDays(day, 1)) days.push(day);
  return days;
}
