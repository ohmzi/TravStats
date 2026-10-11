/**
 * The list of what the user did (`ReviewState.edits`), the part of the review
 * that is persisted and replayed. Two consecutive edits that set the same thing
 * are one entry, the latest, so typing a name does not write a line per key.
 */
import type { DraftEdit, ReviewState } from "./draftEdits";

/**
 * What two consecutive edits must share to be one. Null for edits that stack:
 * merge, delete and fold, and the two switches that act on the station chain
 * or the night answers (slept, home). A switch off then on is not the same as
 * the "on" alone, so the replay of the log needs both.
 */
function editTarget(edit: DraftEdit): string | null {
  switch (edit.type) {
    case "rename":
    case "setNote":
      return `${edit.type}:${edit.stationKey}`;
    case "setLegMode":
      return `${edit.type}:${edit.fromKey}>${edit.toKey}`;
    case "assignNight":
      return `${edit.type}:${edit.day}`;
    case "setAreaKind":
    case "setAreaAlbum":
    case "setAreaName":
    case "setVehicle":
      return `${edit.type}:${edit.areaKey}`;
    case "setFlightTick":
      return `${edit.type}:${edit.flightId}`;
    case "togglePhotoJourney":
      return `${edit.type}:${edit.id}`;
    case "setStopoverTick":
      return `${edit.type}:${edit.key}`;
    case "setAlbum":
    case "setCountries":
    case "setTripName":
      return edit.type;
    default:
      return null;
  }
}

/** Adds `edit` to the log, or replaces the last entry when it sets the same thing again. */
export function logEdit(state: ReviewState, edit: DraftEdit): ReviewState {
  const target = editTarget(edit);
  const last = state.edits[state.edits.length - 1];
  const replaces = target !== null && last !== undefined && editTarget(last) === target;
  return { ...state, edits: [...(replaces ? state.edits.slice(0, -1) : state.edits), edit] };
}

/** The accepted edit: `patch` applied to the state, and `edit` logged. */
export function accept(
  state: ReviewState,
  edit: DraftEdit,
  patch: Partial<ReviewState> = {}
): ReviewState {
  return logEdit({ ...state, ...patch }, edit);
}
