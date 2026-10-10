/**
 * The review page's edits (spec §G): a pure reducer over the draft the server
 * built. The draft itself never changes. What the user did lives in a
 * `ReviewState`, which can be rebuilt from the draft plus the list of edits in
 * `state.edits`; that list is what survives a reload (sessionStorage) and a
 * re-scan (`reapplyEdits`, by the stable station and area keys).
 *
 * Every night and row question goes through the mirrored night plan
 * (`shared/tour/builderNightPlan`), the same code the commit re-derives with,
 * so the page cannot offer a plan the server will refuse.
 *
 * `applyEdit` returns the SAME state object for an edit it refuses, and a new
 * one for an edit it accepts, even when nothing changed. `reapplyEdits` counts
 * on that to say "kept N of M edits".
 */
import type { NightAssign } from "../../shared/tour/builderNightPlan";
import type { RoadtripVehicle } from "../../shared/tour/roadtrip";
import type {
  AreaChoice,
  BuilderLegMode,
  Day,
  DraftArea,
  DraftLeg,
  DraftStation,
  TripBuilderDraft,
} from "../../types/tripBuilder";
import {
  rename,
  setAlbum,
  setAreaName,
  setCountries,
  setFlightTick,
  setLegMode,
  setNote,
  setTripName,
  setVehicle,
  togglePhotoJourney,
} from "./editsBasic";
import { assignNight, setAreaKind } from "./editsNights";
import { fold, merge, remove, toggleHome, toggleSlept } from "./editsStructure";
import { syncArea } from "./reviewRules";

export { logEdit } from "./editLog";

export type DraftEdit =
  | { type: "rename"; stationKey: string; title: string }
  | { type: "setNote"; stationKey: string; notes: string }
  | { type: "merge"; stationKey: string }
  | { type: "delete"; stationKey: string }
  | { type: "toggleSlept"; stationKey: string; slept: boolean }
  | { type: "foldDayTrip"; stationKey: string }
  | { type: "setLegMode"; fromKey: string; toKey: string; mode: BuilderLegMode }
  | { type: "assignNight"; day: Day; assign: NightAssign }
  | { type: "toggleHome"; areaKey: string; end: "start" | "end"; on: boolean }
  | { type: "setAreaKind"; areaKey: string; as: AreaChoice }
  | { type: "setAreaName"; areaKey: string; name: string }
  | { type: "setVehicle"; areaKey: string; vehicle: RoadtripVehicle }
  | { type: "setFlightTick"; flightId: string; ticked: boolean }
  | { type: "setAlbum"; create: boolean; name: string }
  | { type: "setCountries"; countries: string[] }
  | { type: "togglePhotoJourney"; id: string; ticked: boolean }
  | { type: "setTripName"; name: string };

/** One area as the user is shaping it. `legs[i]` joins `stations[i]` and `stations[i + 1]`. */
export interface ReviewArea {
  key: string;
  as: AreaChoice;
  name: string;
  /** The user typed the name; it is no longer recomputed from the trip name and the roadtrip count. */
  nameEdited: boolean;
  vehicle: RoadtripVehicle;
  homeStart: boolean;
  homeEnd: boolean;
  stations: DraftStation[];
  legs: DraftLeg[];
  /** `legs.map((leg) => leg.mode)`, kept in step: the order the commit body sends. */
  legModes: BuilderLegMode[];
}

export interface ReviewState {
  draftId: string;
  /** What was done, oldest first: the part that is persisted and replayed. */
  edits: DraftEdit[];
  tripName: string;
  countries: string[];
  areas: ReviewArea[];
  /** The raw answer for every night; a skipped area's stations read as unknown (`effectiveNights`). */
  nights: Record<Day, NightAssign>;
  flightTicks: Record<string, boolean>;
  photoJourneyTicks: Record<string, boolean>;
  /** Null when the scan did not ask for an album. */
  album: { create: boolean; name: string } | null;
}

function initialArea(area: DraftArea): ReviewArea {
  return syncArea({
    key: area.key,
    as: area.defaultAs,
    name: area.suggestedName,
    nameEdited: false,
    vehicle: "car",
    homeStart: false,
    homeEnd: false,
    stations: area.stations.map((station) => ({ ...station })),
    legs: area.legs.map((leg) => ({ ...leg })),
    legModes: [],
  });
}

export function initialReviewState(draft: TripBuilderDraft): ReviewState {
  return {
    draftId: draft.id,
    edits: [],
    tripName: draft.tripName,
    countries: [...draft.countries],
    areas: draft.areas.map(initialArea),
    nights: Object.fromEntries(
      Object.entries(draft.nights).map(([day, entry]) => [day, entry.assign])
    ),
    flightTicks: Object.fromEntries(
      draft.flights.map((flight) => [flight.id, flight.locked || flight.defaultAssign])
    ),
    photoJourneyTicks: Object.fromEntries(draft.photoJourneys.map((j) => [j.id, true])),
    album: draft.album === null ? null : { create: draft.album.allowed, name: draft.album.name },
  };
}

export function applyEdit(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: DraftEdit
): ReviewState {
  switch (edit.type) {
    case "rename":
      return rename(draft, state, edit);
    case "setNote":
      return setNote(draft, state, edit);
    case "setLegMode":
      return setLegMode(draft, state, edit);
    case "setAreaName":
      return setAreaName(draft, state, edit);
    case "setVehicle":
      return setVehicle(draft, state, edit);
    case "setFlightTick":
      return setFlightTick(draft, state, edit);
    case "setAlbum":
      return setAlbum(draft, state, edit);
    case "setCountries":
      return setCountries(draft, state, edit);
    case "togglePhotoJourney":
      return togglePhotoJourney(draft, state, edit);
    case "setTripName":
      return setTripName(draft, state, edit);
    case "merge":
      return merge(draft, state, edit);
    case "delete":
      return remove(draft, state, edit);
    case "toggleSlept":
      return toggleSlept(draft, state, edit);
    case "foldDayTrip":
      return fold(draft, state, edit);
    case "toggleHome":
      return toggleHome(draft, state, edit);
    case "assignNight":
      return assignNight(draft, state, edit);
    case "setAreaKind":
      return setAreaKind(draft, state, edit);
    default:
      return state;
  }
}

/**
 * Plays `edits` onto a fresh state for `draft`, by the keys they name. An edit
 * whose station, night or flight the new draft no longer has is dropped;
 * `kept` counts the rest.
 */
export function reapplyEdits(
  draft: TripBuilderDraft,
  edits: readonly DraftEdit[]
): { state: ReviewState; kept: number; total: number } {
  let state = initialReviewState(draft);
  let kept = 0;
  for (const edit of edits) {
    const next = applyEdit(draft, state, edit);
    if (next === state) continue;
    state = next;
    kept += 1;
  }
  return { state, kept, total: edits.length };
}
