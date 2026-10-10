/**
 * The edits about nights and about what an area becomes. A night goes only to
 * a station next to it in its own area, or to one of the three words; the
 * plan is checked with the same `validateNightPlan` the commit uses.
 */
import { NIGHT_SPECIALS } from "../../shared/tour/builderNightPlan";
import type { TripBuilderDraft } from "../../types/tripBuilder";
import type { DraftEdit, ReviewState } from "./draftEdits";
import { accept } from "./editLog";
import { errorSignature, planErrors } from "./planRules";
import { locate, withSuggestedNames } from "./reviewRules";

type EditOf<T extends DraftEdit["type"]> = Extract<DraftEdit, { type: T }>;

export function assignNight(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"assignNight">
): ReviewState {
  if (!Object.prototype.hasOwnProperty.call(state.nights, edit.day)) return state;
  if (!(NIGHT_SPECIALS as readonly string[]).includes(edit.assign)) {
    const at = locate(state.areas, edit.assign);
    if (at === null || state.areas[at.a].as === "skip") return state;
  }
  const nights = { ...state.nights, [edit.day]: edit.assign };
  const known = new Set(planErrors(draft, state).map(errorSignature));
  if (planErrors(draft, state, nights).some((error) => !known.has(errorSignature(error)))) {
    return state;
  }
  return accept(state, edit, { nights });
}

export function setAreaKind(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"setAreaKind">
): ReviewState {
  const a = state.areas.findIndex((area) => area.key === edit.areaKey);
  if (a < 0) return state;
  const areas = state.areas.map((area, index) => (index === a ? { ...area, as: edit.as } : area));
  return accept(withSuggestedNames(draft, { ...state, areas }), edit);
}
