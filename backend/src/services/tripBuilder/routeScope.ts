/**
 * The route-scoped re-sync (owner request 2026-10-12): the trip (roadtrip) edit
 * page's own Re-sync scans THAT trip's window and updates only that row, leaving
 * the journey's other rows — and the journey itself — as they are. The journey
 * then reflects the trip because the journey's page reads the same rows.
 *
 * A route-scoped scan builds the same areas any scan of its window would, but
 * the journey-level machinery that mints names, kinds, pitstops and stopovers
 * is skipped: a trip-scoped run must not re-mint the very row it updates, must
 * not give an area its own album, and must not offer a stopover (which would
 * write a NEW roadtrip into the journey). What is left — every area of the
 * window, its stations in travel order — is merged into the ONE area the target
 * route becomes.
 *
 * A stop of the window's photos that reconciles to ANOTHER stored roadtrip of
 * the journey is not this trip's to write (owner case 2026-10-12, the live
 * cross-trip refusal): the annotation leaves it out of the area
 * (`withoutStations`) and shows the skip in the review, so the commit's hard
 * refusal stays a floor under the write plan rather than the normal path.
 *
 * This module holds only the words and the merge; the scan's use of them is
 * `buildDraft.ts`, the annotation `existingDraft.ts`, the commit
 * `commitPlanExisting.ts`.
 */
import { distanceKm } from "../photoJourneys/cluster";
import type {
  AreaPlan,
  Day,
  DraftArea,
  DraftLeg,
  PassedThrough,
  PlanLeg,
  PlanStation,
  ScanInput,
} from "./types";

/**
 * A scanned stop the update leaves out because it also stands on another
 * roadtrip of the journey (overlapping days within `CITY_LINK_KM`). Its photos
 * stay where they belong; the review shows the skip and its reason, so the
 * trip-side re-sync never has to refuse as a whole.
 *
 * The scoped left-out DTO shapes live here, with the scoped words they belong
 * to, because `types.ts` sits at its 800-line cap; that file re-exports both,
 * so every consumer keeps importing them from `./types`.
 */
export interface DraftLeftOutStop {
  key: string;
  title: string;
  firstDay: Day;
  lastDay: Day;
  /** The other roadtrip of the journey the stop also stands on. */
  routeId: string;
  routeName: string;
}

/**
 * The window's PHOTOS whose (day, place) stands on another roadtrip of the
 * journey (the same cross-row rule at photo granularity). They are dropped
 * from the scan before any stop is derived — a neighbouring trip's day must
 * not colour this trip's clusters — and the review shows the exclusion the way
 * it shows the stop skip: the trip they belong to, the days and how many. One
 * entry per other trip.
 */
export interface DraftLeftOutPhoto {
  routeId: string;
  routeName: string;
  firstDay: Day;
  lastDay: Day;
  count: number;
}

/** The journey and the one roadtrip a route-scoped re-sync names. */
export interface RouteScope {
  /** The journey the roadtrip is filed on. */
  tripId: string;
  /** The roadtrip every scanned area of the window updates in place. */
  routeId: string;
}

/** The route a scan is scoped to, or null: what a trip-side Re-sync carries, and a journey-side one never does. */
export function routeScopeOf(input: ScanInput): RouteScope | null {
  return input.target.kind === "existing" && input.target.routeId !== undefined
    ? { tripId: input.target.tripId, routeId: input.target.routeId }
    : null;
}

/**
 * The leg a merged boundary joins: no probe ran across two areas a flight
 * separates, so it is a straight road chord — exactly what a leg with no
 * route data carries everywhere else.
 */
function boundaryLeg(from: PlanStation, to: PlanStation): DraftLeg {
  return {
    fromKey: from.key,
    toKey: to.key,
    chordKm: distanceKm(from, to),
    routedKm: null,
    mode: "road",
    ferryEvidence: null,
  };
}

