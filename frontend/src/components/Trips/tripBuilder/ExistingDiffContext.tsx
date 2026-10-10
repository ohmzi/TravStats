/**
 * What the review rows of an existing trip need to know without every row
 * taking props: their live status, whether unchanged rows are collapsed, the
 * not-seen lists and the decisions on them, and the album switch. Without a
 * provider the value is inactive, so a new trip's rows are untouched.
 */
import { createContext, useContext, useMemo, useState, type JSX, type ReactNode } from "react";

import type { DraftEdit, ReviewState } from "../../../lib/tripBuilder/draftEdits";
import {
  liveStatus,
  rowFactsFor,
  type StationRowFacts,
} from "../../../lib/tripBuilder/existingReview";
import type {
  AlbumSyncPreview,
  DraftStation,
  StationStatus,
  TripBuilderDraft,
} from "../../../types/tripBuilder";

export interface StationInfo {
  status: StationStatus | null;
  facts: StationRowFacts | undefined;
  hidden: boolean;
}

export interface ExistingDiffValue {
  active: boolean;
  showUnchanged: boolean;
  setShowUnchanged: (next: boolean) => void;
  unchangedCount: number;
  infoFor: (station: DraftStation) => StationInfo;
  /** `null`: the trip's timeline stops. */
  notSeenOf: (areaKey: string | null) => DraftStation[];
  isKept: (existingId: string) => boolean;
  setKept: (existingId: string, keep: boolean) => void;
  albumSync: {
    sync: AlbumSyncPreview;
    removeOutside: boolean;
    setRemoveOutside: (next: boolean) => void;
  } | null;
}

const INACTIVE: ExistingDiffValue = {
  active: false,
  showUnchanged: true,
  setShowUnchanged: () => undefined,
  unchangedCount: 0,
  infoFor: () => ({ status: null, facts: undefined, hidden: false }),
  notSeenOf: () => [],
  isKept: () => true,
  setKept: () => undefined,
  albumSync: null,
};

const Context = createContext<ExistingDiffValue>(INACTIVE);

export function useExistingDiff(): ExistingDiffValue {
  return useContext(Context);
}

/** Something to review: a station that is not unchanged, or anything the photos do not show. */
function hasChanges(draft: TripBuilderDraft): boolean {
  return (
    (draft.notSeenStops?.length ?? 0) > 0 ||
    draft.areas.some(
      (area) =>
        (area.notSeen?.length ?? 0) > 0 ||
        area.stations.some((s) => s.status !== undefined && s.status !== "same")
    )
  );
}

export function ExistingDiffProvider({
  draft,
  state,
  onEdit,
  children,
}: {
  draft: TripBuilderDraft;
  state: ReviewState;
  onEdit: (edit: DraftEdit) => void;
  children: ReactNode;
}): JSX.Element {
  const [showUnchanged, setShowUnchanged] = useState(() => !hasChanges(draft));
  const existing = state.existing;

  const value = useMemo((): ExistingDiffValue => {
    if (draft.target.kind !== "existing" || existing === null) return INACTIVE;
    const facts = new Map<string, StationRowFacts>();
    for (const area of state.areas) {
      for (const [key, row] of rowFactsFor(area, state.nights)) facts.set(key, row);
    }
    // Roadtrip areas follow the night answers; a stops area keeps the status the draft gave its stop.
    const live = new Set(
      draft.areas
        .filter((a) => a.roadtripId !== undefined)
        .flatMap((a) => a.stations.map((s) => s.key))
    );
    const statusOf = (s: DraftStation): StationStatus | null =>
      live.has(s.key) ? liveStatus(s, facts.get(s.key)) : (s.status ?? null);
    const unchangedCount = state.areas.reduce(
      (n, area) => n + area.stations.filter((s) => statusOf(s) === "same").length,
      0
    );
    const removable = draft.album?.sync;
    return {
      active: true,
      showUnchanged,
      setShowUnchanged,
      unchangedCount,
      infoFor: (station) => {
        const status = statusOf(station);
        return {
          status,
          facts: facts.get(station.key),
          hidden: !showUnchanged && status === "same",
        };
      },
      notSeenOf: (areaKey) =>
        areaKey === null
          ? (draft.notSeenStops ?? [])
          : (draft.areas.find((a) => a.key === areaKey)?.notSeen ?? []),
      isKept: (id) => existing.keepNotSeen[id] ?? true,
      setKept: (existingId, keep) => onEdit({ type: "setKeepNotSeen", existingId, keep }),
      albumSync: removable
        ? {
            sync: removable,
            removeOutside: existing.removeOutside,
            setRemoveOutside: (remove) => onEdit({ type: "setRemoveOutside", remove }),
          }
        : null,
    };
  }, [draft, state.areas, state.nights, existing, showUnchanged, onEdit]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
