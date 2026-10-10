/**
 * The review state of an existing trip (spec 2026-10-09 §K.5): the user's
 * keep/remove decisions on stored stations the photos do not show, the album
 * removal switch, and the live status of each station — recomputed from the
 * current night answers with the same rows the server will derive.
 *
 * Pure. `draftEdits.ts` calls in; this file only imports its TYPES.
 */
import {
  deriveStationRows,
  type NightAssign,
  type NightPlanStation,
} from "../../shared/tour/builderNightPlan";
import type {
  CommitBody,
  DraftStation,
  StationStatus,
  TripBuilderDraft,
} from "../../types/tripBuilder";
import type { DraftEdit, ReviewArea, ReviewState } from "./draftEdits";

export interface ExistingReviewState {
  /** Stored station or stop id → keep it. Decided for every not-seen one. */
  keepNotSeen: Record<string, boolean>;
  /** Take members outside the trip dates out of the album. */
  removeOutside: boolean;
}

export type ExistingEdit =
  | { type: "setKeepNotSeen"; existingId: string; keep: boolean }
  | { type: "setRemoveOutside"; remove: boolean };

/** Every stored station and timeline stop the photos do not show. */
export function notSeenStations(draft: TripBuilderDraft): DraftStation[] {
  return [...draft.areas.flatMap((area) => area.notSeen ?? []), ...(draft.notSeenStops ?? [])];
}

export function initialExistingState(draft: TripBuilderDraft): ExistingReviewState | null {
  if (draft.target.kind !== "existing") return null;
  const keepNotSeen: Record<string, boolean> = {};
  for (const station of notSeenStations(draft)) {
    if (station.existingId !== undefined) {
      keepNotSeen[station.existingId] = station.notSeen?.defaultKeep ?? true;
    }
  }
  const removable = draft.album?.sync?.removable;
  return {
    keepNotSeen,
    removeOutside: removable !== undefined && removable.allowed && removable.defaultOn,
  };
}

export function applyExistingEdit(
  existing: ExistingReviewState | null,
  draft: TripBuilderDraft,
  edit: ExistingEdit
): ExistingReviewState | null {
  if (existing === null) return existing;
  if (edit.type === "setKeepNotSeen") {
    if (!Object.prototype.hasOwnProperty.call(existing.keepNotSeen, edit.existingId))
      return existing;
    return { ...existing, keepNotSeen: { ...existing.keepNotSeen, [edit.existingId]: edit.keep } };
  }
  const removable = draft.album?.sync?.removable;
  if (removable === undefined || !removable.allowed) return existing;
  return { ...existing, removeOutside: edit.remove };
}

/** A stored roadtrip cannot become timeline stops: the server refuses it, so the reducer does too. */
export function refusesExistingEdit(draft: TripBuilderDraft, edit: DraftEdit): boolean {
  return (
    edit.type === "setAreaKind" &&
    edit.as === "stops" &&
    draft.areas.find((area) => area.key === edit.areaKey)?.roadtripId !== undefined
  );
}

/**
 * The re-sync fields of the commit body: the stored roadtrip of each area, the
 * stored station of each matched station, the keep and remove lists, and the
 * album switch. `buildCommitBody` returns its body through this.
 */
export function withExistingFields(
  body: CommitBody,
  draft: TripBuilderDraft,
  state: ReviewState
): CommitBody {
  const existing = state.existing;
  if (existing === null || body.target.kind !== "existing") return body;
  const keep = (id: string): boolean => existing.keepNotSeen[id] ?? true;
  const idsOf = (stations: readonly DraftStation[] | undefined): string[] =>
    (stations ?? []).flatMap((s) => (s.existingId === undefined ? [] : [s.existingId]));

  const areas = body.areas.map((area) => {
    const draftArea = draft.areas.find((a) => a.key === area.key);
    const reviewArea = state.areas.find((a) => a.key === area.key);
    const given = new Map((reviewArea?.stations ?? []).map((s) => [s.key, s.existingId] as const));
    const stations = area.stations.map((station) => {
      const existingId = given.get(station.key);
      return existingId === undefined ? station : { ...station, existingId };
    });
    if (draftArea?.roadtripId === undefined) return { ...area, stations };
    const notSeen = idsOf(draftArea.notSeen);
    return {
      ...area,
      stations,
      roadtripId: draftArea.roadtripId,
      keepNotSeen: notSeen.filter(keep),
      removeNotSeen: notSeen.filter((id) => !keep(id)),
    };
  });

  const stopIds = idsOf(draft.notSeenStops);
  return {
    ...body,
    areas,
    stops: { keep: stopIds.filter(keep), remove: stopIds.filter((id) => !keep(id)) },
    album: { ...body.album, removeOutside: existing.removeOutside },
  };
}

// ─── Live status ─────────────────────────────────────────────────────────────

/** The first row a station would store under the current night answers. */
export interface StationRowFacts {
  startDate: string;
  endDate: string;
  slept: boolean;
}

export function rowFactsFor(
  area: Pick<ReviewArea, "stations">,
  nights: Readonly<Record<string, NightAssign>>
): Map<string, StationRowFacts> {
  const planStations: NightPlanStation[] = area.stations.map((s) => ({
    key: s.key,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    firstDay: s.firstDay,
    lastDay: s.lastDay,
    notes: s.notes,
  }));
  const facts = new Map<string, StationRowFacts>();
  for (const row of deriveStationRows(planStations, nights)) {
    if (row.key === row.stationKey) {
      facts.set(row.stationKey, {
        startDate: row.startDate,
        endDate: row.endDate,
        slept: row.slept,
      });
    }
  }
  return facts;
}

/**
 * Same / changed from what is stored and what the current night answers give,
 * by the rule the server applies (`matchStatus`): a stored stay agrees with any
 * night. `new` and `not seen` are the draft's word.
 */
export function liveStatus(
  station: DraftStation,
  facts: StationRowFacts | undefined
): StationStatus | null {
  if (station.status === undefined) return null;
  if (station.status === "new" || station.status === "notSeen") return station.status;
  const before = station.before;
  if (before === undefined || facts === undefined) return station.status;
  const agrees =
    before.startDate === facts.startDate &&
    before.endDate === facts.endDate &&
    (before.stay || before.slept === facts.slept);
  return agrees ? "same" : "changed";
}

/** Nights a roadtrip counts for a station: a slept one at least one, a pass none. */
export function nightCount(
  startDate: string | null,
  endDate: string | null,
  slept: boolean
): number {
  if (!slept) return 0;
  if (startDate === null || endDate === null) return 1;
  const span = Math.round(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000
  );
  return Math.max(1, span);
}
