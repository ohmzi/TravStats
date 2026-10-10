/**
 * The movement half of a scan (spec 2026-10-09 §C.5–C.11): from the ground
 * areas the flights left, to named stations, legs and nights. Four phases, one
 * function each, so `buildDraft.ts` reports progress between them. Each takes
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
import { splitImplicitFlights } from "./flightAnchors";
import { isMovementPhoto } from "./clean";
import { clusterCities, clusterOfPhoto } from "./cityClusters";
import type { CollectedWindow } from "./collect";
import { planAreaHome } from "./home";
import { bboxOf, nameClusters } from "./nameClusters";
import { probeLegs, snapStations, stationsWithoutRoute } from "./probe";
import { buildSegments, classifySegments } from "./segments";
import { buildStations } from "./stations";
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

/** Names the clusters, builds each area's stations and plans its home ends. */
export async function namesPhase(
  deps: BuilderDeps,
  collected: CollectedWindow,
  movement: MovementPhase
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
  const taken = new Set<string>();

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
  return { kept: applyDayPulls(plans, attribution.pulls), nights: attribution.nights };
}
