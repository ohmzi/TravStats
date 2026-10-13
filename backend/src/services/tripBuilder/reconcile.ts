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
  type ExistingRoadtrip,
  type ExistingStation,
  type ExistingStop,
  type ExistingTripState,
  type NotSeenReason,
  type StationBefore,
} from "./existingTypes";
import { CITY_LINK_KM } from "./thresholds";
import type { AreaKind, Day, DraftStation, TitleSource } from "./types";

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

/**
 * Do the two spans share a day? Spans touching at one day count as sharing it,
 * and a span dated at only one end is read as the day it names; a span with no
 * day at all never overlaps.
 */
export function daysOverlap(
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

/** What the cross-row check needs of a scanned station: where it is and when. A `DraftStation`, a `PlanStation` and a commit body's station all fit. */
export interface CrossRowStation {
  title: string;
  lat: number;
  lon: number;
  firstDay: Day;
  lastDay: Day;
}

/** A scanned station that also stands on another roadtrip of the journey. */
export interface CrossRowMatch {
  /** Index into the scanned list. */
  index: number;
  /** The other roadtrip of the journey whose stored station it also stands on. */
  routeId: string;
  routeName: string;
}

/**
 * The scanned stations that also stand on ANOTHER roadtrip of the journey: a
 * pair `reconcileStations` matches (within `CITY_LINK_KM`, equal titles or
 * overlapping days) whose DAYS actually overlap. An equal title alone pairs
 * across date ranges too — a hub city the owner's journeys repeat between
 * trips — and that is the other trip's own stay, never this write's; a pair
 * whose days touch, one day included, is. `roadtrips` names the OTHER trips:
 * the caller filters its own route out. Each station is reported once, the
 * first roadtrip of the list winning.
 *
 * One rule, two readers: the route-scoped scan leaves these stops out of the
 * draft (`annotateDraftForRoute`) and the route-scoped commit refuses a write
 * plan that still carries one (`assertNoCrossRowWrite`).
 */
export function crossRowMatches(
  stations: readonly CrossRowStation[],
  roadtrips: readonly ExistingRoadtrip[],
  window: ReconcileWindow
): CrossRowMatch[] {
  const found = new Map<number, CrossRowMatch>();
  for (const roadtrip of roadtrips) {
    // Only the match is read here, so the derived title's source is inert.
    const derived: DerivedStation[] = stations.map((station, index) => ({
      key: String(index),
      title: station.title,
      titleSource: "geocode",
      lat: station.lat,
      lon: station.lon,
      startDate: station.firstDay,
      endDate: station.lastDay,
      slept: false,
    }));
    reconcileStations(derived, roadtrip.stations, window).derived.forEach((rec, index) => {
      if (rec.existing === undefined || found.has(index)) return;
      const station = stations[index];
      if (
        daysOverlap(station.firstDay, station.lastDay, rec.existing.startDate, rec.existing.endDate)
      ) {
        found.set(index, { index, routeId: roadtrip.id, routeName: roadtrip.name });
      }
    });
  }
  return [...found.values()].sort((a, b) => a.index - b.index);
}

/** What the photo-level cross-row check needs of a photo: where it was taken and when. */
export interface CrossRowPhoto {
  id: string;
  lat: number | null;
  lon: number | null;
  day: Day;
}

/** A photo that also stands on another roadtrip of the journey: its (day, place) reconciles. */
export interface CrossRowPhotoMatch {
  photo: CrossRowPhoto;
  /** The other roadtrip of the journey whose stored station it stands on. */
  routeId: string;
  routeName: string;
}

/**
 * The scanned PHOTOS that also stand on ANOTHER roadtrip of the journey
 * (owner request 2026-10-12, the scoped scan's photo filter): the same rule
 * `crossRowMatches` reads, one level down. A photo is a one-day, untitled stop
 * at its own coordinates, so `reconcileStations` can only pair it through the
 * DAYS OVERLAP arm (`daysOverlap` against a stored station's span) and
 * `crossRowMatches`'s own check is that same overlap — which is why this reads
 * the two shared pieces directly (`CITY_LINK_KM` and `daysOverlap`, route
 * corrections excluded as everywhere) instead of the station bookkeeping:
 * photos do not pair one-to-one with stored stations the way scanned stops do,
 * and every photo at one station belongs to it.
 *
 * Only located photos can stand anywhere; a photo with no place of its own is
 * never reported. Each photo is reported once, the first roadtrip of the list
 * winning, as in `crossRowMatches`. No window is read: the window only shapes
 * a station's not-seen list, and a photo has no such list.
 */
export function crossRowPhotoMatches(
  photos: readonly CrossRowPhoto[],
  roadtrips: readonly ExistingRoadtrip[]
): CrossRowPhotoMatch[] {
  const matches: CrossRowPhotoMatch[] = [];
  for (const photo of photos) {
    const { lat, lon } = photo;
    if (lat === null || lon === null) continue;
    const found = roadtrips.find((roadtrip) =>
      roadtrip.stations.some(
        (station) =>
          station.night !== "via" &&
          distanceKm({ lat, lon }, station) <= CITY_LINK_KM &&
          daysOverlap(photo.day, photo.day, station.startDate, station.endDate)
      )
    );
    if (found !== undefined) {
      matches.push({ photo, routeId: found.id, routeName: found.name });
    }
  }
  return matches;
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

// ─── Areas to roadtrips ──────────────────────────────────────────────────────

export interface ReconcileArea {
  key: string;
  kind: AreaKind;
  /** The name the area would get as a new roadtrip (`suggestedName`). */
  name: string;
  stations: readonly DerivedStation[];
}

export interface RoadtripMatch {
  areaKey: string;
  roadtripId: string;
  /** The stored roadtrip's own name: what the review shows, and keeps, unless renamed. */
  name: string;
  reconciled: ReconciledStations;
}

/**
 * Each derived area that would become a roadtrip is matched to a roadtrip of the
 * trip: first by the number of stations the two share (most wins, best pair
 * first), then by name. A roadtrip serves one area, an area one roadtrip; an
 * area left over becomes a new roadtrip, and a roadtrip left over is not touched.
 * A match carries the stored roadtrip's own name: the review shows that name for
 * the area, so the field the user edits is the one the commit keeps or renames.
 */
export function matchAreasToRoadtrips(
  areas: readonly ReconcileArea[],
  roadtrips: readonly ExistingRoadtrip[],
  window: ReconcileWindow
): RoadtripMatch[] {
  const scored: Array<{
    area: ReconcileArea;
    roadtrip: ExistingRoadtrip;
    reconciled: ReconciledStations;
    hits: number;
  }> = [];
  for (const area of areas) {
    if (area.kind !== "roadtrip") continue;
    for (const roadtrip of roadtrips) {
      const reconciled = reconcileStations(area.stations, roadtrip.stations, window);
      const hits = reconciled.derived.filter((d) => d.existing !== undefined).length;
      scored.push({ area, roadtrip, reconciled, hits });
    }
  }

  const usedAreas = new Set<string>();
  const usedRoadtrips = new Set<string>();
  const matches: RoadtripMatch[] = [];
  const take = (s: (typeof scored)[number]): void => {
    usedAreas.add(s.area.key);
    usedRoadtrips.add(s.roadtrip.id);
    matches.push({
      areaKey: s.area.key,
      roadtripId: s.roadtrip.id,
      name: s.roadtrip.name,
      reconciled: s.reconciled,
    });
  };

  for (const s of [...scored].sort((a, b) => b.hits - a.hits)) {
    if (s.hits === 0 || usedAreas.has(s.area.key) || usedRoadtrips.has(s.roadtrip.id)) continue;
    take(s);
  }
  for (const s of scored) {
    if (usedAreas.has(s.area.key) || usedRoadtrips.has(s.roadtrip.id)) continue;
    if (sameTitle(s.area.name, s.roadtrip.name)) take(s);
  }
  return matches;
}

// ─── Stopovers to roadtrips ──────────────────────────────────────────────────

export interface ReconcileStopover {
  key: string;
  /** The computed title (the trip's minted name): what a stored roadtrip's name must equal. */
  title: string;
  /** The tour's first day (the minimum `firstDay` over its stations). */
  dayFrom: Day;
  /**
   * The tour's last day (the maximum `lastDay`): a tour that crosses midnight
   * spans two days (final review, finding S1), so the match runs over this span
   * and not over the stopover's single day.
   */
  dayTo: Day;
}

export interface StopoverMatch {
  key: string;
  roadtripId: string;
  /** The stored roadtrip's own name (equal to the title, bar case): the commit re-checks it. */
  name: string;
}

/** Every dated, non-correction station lies inside `[dayFrom, dayTo]`, and at least one station is dated. */
function landsInsideSpan(roadtrip: ExistingRoadtrip, dayFrom: Day, dayTo: Day): boolean {
  const dated = roadtrip.stations.filter(
    (station) => station.night !== "via" && (station.startDate !== null || station.endDate !== null)
  );
  if (dated.length === 0) return false;
  return dated.every((station) => {
    const start = station.startDate ?? station.endDate;
    const end = station.endDate ?? station.startDate;
    return start !== null && end !== null && start >= dayFrom && end <= dayTo;
  });
}

/**
 * The re-sync's stopover match pass (spec 2026-10-11 §6). Storage carries no
 * stopover key and none is added, so a draft stopover claims the trip's
 * roadtrip whose name equals its computed title and whose stations' days all
 * fall inside the stopover's own tour span. That span, not the single stopover
 * day, is what the match must use: the commit writes the tour's spans back
 * unchanged (`deriveStationRows` with no nights), so a midnight-crossing tour —
 * or an airport station on the arrival day, earlier than the first outing
 * photo's — would otherwise never re-claim its own roadtrip, and the review
 * would offer it as new on every scan (final review, finding S1). A roadtrip
 * serves one stopover, a stopover one roadtrip; the returned ids are the claims
 * `reconcileTrip` filters out of the area match, so no area can ever match,
 * steal or duplicate a stopover roadtrip.
 */
export function claimStopovers(
  stopovers: readonly ReconcileStopover[],
  roadtrips: readonly ExistingRoadtrip[]
): StopoverMatch[] {
  const used = new Set<string>();
  const matches: StopoverMatch[] = [];
  for (const stopover of stopovers) {
    const found = roadtrips.find(
      (roadtrip) =>
        !used.has(roadtrip.id) &&
        sameTitle(stopover.title, roadtrip.name) &&
        landsInsideSpan(roadtrip, stopover.dayFrom, stopover.dayTo)
    );
    if (found === undefined) continue;
    used.add(found.id);
    matches.push({ key: stopover.key, roadtripId: found.id, name: found.name });
  }
  return matches;
}

// ─── Timeline stops ──────────────────────────────────────────────────────────

export interface StopArea {
  key: string;
  stations: ReadonlyArray<
    Pick<
      DraftStation,
      "key" | "title" | "titleSource" | "kind" | "lat" | "lon" | "firstDay" | "lastDay"
    >
  >;
}

/** The first to the last day over a `stops` area's ground stations or a stopover's tour; both are not empty. */
export function groundSpan(ground: ReadonlyArray<{ firstDay: Day; lastDay: Day }>): {
  startDate: Day;
  endDate: Day;
} {
  const [first] = ground;
  return {
    startDate: ground.reduce((min, s) => (s.firstDay < min ? s.firstDay : min), first.firstDay),
    endDate: ground.reduce((max, s) => (s.lastDay > max ? s.lastDay : max), first.lastDay),
  };
}

/**
 * The one stop a `stops` area stands for: its first ground station, over the
 * area's first to last ground day. Home and airport stations are not stops. The
 * returned key is the station that carries the stop's status in the review.
 */
export function derivedStopOf(area: StopArea): DerivedStation | null {
  const ground = area.stations.filter((s) => s.kind !== "home" && s.kind !== "airport");
  if (ground.length === 0) return null;
  const first = ground[0];
  return {
    key: first.key,
    title: first.title,
    titleSource: first.titleSource,
    lat: first.lat,
    lon: first.lon,
    ...groundSpan(ground),
    slept: false,
  };
}

/** A timeline stop read as a station that was passed, so the same matching rules apply. */
export function stopAsStation(stop: ExistingStop): ExistingStation {
  return {
    id: stop.id,
    title: stop.title,
    lat: stop.lat,
    lon: stop.lon,
    startDate: stop.startDay,
    endDate: stop.endDay,
    night: "pass",
    lodgingStayId: null,
    placeId: null,
    notes: stop.notes,
  };
}

export interface StopsReconcile {
  /** Area key → how its stop stands (`new` when nothing is stored for it). */
  matched: Map<string, ReconciledStation>;
  /** Stored stops no area matched. */
  notSeen: NotSeenStation[];
}

export function reconcileStops(
  areas: readonly StopArea[],
  stops: readonly ExistingStop[],
  window: ReconcileWindow
): StopsReconcile {
  const derived: DerivedStation[] = [];
  const areaKeys: string[] = [];
  for (const area of areas) {
    const stop = derivedStopOf(area);
    if (stop === null) continue;
    derived.push(stop);
    areaKeys.push(area.key);
  }
  const result = reconcileStations(derived, stops.map(stopAsStation), window);
  const matched = new Map<string, ReconciledStation>();
  result.derived.forEach((rec, index) => matched.set(areaKeys[index], rec));
  return { matched, notSeen: result.notSeen };
}

// ─── The whole trip ──────────────────────────────────────────────────────────

export interface TripReconcileInput {
  window: ReconcileWindow;
  roadtripAreas: readonly ReconcileArea[];
  stopAreas: readonly StopArea[];
  /** The draft's stopover candidates (spec 2026-10-11 §2.3): matched before the areas. */
  stopovers: readonly ReconcileStopover[];
  state: Pick<ExistingTripState, "roadtrips" | "stops">;
}

export interface TripReconcile {
  roadtrips: RoadtripMatch[];
  stops: StopsReconcile;
  stopovers: StopoverMatch[];
}

export function reconcileTrip(input: TripReconcileInput): TripReconcile {
  // The stopover claims run FIRST: a roadtrip a stopover owns never reaches the
  // area match, so no area can match, steal or duplicate it (spec §6).
  const stopovers = claimStopovers(input.stopovers, input.state.roadtrips);
  const claimed = new Set(stopovers.map((match) => match.roadtripId));
  return {
    roadtrips: matchAreasToRoadtrips(
      input.roadtripAreas,
      input.state.roadtrips.filter((roadtrip) => !claimed.has(roadtrip.id)),
      input.window
    ),
    stops: reconcileStops(input.stopAreas, input.state.stops, input.window),
    stopovers,
  };
}
