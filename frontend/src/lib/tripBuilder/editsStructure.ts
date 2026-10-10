/**
 * The edits that change the station chain of an area: merge, delete, fold a
 * day trip, add or drop the home ends, and the slept switch. Each keeps the
 * legs, the leg modes and the night answers in step, so the plan the page
 * shows is always one the commit can derive.
 */
import { NIGHT_UNKNOWN } from "../../shared/tour/builderNightPlan";
import type { TripBuilderDraft } from "../../types/tripBuilder";
import type { DraftEdit, ReviewState } from "./draftEdits";
import { accept } from "./editLog";
import { sleepNight } from "./nightRules";
import { locate, syncArea } from "./reviewRules";
import {
  addHomeAt,
  foldDayTrip,
  mergeWithNext,
  removeHomeAt,
  removeStationAt,
  repointNights,
  type Chain,
} from "./stationOps";

type EditOf<T extends DraftEdit["type"]> = Extract<DraftEdit, { type: T }>;

const chainOf = (state: ReviewState, a: number): Chain => ({
  stations: state.areas[a].stations,
  legs: state.areas[a].legs,
});

function withChain(state: ReviewState, a: number, chain: Chain): ReviewState["areas"] {
  return state.areas.map((area, index) => (index === a ? syncArea({ ...area, ...chain }) : area));
}

export function merge(
  _draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"merge">
): ReviewState {
  const at = locate(state.areas, edit.stationKey);
  if (at === null) return state;
  const chain = mergeWithNext(chainOf(state, at.a), at.i);
  if (chain === null) return state;
  const stations = state.areas[at.a].stations;
  return accept(state, edit, {
    areas: withChain(state, at.a, chain),
    nights: repointNights(state.nights, [stations[at.i + 1].key], stations[at.i].key),
  });
}

export function remove(
  _draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"delete">
): ReviewState {
  const at = locate(state.areas, edit.stationKey);
  if (at === null) return state;
  const chain = removeStationAt(chainOf(state, at.a), at.i);
  if (chain === null) return state;
  return accept(state, edit, {
    areas: withChain(state, at.a, chain),
    nights: repointNights(state.nights, [edit.stationKey], NIGHT_UNKNOWN),
  });
}

export function fold(
  _draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"foldDayTrip">
): ReviewState {
  const at = locate(state.areas, edit.stationKey);
  if (at === null) return state;
  const result = foldDayTrip(chainOf(state, at.a), at.i);
  if (result === null) return state;
  return accept(state, edit, {
    areas: withChain(state, at.a, result.chain),
    nights: repointNights(state.nights, result.dropped, result.into),
  });
}

/**
 * "Slept here" off: the station's nights become unknown, for the user to give
 * to another. On: the unknown night within its reach becomes its own
 * (`sleepNight`); refused when there is none.
 */
export function toggleSlept(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"toggleSlept">
): ReviewState {
  const at = locate(state.areas, edit.stationKey);
  if (at === null || state.areas[at.a].as === "skip") return state;
  if (!edit.slept) {
    return accept(state, edit, {
      nights: repointNights(state.nights, [edit.stationKey], NIGHT_UNKNOWN),
    });
  }
  if (Object.values(state.nights).includes(edit.stationKey)) return accept(state, edit);
  const day = sleepNight(draft, state, edit.stationKey);
  if (day === null) return state;
  return accept(state, edit, { nights: { ...state.nights, [day]: edit.stationKey } });
}

export function toggleHome(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"toggleHome">
): ReviewState {
  const a = state.areas.findIndex((area) => area.key === edit.areaKey);
  const offer = draft.areas.find((area) => area.key === edit.areaKey)?.home[edit.end];
  if (a < 0 || offer === undefined || !offer.offered || offer.station === undefined) return state;
  const area = state.areas[a];
  if ((edit.end === "start" ? area.homeStart : area.homeEnd) === edit.on)
    return accept(state, edit);
  if (edit.on) {
    const chain = addHomeAt(chainOf(state, a), edit.end, offer.station);
    return chain === null ? state : accept(state, edit, { areas: withChain(state, a, chain) });
  }
  const dropped = edit.end === "start" ? area.stations[0] : area.stations[area.stations.length - 1];
  const chain = removeHomeAt(chainOf(state, a), edit.end);
  if (chain === null || dropped === undefined) return state;
  return accept(state, edit, {
    areas: withChain(state, a, chain),
    nights: repointNights(state.nights, [dropped.key], NIGHT_UNKNOWN),
  });
}
