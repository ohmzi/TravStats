/**
 * What the review page draws, worked out from the draft and the state: the days
 * of an area, where each night's chip sits, what a night could be answered, what
 * stops the user from creating the trip, and the straight-line preview of the
 * route. Pure, so the components stay thin.
 */
import {
  NIGHT_FLIGHT,
  NIGHT_HOME,
  NIGHT_UNKNOWN,
  addDays,
  isMultiNightStay,
  type NightAssign,
} from "../../shared/tour/builderNightPlan";
import type {
  Day,
  DraftDay,
  DraftFlight,
  DraftLeg,
  DraftStation,
  DraftStopover,
  TripBuilderDraft,
} from "../../types/tripBuilder";
import type { TourGeometry } from "../../types/tour";
import type { ReviewArea, ReviewState } from "./draftEdits";
import {
  effectiveNights,
  nightFits,
  planErrors,
  resolvedNights,
  roadtripRowCount,
  stillOpenNights,
} from "./planRules";
import { locate, spanOf } from "./reviewRules";

// ─── Days ────────────────────────────────────────────────────────────────────

/** The days of the trip that fall inside an area's span, in order. */
export function areaDays(
  draft: TripBuilderDraft,
  area: Pick<ReviewArea, "key" | "stations">
): DraftDay[] {
  const span = spanOf(draft, area);
  return draft.days.filter((day) => day.day >= span.startDay && day.day <= span.endDay);
}

export interface DayStation {
  station: DraftStation;
  /** Its place in the area: the leg before it is `legs[index - 1]`. */
  index: number;
}

/**
 * Each station of an area filed under the day it starts on. A station dated
 * outside the area's days (an airport or home pass station dated S or E) goes
 * to the nearest day the area does have, so nothing is left undrawn.
 */
export function stationsByDay(
  area: Pick<ReviewArea, "stations">,
  days: readonly Day[]
): Map<Day, DayStation[]> {
  const byDay = new Map<Day, DayStation[]>();
  if (days.length === 0) return byDay;
  area.stations.forEach((station, index) => {
    const onOrBefore = days.filter((day) => day <= station.firstDay);
    const day = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : days[0];
    byDay.set(day, [...(byDay.get(day) ?? []), { station, index }]);
  });
  return byDay;
}

// ─── Nights ──────────────────────────────────────────────────────────────────

export interface NightChoice {
  value: NightAssign;
  /** The station's title; null for the words home and unknown. */
  title: string | null;
  /**
   * The app suggests it for this night: the scan's own suggestion, or the
   * default an open night resolved to (`resolvedNights`). The chip marks such a
   * choice "(suggested)", so a defaulted answer says what it is and invites the
   * user to pick another.
   */
  suggested: boolean;
}

/**
 * What a night may be answered: the places next to it, in its own area, then
 * home and unknown. The night's present answer — the resolved one, so an open
 * night shows the app's default — is always among them, so the choice never
 * shows a value it cannot name. Choosing "unknown" on a night a default covers
 * hands the night back to that default; a night nothing may hold keeps it.
 */
export function nightChoices(draft: TripBuilderDraft, state: ReviewState, day: Day): NightChoice[] {
  const suggested = new Set(draft.nights[day]?.suggestedStationKeys ?? []);
  const answers = resolvedNights(draft, state);
  const defaulted = effectiveNights(state)[day] === NIGHT_UNKNOWN && answers[day] !== NIGHT_UNKNOWN;
  const places = state.areas
    .flatMap((area) => area.stations)
    .filter(
      (s) => (s.kind === "visit" || s.kind === "brief") && nightFits(draft, state, day, s.key)
    )
    .map((s) => ({
      value: s.key,
      title: s.title,
      suggested: suggested.has(s.key) || (defaulted && answers[day] === s.key),
    }));
  const choices: NightChoice[] = [
    ...places,
    { value: NIGHT_HOME, title: null, suggested: false },
    { value: NIGHT_UNKNOWN, title: null, suggested: false },
  ];
  const current = answers[day];
  if (
    current !== undefined &&
    current !== NIGHT_FLIGHT &&
    !choices.some((c) => c.value === current)
  ) {
    const at = locate(state.areas, current);
    const title = at === null ? null : state.areas[at.a].stations[at.i].title;
    choices.unshift({ value: current, title, suggested: false });
  }
  return choices;
}

/**
 * The area each night's chip is drawn in: the area of the station it names,
 * else the area whose days hold it, else the area it is the evening before (a
 * landing at night). A night nothing claims is `loose`.
 */
export function placeNights(
  draft: TripBuilderDraft,
  state: ReviewState
): { byArea: Map<string, Day[]>; loose: Day[] } {
  const byArea = new Map<string, Day[]>();
  const loose: Day[] = [];
  const nights = resolvedNights(draft, state);
  const saved = state.areas.filter((area) => area.as !== "skip");
  for (const day of Object.keys(nights).sort()) {
    const at = locate(state.areas, nights[day]);
    let owner: string | undefined = at === null ? undefined : state.areas[at.a].key;
    owner ??= saved.find((a) => {
      const span = spanOf(draft, a);
      return day >= span.startDay && day <= span.endDay;
    })?.key;
    owner ??= saved.find((a) => addDays(spanOf(draft, a).startDay, -1) === day)?.key;
    if (owner === undefined) loose.push(day);
    else byArea.set(owner, [...(byArea.get(owner) ?? []), day]);
  }
  return { byArea, loose };
}

