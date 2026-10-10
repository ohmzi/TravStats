/**
 * Home, as the trip builder asks about it (spec 2026-10-09 §C.5, §C.9): where
 * the user lived on a day, how that home sits at either end of an area, and
 * whether an area is only the way back home.
 */
import { machineInstant } from "../../shared/time/instant";
import { zoneOfCoordinates } from "../../shared/time/resolveInput";
import { addDays, NIGHT_UNKNOWN } from "../../shared/tour/builderNightPlan";
import { periodAt, type HomePeriod } from "../../utils/homeAirport";
import { distanceKm } from "../photoJourneys/cluster";
import type { Coord } from "../tour/tourDistance";
import { claimKey, stationKeyOf } from "./stations";
import {
  HOME_LEG_MAX_KM,
  HOME_RADIUS_KM,
  IMPLICIT_FLIGHT_MIN_KM,
  IMPLICIT_FLIGHT_MIN_KMH,
} from "./thresholds";
import type {
  AreaHome,
  AreaPlan,
  CityCluster,
  Day,
  FlightAnchor,
  GroundArea,
  HomeAtDay,
  HomeEnd,
  NamedCluster,
  NightEntry,
  PhotoPoint,
  PlanStation,
  ScanWindow,
} from "./types";

/**
 * The home on `day`, or null. A period with no residence (a migrated one whose
 * airport the catalogue does not know) has nothing to measure from, so it is no
 * home at all; a guessed point would be worse.
 */
export function homeAt(periods: readonly HomePeriod[], day: Day): HomeAtDay | null {
  const period = periodAt(periods, day);
  const residence = period?.residence;
  if (!period || !residence) return null;
  return {
    name: residence.name,
    lat: residence.lat,
    lon: residence.lon,
    confirmed: period.residenceConfirmed,
    zone: zoneOfCoordinates(residence.lat, residence.lon),
    airports: new Set(period.airports.map((airport) => airport.code.toUpperCase())),
  };
}

/** A cluster whose median lies within `HOME_RADIUS_KM` of the residence is home. */
export function isHomeCluster(
  cluster: Pick<CityCluster, "lat" | "lon">,
  home: HomeAtDay | null
): boolean {
  return home !== null && distanceKm(cluster, home) <= HOME_RADIUS_KM;
}

/**
 * Home legs count only at the edges of the window, give or take a day: an area
 * that begins or ends in the middle of the trip (after an unrecorded flight)
 * is not a journey from, or to, home.
 */
const EDGE_DAYS = 1;
const HOUR_MS = 3_600_000;

export interface AreaHomeInput {
  window: ScanWindow;
  area: GroundArea;
  stations: readonly PlanStation[];
  stationCluster: ReadonlyMap<string, string>;
  clusters: ReadonlyMap<string, NamedCluster>;
  photosById: ReadonlyMap<string, PhotoPoint>;
  homeAt: (day: Day) => HomeAtDay | null;
  homeAirportName: string | null;
  taken: Set<string>;
}

type Side = "start" | "end";

interface EndPlan {
  end: HomeEnd;
  stations: PlanStation[];
  home: HomeAtDay | null;
}

/** "Kelmore, Westshire" → "Kelmore". */
const townOf = (home: HomeAtDay): string => home.name.split(",")[0].trim() || home.name.trim();

/** The first (start) or last (end) movement photo of the area that has a position. */
function edgePhoto(input: AreaHomeInput, side: Side): (PhotoPoint & Coord) | null {
  const ids = side === "start" ? input.area.photoIds : [...input.area.photoIds].reverse();
  for (const id of ids) {
    const photo = input.photosById.get(id);
    if (photo && photo.lat !== null && photo.lon !== null) {
      return { ...photo, lat: photo.lat, lon: photo.lon };
    }
  }
  return null;
}

/** Hours between the photo and the window's edge on the home clock; null if no clock can say. */
function hoursToEdge(
  input: AreaHomeInput,
  side: Side,
  photo: PhotoPoint,
  home: HomeAtDay
): number | null {
  const zone = home.zone ?? photo.zone;
  const edgeDay = side === "start" ? input.window.startDay : addDays(input.window.endDay, 1);
  const edge = machineInstant(`${edgeDay}T00:00:00`, zone);
  if (edge === null) return null;
  const ms = side === "start" ? photo.tMs - edge.getTime() : edge.getTime() - photo.tMs;
  return ms / HOUR_MS;
}

/**
 * Whether the photographs support driving from (or back to) home: the edge
 * photo is within `HOME_LEG_MAX_KM` of the residence and the trip from home
 * would not have taken a flight (400 km or more at 200 km/h or faster).
 */
