/**
 * Which nights a station could hold (spec §C.10): the bounds
 * `validateNightPlan` enforces, asked for one night at a time so the page
 * never offers an answer the commit would refuse.
 */
import { NIGHT_UNKNOWN, addDays } from "../../shared/tour/builderNightPlan";
import type { Day, TripBuilderDraft } from "../../types/tripBuilder";
import type { ReviewState } from "./draftEdits";
import { locate, spanOf } from "./reviewRules";

/** Could `stationKey` hold the night of `day`? The bounds of `validateNightPlan`, for one night. */
export function nightFits(
  draft: TripBuilderDraft,
  state: ReviewState,
  day: Day,
  stationKey: string
): boolean {
  const at = locate(state.areas, stationKey);
  if (at === null) return false;
  const area = state.areas[at.a];
  if (area.as === "skip") return false;
  const span = spanOf(draft, area);
  const station = area.stations[at.i];
  return (
    day >= addDays(span.startDay, -1) &&
    day <= span.endDay &&
    day >= addDays(station.firstDay, -1) &&
    day <= addDays(station.lastDay, 1)
  );
}

/**
 * The unknown night that "slept here" would give a station: the evening of its
 * last photo day, else the night before its first. Null when no unknown night
 * is within its reach.
 */
export function sleepNight(
  draft: TripBuilderDraft,
  state: ReviewState,
  stationKey: string
): Day | null {
  const at = locate(state.areas, stationKey);
  if (at === null) return null;
  const station = state.areas[at.a].stations[at.i];
  for (const day of [station.lastDay, addDays(station.firstDay, -1)]) {
    if (state.nights[day] === NIGHT_UNKNOWN && nightFits(draft, state, day, stationKey)) return day;
  }
  return null;
}
