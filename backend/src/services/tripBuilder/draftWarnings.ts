/**
 * The warnings a draft carries (spec 2026-10-09 §C.12), assembled from facts
 * the orchestrator already holds. Pure: the Immich, database and geocoder
 * answers arrive resolved, so each rule can be tested with plain values.
 *
 * Order is the spec's order; the review page renders them as given.
 */
import { daysBetween } from "../../shared/time/localDate";
import { distanceKm } from "../photoJourneys/cluster";
import type { Coord } from "../tour/tourDistance";
import { CITY_LINK_KM, HOME_RADIUS_KM, SUSPICIOUS_TRIP_DAYS } from "./thresholds";
import type {
  BuilderWarning,
  Day,
  DraftStats,
  FlightAnchor,
  HomeAtDay,
  PhotoPoint,
  ScanWindow,
} from "./types";

export interface UnrecordedFlight {
  fromDay: Day;
  toDay: Day;
  nearestAirports: { from: string | null; to: string | null };
}

export interface WarningInput {
  inspect: boolean;
  window: Pick<ScanWindow, "startDay" | "endDay" | "contextFromDay" | "contextToDay">;
  stats: DraftStats;
  /**
   * What the commit's maxima cut from the scan's own lists (finding B4-1):
   * flights, areas and photo findings dropped because the body's caps
   * (`schemas/tripBuilder.ts`) would have refused a review that sent them.
   * The earliest entries stay; the counts are zero when nothing was cut.
   */
  truncatedLists: { flights: number; areas: number; journeys: number };
  unrecordedFlights: readonly UnrecordedFlight[];
  roads: { available: boolean; canProbe: boolean };
  /** Some area has at least one leg, so routing matters at all. */
  hasLegs: boolean;
  noRoadData: readonly string[];
  roadtripsHidden: boolean;
  overlapping: ReadonlyArray<{ name: string; startDay: Day; endDay: Day }>;
  flights: readonly FlightAnchor[];
  outsideMovement: readonly BuilderWarning[];
  pendingJourneyIds: readonly string[];
  albumLinkedElsewhere: string | null;
  homeUnconfirmed: boolean;
}

function flightOutsideDates(
  flights: readonly FlightAnchor[],
  window: Pick<ScanWindow, "startDay" | "endDay">
): BuilderWarning[] {
  const warnings: BuilderWarning[] = [];
  for (const flight of flights) {
    if (!flight.listed || !flight.defaultAssign) continue;
    const early = flight.depDay < window.startDay;
    const late = flight.arrDay > window.endDay;
    if (!early && !late) continue;
    warnings.push({
      code: "flightOutsideDates",
      params: {
        flightId: flight.id,
        ...(early ? { suggestStartDay: flight.depDay } : {}),
        ...(late ? { suggestEndDay: flight.arrDay } : {}),
      },
    });
  }
  return warnings;
}

export function assembleWarnings(input: WarningInput): BuilderWarning[] {
  const warnings: BuilderWarning[] = [];
  const { stats, window } = input;

  if (stats.truncated) warnings.push({ code: "truncated", params: {} });
  if (input.truncatedLists.flights > 0) {
    warnings.push({ code: "truncatedFlights", params: { count: input.truncatedLists.flights } });
  }
  if (input.truncatedLists.areas > 0) {
    warnings.push({ code: "truncatedAreas", params: { count: input.truncatedLists.areas } });
  }
  if (input.truncatedLists.journeys > 0) {
    warnings.push({ code: "truncatedJourneys", params: { count: input.truncatedLists.journeys } });
  }

  if (input.inspect) {
    for (const flight of input.unrecordedFlights) {
      warnings.push({ code: "possibleUnrecordedFlight", params: flight });
    }
    if (input.hasLegs && !input.roads.available) {
      warnings.push({ code: "noRouting", params: {} });
    } else if (input.hasLegs && !input.roads.canProbe) {
      warnings.push({ code: "cannotSnap", params: {} });
    }
    if (input.noRoadData.length > 0) {
      warnings.push({ code: "noRoadData", params: { stations: [...input.noRoadData] } });
    }
    if (input.roadtripsHidden) warnings.push({ code: "roadtripsHidden", params: {} });
  }

  for (const trip of input.overlapping) {
    warnings.push({
      code: "overlappingTrip",
      params: {
        name: trip.name,
        startDay: trip.startDay,
        endDay: trip.endDay,
        suspiciouslyLong: daysBetween(trip.startDay, trip.endDay) + 1 > SUSPICIOUS_TRIP_DAYS,
      },
    });
  }
  warnings.push(...flightOutsideDates(input.flights, window));
  if (input.inspect) warnings.push(...input.outsideMovement);
  if (input.pendingJourneyIds.length > 0) {
    warnings.push({ code: "pendingPhotoJourneys", params: { ids: [...input.pendingJourneyIds] } });
  }
  if (input.albumLinkedElsewhere !== null) {
    warnings.push({
      code: "albumLinkedElsewhere",
      params: { tripName: input.albumLinkedElsewhere },
    });
  }
  if (input.inspect && input.homeUnconfirmed)
    warnings.push({ code: "homeUnconfirmed", params: {} });

  if (stats.assets === 0) {
    warnings.push({
      code: "emptyWindow",
      params: {
        checkedFrom: window.contextFromDay,
        checkedTo: window.contextToDay,
        partner: stats.excluded.partner,
        trashedNote: true,
      },
    });
  } else if (input.inspect && stats.located === 0) {
    warnings.push({ code: "noLocatedPhotos", params: {} });
  }
  return warnings;
}

/**
 * Photos just outside the window that go on from the trip's first or last
 * station and are away from home: the dates were probably typed too tight.
 * One warning per side, for the day nearest the window.
 */
export function movementOutsideDates(input: {
  context: readonly PhotoPoint[];
  window: Pick<ScanWindow, "startDay" | "endDay">;
  firstStation: Coord | null;
  lastStation: Coord | null;
  homeAt: (day: Day) => HomeAtDay | null;
}): BuilderWarning[] {
  const awayKm = (photo: PhotoPoint, station: Coord | null): number | null => {
    if (station === null || photo.lat === null || photo.lon === null) return null;
    if (!photo.flags.located || photo.flags.duplicate) return null;
    const here = { lat: photo.lat, lon: photo.lon };
    if (distanceKm(here, station) > CITY_LINK_KM) return null;
    const home = input.homeAt(photo.day);
    if (home === null) return null;
    const fromHome = distanceKm(here, home);
    return fromHome > HOME_RADIUS_KM ? Math.round(fromHome) : null;
  };
  const warnings: BuilderWarning[] = [];

  const before = input.context.filter(
    (p) => p.day < input.window.startDay && awayKm(p, input.firstStation) !== null
  );
  const nearestBefore = before[before.length - 1];
  if (nearestBefore) {
    warnings.push({
      code: "movementOutsideDates",
      params: { day: nearestBefore.day, km: awayKm(nearestBefore, input.firstStation) as number },
    });
  }

  const after = input.context.filter(
    (p) => p.day > input.window.endDay && awayKm(p, input.lastStation) !== null
  );
  const nearestAfter = after[0];
  if (nearestAfter) {
    warnings.push({
      code: "movementOutsideDates",
      params: { day: nearestAfter.day, km: awayKm(nearestAfter, input.lastStation) as number },
    });
  }
  return warnings;
}
