/**
 * The movement half of a scan (spec 2026-10-09 §C.5–C.11): from the ground
 * areas the flights left, to named stations, legs and nights, and the stopover
 * tours beside them. One function each, so `buildDraft.ts` reports progress
 * between them. Each takes
 * and returns plain values; the impure steps (titles, geocoder, airports,
 * road probes) arrive through `BuilderDeps`.
 */
import { airportDisplayName } from "../../utils/airportDisplay";
import type { AirportData } from "../airportLookup";
import type { BuilderDeps } from "./buildDraft";
import { addAirportAnchors } from "./airportAnchors";
import { applyDayPulls, attributeNights } from "./nights";
import { keyAreas } from "./areas";
import { buildLegs } from "./ferry";
import { splitImplicitFlights, withinLayoverWindow } from "./flightAnchors";
import { isMovementPhoto } from "./clean";
import { clusterCities, clusterOfPhoto } from "./cityClusters";
import type { CollectedWindow } from "./collect";
import { isPostReturnArea, planAreaHome } from "./home";
import { bboxOf, nameClusters } from "./nameClusters";
import { probeLegs, snapStations, stationsWithoutRoute } from "./probe";
import { buildSegments, classifySegments } from "./segments";
import { buildStations } from "./stations";
import {
  isStopoverCandidate,
  outingOf,
  stopoverFromArea,
  stopoverOf,
  stopoverStations,
} from "./stopovers";
import { TITLE_REUSE_KM } from "./thresholds";
import type {
  AreaHome,
  AreaPlan,
  AreaSplit,
  CityCluster,
  Day,
  GroundArea,
  HomeAtDay,
  ImplicitGap,
  NightEntry,
  PhotoPoint,
  PlanStation,
  Segment,
  StationBuild,
  StoredStopover,
} from "./types";

/** A photo taken at sea that may serve as ferry and night evidence. */
export const isSeaPhoto = (p: PhotoPoint): boolean =>
  p.flags.atSea &&
  p.flags.located &&
  !p.flags.duplicate &&
  p.flags.misdated === null &&
  !p.flags.inFlight;

export interface KeyedPart {
  key: string;
  area: GroundArea;
  segments: Segment[];
}

export interface MovementPhase {
  clusters: CityCluster[];
  parts: KeyedPart[];
  gaps: ImplicitGap[];
  photosById: ReadonlyMap<string, PhotoPoint>;
}

export function emptyMovement(photos: readonly PhotoPoint[]): MovementPhase {
  return {
    clusters: [],
    parts: [],
    gaps: [],
    photosById: new Map(photos.map((p) => [p.id, p] as const)),
  };
}

/** Clusters the movement photos, cuts each ground area into segments and keys the areas. */
export function movementPhase(photos: readonly PhotoPoint[], split: AreaSplit): MovementPhase {
  const photosById = new Map(photos.map((p) => [p.id, p] as const));
  const clusters = clusterCities(photos.filter(isMovementPhoto));
  const clusterOf = clusterOfPhoto(clusters);
  const clusterById = new Map(clusters.map((c) => [c.id, c] as const));
  const gaps: ImplicitGap[] = [];
  const parts: Array<{ area: GroundArea; segments: Segment[] }> = [];

  for (const area of split.areas) {
    const members = area.photoIds.flatMap((id) => {
      const photo = photosById.get(id);
      return photo ? [photo] : [];
    });
    if (members.length === 0) continue;
    const implicit = splitImplicitFlights(
      { area, segments: buildSegments(members, clusterOf) },
      clusterById
    );
    gaps.push(...implicit.gaps);
    for (const part of implicit.parts) {
      if (part.segments.length === 0) continue;
      parts.push({ area: part.area, segments: classifySegments(part.segments, photosById) });
    }
  }
  return { clusters, parts: keyAreas(parts), gaps, photosById };
}

export interface BuiltArea {
  part: KeyedPart;
  build: StationBuild;
  stations: PlanStation[];
  home: AreaHome;
}

function airportCodes(collected: CollectedWindow): string[] {
  const codes = new Set<string>();
  for (const anchor of collected.anchors) {
    if (anchor.depIata) codes.add(anchor.depIata.toUpperCase());
    if (anchor.arrIata) codes.add(anchor.arrIata.toUpperCase());
  }
  for (const day of [collected.window.startDay, collected.window.endDay]) {
    for (const code of collected.homeAt(day)?.airports ?? []) codes.add(code);
  }
  return [...codes];
}

function homeAirportName(
  home: HomeAtDay | null,
  airports: ReadonlyMap<string, AirportData>
): string | null {
  for (const code of home?.airports ?? []) {
    const name = airportDisplayName(airports.get(code));
    if (name) return name;
  }
  return null;
}

