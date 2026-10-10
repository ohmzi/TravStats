/**
 * What the night answers add up to (spec §C.10): the answers the commit will
 * read, the stations that hold a night, and whatever the mirrored night plan
 * says is wrong with them.
 */
import {
  NIGHT_SPECIALS,
  NIGHT_UNKNOWN,
  deriveStationRows,
  validateNightPlan,
  type NightAssign,
  type NightPlanArea,
  type NightPlanError,
} from "../../shared/tour/builderNightPlan";
import type { Day, TripBuilderDraft } from "../../types/tripBuilder";
import type { ReviewArea, ReviewState } from "./draftEdits";
import { spanOf } from "./reviewRules";
import { toPlanStation } from "./stationOps";

/** The night answers as the commit will read them: a skipped area keeps no night. */
export function effectiveNights(state: ReviewState): Record<Day, NightAssign> {
  const skipped = new Set(
    state.areas
      .filter((area) => area.as === "skip")
      .flatMap((area) => area.stations.map((station) => station.key))
  );
  return Object.fromEntries(
    Object.entries(state.nights).map(([day, assign]) => [
      day,
      skipped.has(assign) ? NIGHT_UNKNOWN : assign,
    ])
  );
}

/** The stations that hold at least one night. */
export function sleptKeys(state: ReviewState): Set<string> {
  const words = new Set<string>(NIGHT_SPECIALS);
  return new Set(Object.values(effectiveNights(state)).filter((assign) => !words.has(assign)));
}

/** Everything the night plan says is wrong with `nights` (the state's own when omitted). */
export function planErrors(
  draft: TripBuilderDraft,
  state: ReviewState,
  nights: Readonly<Record<Day, NightAssign>> = state.nights
): NightPlanError[] {
  const areas: NightPlanArea[] = state.areas.map((area) => ({
    key: area.key,
    ...spanOf(draft, area),
    stationKeys: area.stations.map((station) => station.key),
  }));
  return validateNightPlan(
    state.areas.flatMap((area) => area.stations.map(toPlanStation)),
    nights,
    areas,
    { startDay: draft.window.startDay, endDay: draft.window.endDay }
  );
}

export const errorSignature = (error: NightPlanError): string =>
  `${error.code}|${error.stationKey ?? ""}|${error.day ?? ""}`;

/** The rows a roadtrip area would write under the current nights. */
export function roadtripRowCount(
  area: ReviewArea,
  nights: Readonly<Record<Day, NightAssign>>
): number {
  return deriveStationRows(area.stations.map(toPlanStation), nights).length;
}
