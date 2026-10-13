/**
 * Which nights a station could hold (spec §C.10): the bound `validateNightPlan`
 * enforces, asked for one night at a time so the page never offers an answer
 * the commit would refuse, and the night "slept here" would claim. The bound
 * itself lives in `planRules.nightFits`, beside the resolver that filters an
 * open night's default with it.
 */
import { NIGHT_UNKNOWN, addDays } from "../../shared/tour/builderNightPlan";
import type { Day, TripBuilderDraft } from "../../types/tripBuilder";
import type { ReviewState } from "./draftEdits";
import { effectiveNights, nightFits } from "./planRules";
import { locate } from "./reviewRules";

/**
 * The unknown night that "slept here" would give a station: the evening of its
 * last photo day, else the night before its first. Null when no unknown night
 * is within its reach. The RAW answers are read, so a night the app resolved
 * to a default is still there to claim — the user's switch outranks the
 * default. A night the commit reads as unknown counts: one that names a
 * station of a skipped area is free for a neighbour.
 */
export function sleepNight(
  draft: TripBuilderDraft,
  state: ReviewState,
  stationKey: string
): Day | null {
  const at = locate(state.areas, stationKey);
  if (at === null) return null;
  const station = state.areas[at.a].stations[at.i];
  const nights = effectiveNights(state);
  for (const day of [station.lastDay, addDays(station.firstDay, -1)]) {
    if (nights[day] === NIGHT_UNKNOWN && nightFits(draft, state, day, stationKey)) return day;
  }
  return null;
}