/**
 * Names the clusters, builds each area's stations and plans its home ends.
 * Station keys are minted from the caller's `taken` set, which the stopover
 * pass shares, so no key is ever minted twice.
 */
export async function namesPhase(
  deps: BuilderDeps,
  collected: CollectedWindow,
  movement: MovementPhase,
  taken: Set<string>
): Promise<BuiltArea[]> {
  if (movement.parts.length === 0) return [];
  const { clusters, photosById } = movement;
  const existing = await deps.existingTitles(bboxOf(clusters, TITLE_REUSE_KM));
  const named = await nameClusters(clusters, {
    existingTitles: existing,
    reverseGeocode: deps.reverseGeocode,
    home: collected.homeAt(collected.window.startDay),
  });
  const namedById = new Map(named.map((c) => [c.id, c] as const));
  const anchorsById = new Map(collected.anchors.map((a) => [a.id, a] as const));
  const airports = await deps.airports(airportCodes(collected));

  const built: BuiltArea[] = [];
  for (const part of movement.parts) {
    const build = buildStations({
      segments: part.segments,
      clusters: namedById,
      photosById,
      taken,
    });
    const stations = addAirportAnchors({
      area: part.area,
      stations: build.stations,
      anchorsById,
      airports,
      taken,
    });
    const planned = planAreaHome({
      window: collected.window,
      area: part.area,
      stations,
      stationCluster: build.stationCluster,
      clusters: namedById,
      photosById,
      homeAt: collected.homeAt,
      homeAirportName: homeAirportName(collected.homeAt(part.area.startDay), airports),
      taken,
    });
    built.push({ part, build, stations: planned.stations, home: planned.home });
  }
  return built;
}

export interface StopoverPlan {
  stopover: StoredStopover;
  /** Station key → up to PREVIEWS_PER_STATION asset ids. SERVER-ONLY. */
  previewPhotoIds: Map<string, string[]>;
}

export interface StopoverPass {
  /** The candidates, branch (a) first, then branch (b), each in scan order. */
  plans: StopoverPlan[];
  /** The branch-(b) areas that leave the draft's areas (spec §2, amended). */
  reclassifiedAreaKeys: Set<string>;
  /**
   * The airport rows both branches read (`deps.airports`, one fetch). The
   * pitstop pass names its own albums from the same rows — a pitstop is named
   * after its shared airport (owner ruling 2026-10-12) — so the scan holds no
   * second copy of the same catalogue read.
   */
  airports: ReadonlyMap<string, AirportData>;
}

/**
 * The stopover roadtrip of every stretch whose photos went somewhere (spec
 * 2026-10-11 §2): branch (a), the `Layover`s — the outing set's clusters named
 * by the same chain the areas use, the arrival airport as the first stop, and
 * the legs between them — and branch (b) (spec §2, amended), the flights-bounded
 * areas whose own photos pass the outing test, which are reclassified out of the
 * areas with their own stations, previews and legs as the tour. The keys come
 * from the areas' own `taken` set, so none collides. No night is ever assigned
 * here: a stopover is hours, not a stay. The branch-(b) candidates are minted
 * after the layover ones, so what branch (a) is offered never changes.
 */