function merged<T>(
  plans: readonly AreaPlan[],
  of: (plan: AreaPlan) => ReadonlyMap<string, T>
): Map<string, T> {
  const out = new Map<string, T>();
  for (const plan of plans) for (const [key, value] of of(plan)) out.set(key, value);
  return out;
}

/** `passedThrough` is keyed by DAY: two plans can carry chips for the same day, so they concatenate. */
function mergedByDay(plans: readonly AreaPlan[]): Map<string, PassedThrough[]> {
  const out = new Map<string, PassedThrough[]>();
  for (const plan of plans) {
    for (const [day, chips] of plan.passedThrough) {
      out.set(day, [...(out.get(day) ?? []), ...chips]);
    }
  }
  return out;
}

/**
 * The area without the stops that stand on another trip of the journey (owner
 * case 2026-10-12, the cross-trip stop): the stations and legs as scanned,
 * minus the dropped ones, with a straight road leg joining each pair the drop
 * left adjacent — the same chord and the same "no probe ran across it" reading
 * a merged boundary takes. An area nothing is dropped from comes back as it is.
 */
export function withoutStations(area: DraftArea, dropKeys: ReadonlySet<string>): DraftArea {
  const kept = area.stations
    .map((station, index) => ({ station, index }))
    .filter(({ station }) => !dropKeys.has(station.key));
  if (kept.length === area.stations.length) return area;
  const legs: DraftLeg[] = [];
  for (let i = 0; i + 1 < kept.length; i++) {
    const from = kept[i];
    const to = kept[i + 1];
    const storedLeg = to.index === from.index + 1 ? area.legs[from.index] : undefined;
    legs.push(storedLeg ?? boundaryLeg(from.station, to.station));
  }
  return { ...area, stations: kept.map(({ station }) => station), legs };
}

/**
 * The one area a route-scoped trip becomes: the plans of its window in travel
 * order, their stations concatenated and the boundary between two plans joined
 * by a straight road leg. The merged area spans the first plan's start to the
 * last plan's end; its flight edges are the outermost ones (the ones the
 * window's own flight classification used); its home ends are the outer plans'
 * (a home offered mid-trip — between two flight-separated areas — belongs to
 * no single stop list and is not offered).
 */
export function mergeAreaPlans(plans: readonly AreaPlan[]): AreaPlan {
  const first = plans[0];
  if (first === undefined) throw new Error("Cannot merge no plans");
  const ordered = [...plans].sort((a, b) => a.area.startMs - b.area.startMs);
  const [start] = ordered;
  const end = ordered[ordered.length - 1];
  const stations = ordered.flatMap((plan) => plan.stations);
  const segments = ordered.flatMap((plan) => plan.segments);
  const legs: PlanLeg[] = [];
  ordered.forEach((plan, i) => {
    if (i > 0) {
      const before = ordered[i - 1].stations.slice(-1)[0];
      const after = plan.stations[0];
      if (before !== undefined && after !== undefined) legs.push(boundaryLeg(before, after));
    }
    legs.push(...plan.legs);
  });
  return {
    key: start.key,
    area: {
      photoIds: ordered.flatMap((plan) => plan.area.photoIds),
      seaPhotoIds: ordered.flatMap((plan) => plan.area.seaPhotoIds),
      afterFlightId: start.area.afterFlightId,
      beforeFlightId: end.area.beforeFlightId,
      startMs: start.area.startMs,
      endMs: end.area.endMs,
      startDay: start.area.startDay,
      endDay: end.area.endDay,
    },
    segments,
    legs,
    home: {
      start: start.home.start,
      end: end.home.end,
      unconfirmed: ordered.some((plan) => plan.home.unconfirmed),
    },
    stations,
    photoStation: merged(ordered, (plan) => plan.photoStation),
    stationCluster: merged(ordered, (plan) => plan.stationCluster),
    spanMs: merged(ordered, (plan) => plan.spanMs),
    previewPhotoIds: merged(ordered, (plan) => plan.previewPhotoIds),
    passedThrough: mergedByDay(ordered),
  };
}
