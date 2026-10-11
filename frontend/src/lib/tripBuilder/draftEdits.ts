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
  CommitArea,
  CommitBody,
  CommitStation,
  CommitTarget,
  Day,
  DraftArea,
  DraftLeg,
  DraftStation,
  TripBuilderDraft,
} from "../../types/tripBuilder";
import type { CreateTripInput } from "../api/trips";
import { logEdit } from "./editLog";
import {
  rename,
  setAlbum,
  setAreaAlbum,
  setAreaName,
  setCountries,
  setFlightTick,
  setLegMode,
  setNote,
  setStopoverTick,
  setTripName,
  setVehicle,
  togglePhotoJourney,
} from "./editsBasic";
import { assignNight, setAreaKind } from "./editsNights";
import { fold, merge, remove, toggleHome, toggleSlept } from "./editsStructure";
import {
  applyExistingEdit,
  initialExistingState,
  refusesExistingEdit,
  withExistingFields,
  type ExistingEdit,
  type ExistingReviewState,
} from "./existingReview";
import { effectiveNights } from "./planRules";
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
  | { type: "setAreaAlbum"; areaKey: string; album: boolean }
  | { type: "setAreaName"; areaKey: string; name: string }
  | { type: "setVehicle"; areaKey: string; vehicle: RoadtripVehicle }
  | { type: "setFlightTick"; flightId: string; ticked: boolean }
  | { type: "setAlbum"; create: boolean; name: string }
  | { type: "setCountries"; countries: string[] }
  | { type: "togglePhotoJourney"; id: string; ticked: boolean }
  | { type: "setStopoverTick"; key: string; roadtrip: boolean; album: boolean }
  | { type: "setTripName"; name: string }
  | ExistingEdit;

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
  /** The pitstop's own album tick (spec 2026-10-11 pitstops §3); false for an ordinary area. */
  album: boolean;
  stations: DraftStation[];
  legs: DraftLeg[];
  /** `legs.map((leg) => leg.mode)`, kept in step: the order the commit body sends. */
  legModes: BuilderLegMode[];
}

/** The two switches of one stopover: `album` is only ever on when `roadtrip` is (spec §3). */
export interface StopoverTick {
  roadtrip: boolean;
  album: boolean;
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
  /** One entry per draft stopover: switch 1, and switch 2 which needs switch 1 (spec §3). */
  stopoverTicks: Record<string, StopoverTick>;
  /** Null when the scan did not ask for an album. */
  album: { create: boolean; name: string } | null;
  /** Re-sync only (spec §K.5): the keep/remove choices and the album removal switch; null for a new trip. */
  existing: ExistingReviewState | null;
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
    // A pitstop's own album starts ON (spec 2026-10-11 pitstops §3).
    album: area.pitstop !== undefined,
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
    stopoverTicks: Object.fromEntries(
      (draft.stopovers ?? []).map((stopover) => [
        stopover.key,
        // A matched stopover is already written, so both switches start on and locked
        // (spec §6). The re-scan sets `stored`; the mirror's older flat pair is read too.
        stopover.roadtripId !== undefined || stopover.stored !== undefined
          ? { roadtrip: true, album: true }
          : { roadtrip: false, album: false },
      ])
    ),
    album: draft.album === null ? null : { create: draft.album.allowed, name: draft.album.name },
    existing: initialExistingState(draft),
  };
}

export function applyEdit(
  draft: TripBuilderDraft,
  state: ReviewState,
  edit: DraftEdit
): ReviewState {
  if (edit.type === "setKeepNotSeen" || edit.type === "setRemoveOutside") {
    const existing = applyExistingEdit(state.existing, draft, edit);
    return existing === state.existing ? state : logEdit({ ...state, existing }, edit);
  }
  if (refusesExistingEdit(draft, edit)) return state;
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
    case "setStopoverTick":
      return setStopoverTick(draft, state, edit);
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
    case "setAreaAlbum":
      return setAreaAlbum(draft, state, edit);
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

function commitStation(station: DraftStation): CommitStation {
  return {
    key: station.key,
    title: station.title,
    lat: station.lat,
    lon: station.lon,
    kind: station.kind,
    firstDay: station.firstDay,
    lastDay: station.lastDay,
    notes: station.notes,
  };
}

function commitArea(area: ReviewArea, fallbackName: string): CommitArea {
  return {
    key: area.key,
    as: area.as,
    name: area.name.trim() || fallbackName,
    vehicle: area.vehicle,
    homeStart: area.homeStart,
    homeEnd: area.homeEnd,
    // `album ⇒ roadtrip` (spec 2026-10-11 pitstops §4): a tick left on under a
    // kind the switch is disabled for is not sent.
    album: area.as === "roadtrip" && area.album,
    stations: area.stations.map(commitStation),
    legModes: area.legModes,
  };
}

function commitTarget(
  draft: TripBuilderDraft,
  state: ReviewState,
  form: CreateTripInput
): CommitTarget {
  if (draft.target.kind === "existing") {
    const moved =
      (form.startDate !== undefined && form.startDate !== draft.window.startDay) ||
      (form.endDate !== undefined && form.endDate !== draft.window.endDay);
    return {
      kind: "existing",
      tripId: draft.target.tripId,
      applyWindow: moved,
      countries: state.countries,
    };
  }
  return {
    kind: "new",
    trip: {
      ...form,
      name: state.tripName.trim(),
      startDate: draft.window.startDay,
      endDate: draft.window.endDay,
      countries: state.countries,
    },
  };
}

/**
 * What `POST /trip-builder/drafts/:id/commit` takes. Every area goes, `skip`
 * ones too; the nights go as the commit will read them (`effectiveNights`);
 * flights already on the target trip stay where they are.
 */
export function buildCommitBody(
  draft: TripBuilderDraft,
  state: ReviewState,
  form: CreateTripInput,
  commitKey: string
): CommitBody {
  const fallbackName = state.tripName.trim() || draft.tripName;
  const body: CommitBody = {
    commitKey,
    window: { startDay: draft.window.startDay, endDay: draft.window.endDay },
    target: commitTarget(draft, state, form),
    flightIds: draft.flights
      .filter((flight) => !flight.locked && state.flightTicks[flight.id] === true)
      .map((flight) => flight.id),
    nights: effectiveNights(state),
    areas: state.areas.map((area) => commitArea(area, fallbackName)),
    stopovers: (draft.stopovers ?? [])
      .map((stopover) => ({
        key: stopover.key,
        roadtrip: state.stopoverTicks[stopover.key]?.roadtrip === true,
        album: state.stopoverTicks[stopover.key]?.album === true,
      }))
      .filter((entry) => entry.roadtrip),
    photoJourneyIds: draft.photoJourneys
      .filter((journey) => state.photoJourneyTicks[journey.id] === true)
      .map((journey) => journey.id),
    album: {
      create: state.album?.create === true,
      name: (state.album?.name ?? "").trim() || fallbackName,
    },
  };
  return withExistingFields(body, draft, state);
}
