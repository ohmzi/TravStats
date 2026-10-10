/**
 * Reconciling a derived itinerary with what an existing trip already holds
 * (spec 2026-10-09 §K.2). Pure: no clock, no I/O.
 *
 * A derived station matches a stored station of the same roadtrip when the two
 * lie within `CITY_LINK_KM` and either their days overlap or their titles are
 * equal. Each pair is `same` or `changed`; a derived station with no partner is
 * `new`; a stored one is `notSeen`. A match keeps the stored id, title (unless it
 * is only the old coordinate fallback), notes, stay, place and coordinates — the
 * coordinates so the legs, which are keyed by their endpoint stops, keep their
 * routed geometry. The stay owns the night, so a stored stay agrees with any
 * derived night.
 *
 * Route corrections (`night: "via"`) are never matched and never listed: the
 * commit keeps every one of them, in place.
 */
import { distanceKm } from "../photoJourneys/cluster";
import {
  isSleptNight,
  type ExistingStation,
  type NotSeenReason,
  type StationBefore,
} from "./existingTypes";
import { CITY_LINK_KM } from "./thresholds";
import type { Day, TitleSource } from "./types";

/** What reconcile needs of a derived station: the first row it would store, and where its title came from. */
export interface DerivedStation {
  key: string;
  title: string;
  titleSource: TitleSource;
  lat: number;
  lon: number;
  startDate: Day;
  endDate: Day;
  slept: boolean;
}

export interface ReconcileWindow {
  startDay: Day;
  endDay: Day;
}

export interface ReconciledStation {
  key: string;
  status: "same" | "changed" | "new";
  existing?: ExistingStation;
  title: string;
  lat: number;
  lon: number;
  before?: StationBefore;
}

export interface NotSeenStation {
  stored: ExistingStation;
  defaultKeep: boolean;
  reason: NotSeenReason;
}

export interface ReconciledStations {
  /** One per input station, in the same order. */
  derived: ReconciledStation[];
  /** Stored stations with no match, in stored order. */
  notSeen: NotSeenStation[];
  /** Route corrections: always kept, never shown. */
  vias: ExistingStation[];
}

const COORDINATE_TITLE =
  /^\s*-?\d{1,3}(?:\.\d+)?\s*°?\s*[NSEW]?\s*[,;\s]\s*-?\d{1,3}(?:\.\d+)?\s*°?\s*[NSEW]?\s*$/i;

/** A title that is only a coordinate: what `nameClusters` falls back to when nothing names the place. */
export function isCoordinateTitle(title: string): boolean {
  return COORDINATE_TITLE.test(title);
}

/** The stored title wins, unless it is only the old coordinate fallback and the new one is a real name. */
export function keptTitle(
  derived: Pick<DerivedStation, "title" | "titleSource">,
  stored: Pick<ExistingStation, "title">
): string {
  const unusable =
    stored.title.trim() === "" ||
    (isCoordinateTitle(stored.title) && derived.titleSource !== "coords");
  return unusable ? derived.title : stored.title;
}

function sameTitle(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  return left !== "" && left === b.trim().toLowerCase();
}

function daysOverlap(
  aStart: Day | null,
  aEnd: Day | null,
  bStart: Day | null,
  bEnd: Day | null
): boolean {
  const from = aStart ?? aEnd;
  const to = aEnd ?? aStart;
  const otherFrom = bStart ?? bEnd;
  const otherTo = bEnd ?? bStart;
  if (from === null || to === null || otherFrom === null || otherTo === null) return false;
  return from <= otherTo && otherFrom <= to;
}

/** Entirely outside the window: a station the new dates no longer reach. Undated: unknown, so no. */
export function liesOutsideWindow(
  stored: Pick<ExistingStation, "startDate" | "endDate">,
  window: ReconcileWindow
): boolean {
  const start = stored.startDate ?? stored.endDate;
  const end = stored.endDate ?? stored.startDate;
  if (start === null || end === null) return false;
  return end < window.startDay || start > window.endDay;
}

/** `same` when dates and night agree; a stored stay agrees with any night. */
export function matchStatus(
  derived: Pick<DerivedStation, "startDate" | "endDate" | "slept">,
  stored: ExistingStation
): "same" | "changed" {
  const nightAgrees = stored.night === "stay" || isSleptNight(stored.night) === derived.slept;
  return stored.startDate === derived.startDate && stored.endDate === derived.endDate && nightAgrees
    ? "same"
    : "changed";
}