function supportsHomeLeg(input: AreaHomeInput, side: Side, home: HomeAtDay): boolean {
  const photo = edgePhoto(input, side);
  if (photo === null) return false;
  const km = distanceKm(photo, home);
  if (km > HOME_LEG_MAX_KM) return false;
  if (km < IMPLICIT_FLIGHT_MIN_KM) return true;
  const hours = hoursToEdge(input, side, photo, home);
  return hours !== null && hours > 0 && km / hours < IMPLICIT_FLIGHT_MIN_KMH;
}

function relabelAsHome(station: PlanStation, cluster: NamedCluster, home: HomeAtDay): PlanStation {
  const city = cluster.immichCity?.trim();
  return {
    ...station,
    kind: "home",
    title: city || townOf(home),
    titleSource: city ? "immich" : "home",
  };
}

function addedHomeStation(input: AreaHomeInput, home: HomeAtDay, day: Day): PlanStation {
  const title = !home.confirmed && input.homeAirportName ? input.homeAirportName : townOf(home);
  return {
    key: claimKey(stationKeyOf(home.lat, home.lon, day), input.taken),
    title,
    titleSource: "home",
    kind: "home",
    lat: home.lat,
    lon: home.lon,
    snappedKm: null,
    firstDay: day,
    lastDay: day,
    firstLocal: null,
    lastLocal: null,
    photoCount: 0,
    previewIdx: [],
    notes: null,
  };
}

function planEnd(input: AreaHomeInput, side: Side, stations: PlanStation[]): EndPlan {
  const { window, area } = input;
  const notOffered = { end: { offered: false, defaultOn: false }, stations, home: null };
  const hasFlight = (side === "start" ? area.afterFlightId : area.beforeFlightId) !== null;
  const atEdge =
    side === "start"
      ? area.startDay <= addDays(window.startDay, EDGE_DAYS)
      : area.endDay >= addDays(window.endDay, -EDGE_DAYS);
  const day = side === "start" ? window.startDay : window.endDay;
  const home = input.homeAt(day);
  if (hasFlight || !atEdge || home === null || stations.length === 0) return notOffered;

  const index = side === "start" ? 0 : stations.length - 1;
  const cluster = input.clusters.get(input.stationCluster.get(stations[index].key) ?? "");
  if (cluster?.isHome) {
    const relabelled = relabelAsHome(stations[index], cluster, home);
    const relabelledList = stations.map((station, i) => (i === index ? relabelled : station));
    return {
      end: { offered: true, defaultOn: true, station: relabelled },
      stations: relabelledList,
      home,
    };
  }

  const station = addedHomeStation(input, home, day);
  const defaultOn = supportsHomeLeg(input, side, home);
  const placed = side === "start" ? [station, ...stations] : [...stations, station];
  return {
    end: { offered: true, defaultOn, station },
    stations: defaultOn ? placed : stations,
    home,
  };
}

/**
 * The home legs of an area (decision 6): at an end with no flight and a home on
 * that day, the area's own home cluster is relabelled `home`, or a Home pass
 * station is added dated S or E. The switch starts on when the photos support
 * it (`supportsHomeLeg`), and is offered but off otherwise; a switch that is on
 * has its station in the returned list.
 */
export function planAreaHome(input: AreaHomeInput): { home: AreaHome; stations: PlanStation[] } {
  const start = planEnd(input, "start", [...input.stations]);
  const end = planEnd(input, "end", start.stations);
  const unconfirmed = [start, end].some(
    (plan) => plan.end.offered && plan.home !== null && !plan.home.confirmed
  );
  return { home: { start: start.end, end: end.end, unconfirmed }, stations: end.stations };
}

/**
 * An area that begins with a landing at a home airport and holds no night away
 * from home is the way back, not a trip (its photos stay in the album). An
 * unknown night inside it keeps it: nobody can say it was not spent away.
 */
export function isPostReturnArea(
  plan: AreaPlan,
  anchorsById: ReadonlyMap<string, FlightAnchor>,
  nights: Readonly<Record<Day, NightEntry>>,
  homeAtDay: (day: Day) => HomeAtDay | null
): boolean {
  const inbound =
    plan.area.afterFlightId === null ? undefined : anchorsById.get(plan.area.afterFlightId);
  const code = inbound?.arrIata?.toUpperCase();
  if (!inbound || !code || !homeAtDay(inbound.arrDay)?.airports.has(code)) return false;

  const away = new Set(
    plan.stations.filter((s) => s.kind !== "home" && s.kind !== "airport").map((s) => s.key)
  );
  return !Object.entries(nights).some(
    ([night, entry]) =>
      away.has(entry.assign) ||
      (entry.assign === NIGHT_UNKNOWN && night >= plan.area.startDay && night < plan.area.endDay)
  );
}