/**
 * The nights still open: no answer, no suggestion, no place before them. A
 * night the app resolved to a default is answered, so it is not one of these.
 */
export function unknownNightCount(draft: TripBuilderDraft, state: ReviewState): number {
  return stillOpenNights(draft, state).length;
}

// ─── What stops "Create trip" ────────────────────────────────────────────────

export type ReviewProblem =
  | { code: "blankTripName" }
  | { code: "roadtripTooShort"; areaKey: string }
  | { code: "nightPlanInvalid" };

/**
 * Why the trip cannot be created yet. Each is something the commit would
 * refuse; the page says so first. For an existing trip a roadtrip that is
 * shorter than two rows may be one that is only updated, which the server
 * judges, so only a new trip is held to it here — and a multi-night stay of
 * one city is no refusal at all (owner ruling 2026-10-13): the one row IS the
 * stay, and the commit writes it as the trip the review offered.
 *
 * The night plan is read as the commit will read it (every open night resolved
 * to the app's default), so a night the app can answer never holds the trip
 * back. What still does is a night NOTHING may hold — no suggestion and no
 * place before it — and a plan `validateNightPlan` refuses outright (ruling
 * 2026-10-13: that refusal survives, and only that one).
 */
export function reviewProblems(draft: TripBuilderDraft, state: ReviewState): ReviewProblem[] {
  const problems: ReviewProblem[] = [];
  const isNew = draft.target.kind === "new";
  if (isNew && state.tripName.trim() === "") problems.push({ code: "blankTripName" });
  const nights = resolvedNights(draft, state);
  for (const area of state.areas) {
    if (isNew && area.as === "roadtrip" && roadtripRowsRefused(draft, area, nights)) {
      problems.push({ code: "roadtripTooShort", areaKey: area.key });
    }
  }
  if (stillOpenNights(draft, state).length > 0 || planErrors(draft, state).length > 0) {
    problems.push({ code: "nightPlanInvalid" });
  }
  return problems;
}

/**
 * Whether the area's roadtrip wants another row: fewer than two rows, and not
 * the one-row stay the commit writes (the offer's own shape decides — the
 * same `isMultiNightStay` the review's default and the server read, so the
 * page can never offer a trip the commit refuses nor refuse one it would
 * write). An area the draft does not know keeps the old answer.
 */
function roadtripRowsRefused(
  draft: TripBuilderDraft,
  area: ReviewArea,
  nights: Readonly<Record<Day, NightAssign>>
): boolean {
  if (roadtripRowCount(area, nights) >= 2) return false;
  const offered = draft.areas.find((candidate) => candidate.key === area.key);
  return (
    offered === undefined || !isMultiNightStay(offered.startDay, offered.endDay, offered.stations)
  );
}

// ─── The map preview ─────────────────────────────────────────────────────────

/**
 * How long a stopover was, in whole hours: the key names the two flights it
 * lies between, and the hours are the clock from the arrival to the departure.
 * Null when either flight is not in the draft or is known only by its day.
 */
export function stopoverHours(
  flights: readonly DraftFlight[],
  stopover: DraftStopover
): number | null {
  const [inFlightId, outFlightId] = stopover.key.split("#");
  const from = flights.find((flight) => flight.id === inFlightId)?.arrLocal;
  const to = flights.find((flight) => flight.id === outFlightId)?.depLocal;
  if (from === undefined || to === undefined || from.length <= 10 || to.length <= 10) return null;
  const minutes = (local: string): number => Date.parse(`${local.replace(" ", "T")}:00Z`) / 60_000;
  return Math.max(0, Math.floor((minutes(to) - minutes(from)) / 60));
}

/** Every station of the areas that will be saved, then a toggled stopover's, in travel order. */
export function previewStations(draft: TripBuilderDraft, state: ReviewState): DraftStation[] {
  return [
    ...state.areas.filter((area) => area.as !== "skip").flatMap((area) => area.stations),
    ...(draft.stopovers ?? [])
      .filter((stopover) => state.stopoverTicks[stopover.key]?.roadtrip === true)
      .flatMap((stopover) => stopover.stations),
  ];
}

/** A straight line through each saved area's stations, drawn as the unrouted legs they are. */
export function previewGeometry(draft: TripBuilderDraft, state: ReviewState): TourGeometry {
  const features: TourGeometry["features"] = [];
  const addLegs = (stations: readonly DraftStation[], legs: readonly DraftLeg[]): void => {
    legs.forEach((leg, i) => {
      const from = stations[i];
      const to = stations[i + 1];
      if (from === undefined || to === undefined) return;
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [from.lon, from.lat],
            [to.lon, to.lat],
          ],
        },
        properties: {
          legId: `${leg.fromKey}>${leg.toKey}`,
          source: "straight",
          mode: leg.mode,
          confidence: "estimated",
          distanceKm: leg.chordKm,
        },
      });
    });
  };
  for (const area of state.areas) {
    if (area.as === "skip") continue;
    addLegs(area.stations, area.legs);
  }
  for (const stopover of draft.stopovers ?? []) {
    if (state.stopoverTicks[stopover.key]?.roadtrip !== true) continue;
    addLegs(stopover.stations, stopover.legs);
  }
  return { type: "FeatureCollection", features };
}