function beforeOf(stored: ExistingStation): StationBefore {
  return {
    startDate: stored.startDate,
    endDate: stored.endDate,
    slept: isSleptNight(stored.night),
    stay: stored.night === "stay",
  };
}

interface Candidate {
  derivedIndex: number;
  storedIndex: number;
  sameTitle: boolean;
  overlap: boolean;
  km: number;
}

/** Equal title and overlap first, then equal title, then overlap; ties by distance, then by order. */
function rank(c: Candidate): number {
  return (c.sameTitle ? 0 : 2) + (c.overlap ? 0 : 1);
}

function candidatesOf(
  derived: readonly DerivedStation[],
  stored: readonly ExistingStation[]
): Candidate[] {
  const out: Candidate[] = [];
  derived.forEach((d, derivedIndex) => {
    stored.forEach((s, storedIndex) => {
      if (s.night === "via") return;
      const km = distanceKm(d, s);
      if (km > CITY_LINK_KM) return;
      const titleEq = sameTitle(d.title, s.title);
      const overlap = daysOverlap(d.startDate, d.endDate, s.startDate, s.endDate);
      if (!titleEq && !overlap) return;
      out.push({ derivedIndex, storedIndex, sameTitle: titleEq, overlap, km });
    });
  });
  return out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.km - b.km ||
      a.derivedIndex - b.derivedIndex ||
      a.storedIndex - b.storedIndex
  );
}

/**
 * Pairs the derived stations of one area with the stored stations of one
 * roadtrip, best pair first, each station used once.
 */
export function reconcileStations(
  derived: readonly DerivedStation[],
  stored: readonly ExistingStation[],
  window: ReconcileWindow
): ReconciledStations {
  const matchOf = new Map<number, number>();
  const taken = new Set<number>();
  for (const c of candidatesOf(derived, stored)) {
    if (matchOf.has(c.derivedIndex) || taken.has(c.storedIndex)) continue;
    matchOf.set(c.derivedIndex, c.storedIndex);
    taken.add(c.storedIndex);
  }

  const derivedOut = derived.map((d, index): ReconciledStation => {
    const storedIndex = matchOf.get(index);
    if (storedIndex === undefined) {
      return { key: d.key, status: "new", title: d.title, lat: d.lat, lon: d.lon };
    }
    const s = stored[storedIndex];
    return {
      key: d.key,
      status: matchStatus(d, s),
      existing: s,
      title: keptTitle(d, s),
      lat: s.lat,
      lon: s.lon,
      before: beforeOf(s),
    };
  });

  const notSeen = stored.flatMap((s, index): NotSeenStation[] => {
    if (s.night === "via" || taken.has(index)) return [];
    const outside = liesOutsideWindow(s, window);
    return [
      { stored: s, defaultKeep: !outside, reason: outside ? "outsideWindow" : "notInPhotos" },
    ];
  });

  return { derived: derivedOut, notSeen, vias: stored.filter((s) => s.night === "via") };
}

export type FinalEntry =
  { kind: "derived"; index: number } | { kind: "kept"; stored: ExistingStation };

/**
 * The final order of a roadtrip being updated: the derived stations as they are,
 * with every kept stored station (not-seen ones the user kept, and all route
 * corrections) put right after the nearest stored station before it that is
 * still in the list. A stored station that is neither matched nor kept is gone.
 */
export function interleaveKept(
  derivedExistingIds: ReadonlyArray<string | undefined>,
  stored: readonly ExistingStation[],
  keepIds: ReadonlySet<string>
): FinalEntry[] {
  const order = derivedExistingIds.map((_, index): FinalEntry => ({ kind: "derived", index }));
  const positionOf = (id: string): number =>
    order.findIndex((entry) =>
      entry.kind === "derived" ? derivedExistingIds[entry.index] === id : entry.stored.id === id
    );
  let previous: string | null = null;
  for (const s of stored) {
    if (derivedExistingIds.includes(s.id)) {
      previous = s.id;
      continue;
    }
    if (s.night !== "via" && !keepIds.has(s.id)) continue;
    const at = previous === null ? 0 : positionOf(previous) + 1;
    order.splice(at, 0, { kind: "kept", stored: s });
    previous = s.id;
  }
  return order;
}
