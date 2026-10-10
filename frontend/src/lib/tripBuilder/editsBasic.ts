/**
 * The edits that change one value: a title, a note, a leg's mode, a name, a
 * switch. None touches the station chain or the night answers.
 */
import type { TripBuilderDraft } from "../../types/tripBuilder";
import type { DraftEdit, ReviewState } from "./draftEdits";
import { accept } from "./editLog";
import {
  MAX_COUNTRIES,
  MAX_NOTES_LENGTH,
  MAX_TITLE_LENGTH,
  locate,
  syncArea,
  withSuggestedNames,
} from "./reviewRules";

type EditOf<T extends DraftEdit["type"]> = Extract<DraftEdit, { type: T }>;

const areaIndex = (state: ReviewState, areaKey: string): number =>
  state.areas.findIndex((area) => area.key === areaKey);

function withAreaAt(state: ReviewState, a: number, patch: object): ReviewState["areas"] {
  return state.areas.map((area, index) => (index === a ? { ...area, ...patch } : area));
}

export function rename(
  _draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"rename">
): ReviewState {
  const title = edit.title.trim();
  const at = locate(state.areas, edit.stationKey);
  if (at === null || title === "" || title.length > MAX_TITLE_LENGTH) return state;
  const stations = state.areas[at.a].stations.map((s, i) => (i === at.i ? { ...s, title } : s));
  return accept(state, edit, { areas: withAreaAt(state, at.a, { stations }) });
}

export function setNote(
  _draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"setNote">
): ReviewState {
  const at = locate(state.areas, edit.stationKey);
  if (at === null || edit.notes.length > MAX_NOTES_LENGTH) return state;
  const notes = edit.notes.trim() === "" ? null : edit.notes;
  const stations = state.areas[at.a].stations.map((s, i) => (i === at.i ? { ...s, notes } : s));
  return accept(state, edit, { areas: withAreaAt(state, at.a, { stations }) });
}

export function setLegMode(
  _draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"setLegMode">
): ReviewState {
  for (let a = 0; a < state.areas.length; a++) {
    const area = state.areas[a];
    const i = area.legs.findIndex((l) => l.fromKey === edit.fromKey && l.toKey === edit.toKey);
    if (i < 0) continue;
    const legs = area.legs.map((leg, index) => (index === i ? { ...leg, mode: edit.mode } : leg));
    return accept(state, edit, {
      areas: state.areas.map((x, index) => (index === a ? syncArea({ ...area, legs }) : x)),
    });
  }
  return state;
}

export function setAreaName(
  _draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"setAreaName">
): ReviewState {
  const a = areaIndex(state, edit.areaKey);
  if (a < 0 || edit.name.length > MAX_TITLE_LENGTH) return state;
  return accept(state, edit, {
    areas: withAreaAt(state, a, { name: edit.name, nameEdited: true }),
  });
}

export function setVehicle(
  _draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"setVehicle">
): ReviewState {
  const a = areaIndex(state, edit.areaKey);
  if (a < 0) return state;
  return accept(state, edit, { areas: withAreaAt(state, a, { vehicle: edit.vehicle }) });
}

export function setFlightTick(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"setFlightTick">
): ReviewState {
  const flight = draft.flights.find((candidate) => candidate.id === edit.flightId);
  if (flight === undefined || (flight.locked && !edit.ticked)) return state;
  return accept(state, edit, {
    flightTicks: { ...state.flightTicks, [edit.flightId]: edit.ticked },
  });
}

export function setAlbum(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"setAlbum">
): ReviewState {
  if (state.album === null || draft.album === null) return state;
  if (edit.name.length > MAX_TITLE_LENGTH || (edit.create && !draft.album.allowed)) return state;
  return accept(state, edit, { album: { create: edit.create, name: edit.name } });
}

export function setCountries(
  _draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"setCountries">
): ReviewState {
  const codes = edit.countries.map((code) => code.trim().toUpperCase());
  const countries = [...new Set(codes.filter((code) => /^[A-Z]{2}$/.test(code)))];
  return accept(state, edit, { countries: countries.slice(0, MAX_COUNTRIES) });
}

export function togglePhotoJourney(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"togglePhotoJourney">
): ReviewState {
  if (!draft.photoJourneys.some((journey) => journey.id === edit.id)) return state;
  return accept(state, edit, {
    photoJourneyTicks: { ...state.photoJourneyTicks, [edit.id]: edit.ticked },
  });
}

export function setTripName(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: EditOf<"setTripName">
): ReviewState {
  if (edit.name.length > MAX_TITLE_LENGTH) return state;
  return accept(withSuggestedNames(draft, { ...state, tripName: edit.name }), edit);
}