export async function stopoversPhase(
  deps: BuilderDeps,
  collected: CollectedWindow,
  split: AreaSplit,
  movement: MovementPhase,
  areas: readonly AreaPlan[],
  taken: Set<string>
): Promise<StopoverPass> {
  const anchorsById = new Map(collected.anchors.map((a) => [a.id, a] as const));
  // Branch (b) reads the arrival airport rows too, so both branches' codes go in one call.
  const areaCodes = areas.flatMap((plan) => {
    const arriving =
      plan.area.afterFlightId === null ? undefined : anchorsById.get(plan.area.afterFlightId);
    return arriving?.arrIata ? [arriving.arrIata.toUpperCase()] : [];
  });
  const codes = [
    ...split.layovers.flatMap((l) => (l.airportIata ? [l.airportIata.toUpperCase()] : [])),
    ...areaCodes,
  ];
  const airports = await deps.airports(codes);
  const plans: StopoverPlan[] = [];
  // The titles minted so far: a later same-city candidate takes the day suffix (plan amendment 1).
  const takenTitles = new Set<string>();

  for (const layover of split.layovers) {
    const inFlight = anchorsById.get(layover.inFlightId);
    if (!inFlight) continue;
    const outing = outingOf(layover, movement.photosById, inFlight.arr);
    if (!isStopoverCandidate(outing)) continue;
    const clusters = clusterCities(outing);
    const named = await nameClusters(clusters, {
      existingTitles: await deps.existingTitles(bboxOf(clusters, TITLE_REUSE_KM)),
      reverseGeocode: deps.reverseGeocode,
      home: null,
    });
    const airport = layover.airportIata
      ? airports.get(layover.airportIata.toUpperCase())
      : undefined;
    const tour = stopoverStations({
      layover,
      inFlight,
      airport: airport ?? null,
      named,
      photosById: movement.photosById,
      taken,
    });
    if (tour === null) continue;
    const probes = await probeLegs(tour.stations, deps.roads.probes);
    const stopover = stopoverOf({ layover, tour, probes, countryAt: deps.countryAt, takenTitles });
    takenTitles.add(stopover.title);
    plans.push({ stopover, previewPhotoIds: tour.previewPhotoIds });
  }

  // Branch (b): a stretch between two adjacent same-airport flights within the
  // layover window, which the 30 km radius kept an area, is reclassified — it
  // leaves `areas` and its own stations become the tour (spec §2, amended).
  const reclassifiedAreaKeys = new Set<string>();
  for (const plan of areas) {
    const { area } = plan;
    if (area.afterFlightId === null || area.beforeFlightId === null) continue;
    const inFlight = anchorsById.get(area.afterFlightId);
    const outFlight = anchorsById.get(area.beforeFlightId);
    if (inFlight === undefined || outFlight === undefined) continue;
    if (!withinLayoverWindow(inFlight, outFlight)) continue;
    const outing = outingOf(
      {
        inFlightId: inFlight.id,
        outFlightId: outFlight.id,
        airportIata: inFlight.arrIata,
        photoIds: [...area.photoIds, ...area.seaPhotoIds],
      },
      movement.photosById,
      inFlight.arr
    );
    if (!isStopoverCandidate(outing)) continue;
    const airport = inFlight.arrIata ? airports.get(inFlight.arrIata.toUpperCase()) : undefined;
    const stopover = stopoverFromArea({
      area,
      inFlight,
      outFlight,
      plan,
      airport: airport ?? null,
      outing,
      takenTitles,
    });
    if (stopover === null) continue;
    takenTitles.add(stopover.title);
    reclassifiedAreaKeys.add(plan.key);
    plans.push({ stopover, previewPhotoIds: plan.previewPhotoIds });
  }
  return { plans, reclassifiedAreaKeys, airports };
}

/** Snaps stations onto the road, probes each leg and decides road or ferry. */
export async function roadsPhase(
  deps: BuilderDeps,
  movement: MovementPhase,
  built: readonly BuiltArea[]
): Promise<{ plans: AreaPlan[]; noRoadData: string[] }> {
  const probes = deps.roads.probes;
  const noRoadData = new Set<string>();
  const plans: AreaPlan[] = [];
  for (const b of built) {
    const snapped = await snapStations(b.stations, probes);
    snapped.noRoadData.forEach((key) => noRoadData.add(key));
    const probed = await probeLegs(snapped.stations, probes);
    // Without probes every answer is null, which would read as "no route" everywhere.
    if (probes !== null) {
      stationsWithoutRoute(snapped.stations, probed).forEach((key) => noRoadData.add(key));
    }
    const seaPhotos = b.part.area.seaPhotoIds.flatMap((id) => {
      const photo = movement.photosById.get(id);
      return photo ? [photo] : [];
    });
    const legs = buildLegs({
      stations: snapped.stations,
      spanMs: b.build.spanMs,
      probes: probed,
      seaPhotos,
      countryAt: deps.countryAt,
    });
    plans.push({
      ...b.build,
      stations: snapped.stations,
      key: b.part.key,
      area: b.part.area,
      segments: b.part.segments,
      legs,
      home: b.home,
    });
  }
  return { plans, noRoadData: [...noRoadData] };
}

export interface NightsPhase {
  kept: AreaPlan[];
  nights: Record<Day, NightEntry>;
}

/** Attributes every night and applies the after-landing day pulls. */
export function nightsPhase(
  collected: CollectedWindow,
  movement: MovementPhase,
  plans: readonly AreaPlan[]
): NightsPhase {
  if (plans.length === 0) return { kept: [], nights: {} };
  const nightPhotos = new Map(
    [...movement.photosById].filter(([, p]) => isMovementPhoto(p) || isSeaPhoto(p))
  );
  const attribution = attributeNights({
    window: collected.window,
    areas: plans,
    photosById: nightPhotos,
    anchors: collected.anchors,
    homeAt: collected.homeAt,
  });
  const anchorsById = new Map(collected.anchors.map((a) => [a.id, a] as const));
  const kept = applyDayPulls(plans, attribution.pulls).filter(
    (plan) => !isPostReturnArea(plan, anchorsById, attribution.nights, collected.homeAt)
  );
  return { kept, nights: attribution.nights };
}
