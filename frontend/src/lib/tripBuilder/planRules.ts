/**
 * What the night answers add up to (spec §C.10): the answers the commit will
 * read, the stations that hold a night, and whatever the mirrored night plan
 * says is wrong with them.
 *
 * An answer of `unknown` is an OPEN night: it names no place. The builder
 * still never guesses what the photos do not say (decision 11) — but an open
 * night must not hold the review back either (owner ruling 2026-10-13), so
 * `resolvedNights` gives every open night the app's default (the scan's
 * suggestion, else the previous night's place) and everything the review and
 * the commit read goes through it. Only a night neither rule can answer stays
 * open, and only that still refuses the review (`stillOpenNights`).
 */
import {
  NIGHT_FLIGHT,
  NIGHT_HOME,
  NIGHT_SPECIALS,
  NIGHT_UNKNOWN,
  addDays,
  deriveStationRows,
  validateNightPlan,
  type NightAssign,
  type NightPlanArea,
  type NightPlanError,
} from "../../shared/tour/builderNightPlan";
import type { Day, TripBuilderDraft } from "../../types/tripBuilder";
import type { ReviewArea, ReviewState } from "./draftEdits";
import { locate, spanOf } from "./reviewRules";
import { toPlanStation } from "./stationOps";

/**
 * Could `stationKey` hold the night of `day`? The two bounds `validateNightPlan`
 * enforces for a station (checks 4 and 5 of the plan), read for one night at a
 * time, so the page never offers — and the resolver never takes — an answer the
 * commit would refuse. A station of a skipped area holds nothing.
 */
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

/** `nights` with the answers that name a skipped area's stations read as unknown. */
function withoutSkipped(
  state: ReviewState,
  nights: Readonly<Record<Day, NightAssign>>
): Record<Day, NightAssign> {
  const skipped = new Set(
    state.areas
      .filter((area) => area.as === "skip")
      .flatMap((area) => area.stations.map((station) => station.key))
  );
  return Object.fromEntries(
    Object.entries(nights).map(([day, assign]) => [
      day,
      skipped.has(assign) ? NIGHT_UNKNOWN : assign,
    ])
  );
}

/** The night answers as the commit will read them: a skipped area keeps no night. */
export function effectiveNights(state: ReviewState): Record<Day, NightAssign> {
  return withoutSkipped(state, state.nights);
}

/** The first station among the scan's suggestions for `day` the night may be given to. */
function suggestionFor(draft: TripBuilderDraft, state: ReviewState, day: Day): string | null {
  for (const key of draft.nights[day]?.suggestedStationKeys ?? []) {
    if (nightFits(draft, state, day, key)) return key;
  }
  return null;
}

/**
 * The continuity default for `day`: the place of the night before it — the
 * station that night names, when the night of `day` may be given to that same
 * station; or `home`, when the night before was spent at home. Null when the
 * night before names no place at all (a flight), when it is itself still open,
 * or when there is no night before `day`: nothing then continues.
 */
function continuityFor(
  draft: TripBuilderDraft,
  state: ReviewState,
  day: Day,
  resolved: Readonly<Record<Day, NightAssign>>
): string | null {
  const before = resolved[addDays(day, -1)];
  if (before === NIGHT_HOME) return NIGHT_HOME;
  if (before === undefined || before === NIGHT_UNKNOWN || before === NIGHT_FLIGHT) return null;
  return nightFits(draft, state, day, before) ? before : null;
}

/**
 * The answers every night is read with: the raw ones (`effectiveNights`, or
 * `nights` when a caller tests an edit), each OPEN night given the app's
 * default in the order of the days, so a default may rest on the night before
 * it:
 *
 * 1. the scan's suggestion the night may be given to (`suggestedStationKeys`,
 *    the choice the chip marks "(suggested)"), else
 * 2. the previous night's place — the same station, when the night may be
 *    given to it, or `home` after a night at home (the continuity rule), else
 * 3. the night stays `unknown`: it has no legal place at all. The review then
 *    refuses the plan (`stillOpenNights`) rather than send an open night on.
 *
 * An answer the user gave is never touched. Pure: the same draft and state
 * resolve the same way, so a re-scan — which replays the same edits — keeps
 * every default.
 */
export function resolvedNights(
  draft: TripBuilderDraft,
  state: ReviewState,
  nights?: Readonly<Record<Day, NightAssign>>
): Record<Day, NightAssign> {
  const answers = withoutSkipped(state, nights ?? state.nights);
  const resolved: Record<Day, NightAssign> = {};
  for (const day of Object.keys(answers).sort()) {
    const answer = answers[day];
    resolved[day] =
      answer === NIGHT_UNKNOWN
        ? (suggestionFor(draft, state, day) ??
          continuityFor(draft, state, day, resolved) ??
          NIGHT_UNKNOWN)
        : answer;
  }
  return resolved;
}

/**
 * The nights the resolver could not answer: nothing the scan suggested and no
 * place the night before may hold them. A plan with one is not complete, and
 * the review refuses it — the one refusal the ruling of 2026-10-13 leaves.
 */
export function stillOpenNights(draft: TripBuilderDraft, state: ReviewState): Day[] {
  const resolved = resolvedNights(draft, state);
  return Object.keys(resolved)
    .filter((day) => resolved[day] === NIGHT_UNKNOWN)
    .sort();
}

/** The stations that hold at least one night. */
export function sleptKeys(draft: TripBuilderDraft, state: ReviewState): Set<string> {
  const words = new Set<string>(NIGHT_SPECIALS);
  return new Set(
    Object.values(resolvedNights(draft, state)).filter((assign) => !words.has(assign))
  );
}

/**
 * Everything the night plan says is wrong with `nights` (the state's own raw
 * answers when omitted), each open night resolved first, so this reads the
 * plan the commit would really write.
 */
export function planErrors(
  draft: TripBuilderDraft,
  state: ReviewState,
  nights?: Readonly<Record<Day, NightAssign>>
): NightPlanError[] {
  const areas: NightPlanArea[] = state.areas.map((area) => ({
    key: area.key,
    ...spanOf(draft, area),
    stationKeys: area.stations.map((station) => station.key),
  }));
  return validateNightPlan(
    state.areas.flatMap((area) => area.stations.map(toPlanStation)),
    resolvedNights(draft, state, nights),
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
