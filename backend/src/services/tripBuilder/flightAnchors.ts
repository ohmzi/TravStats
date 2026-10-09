/**
 * Flights against photos (spec 2026-10-09 §C.4): which photos were taken in the air, which
 * stretch of ground each of the others belongs to, which stretches are only a layover, and where
 * a recorded flight is missing. Pure.
 *
 * A PRECISE flight (`FlightAnchor.precise`) is judged on the real instants `tMs`, `depMs` and
 * `arrMs`. Every other flight (a date-only or legacy row) is judged at the day level with the
 * corridor and time-order rules below: the documented fallback of decision 7.
 */
import { distanceKm } from "../photoJourneys/cluster";
import type { Coord } from "../tour/tourDistance";
import { coordOf, corridorFix, isStationary } from "./flightGeometry";
import {
  AIRPORT_NEAR_KM,
  ARRIVAL_TOLERANCE_KM,
  ARRIVAL_TOLERANCE_MIN,
  CORRIDOR_KM,
  DELAY_CORRIDOR_H,
  DEPARTURE_GRACE_KM,
  DEPARTURE_GRACE_MIN,
} from "./thresholds";
import type { FlightAnchor, FlightSide, InFlightClass, InFlightRule, PhotoPoint } from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function onGround(flight: FlightAnchor, rule: InFlightRule, side: FlightSide): InFlightClass {
  return { inFlight: false, flightId: flight.id, rule, side };
}

function airborne(flight: FlightAnchor, rule: InFlightRule): InFlightClass {
  return { inFlight: true, flightId: flight.id, rule, side: null };
}

/**
 * Between departure and arrival a photo is in the air, except two stretches of ground: the last
 * ARRIVAL_TOLERANCE_MIN minutes before landing within ARRIVAL_TOLERANCE_KM of the arrival airport
 * (side `after`) and, for a flight without an actual departure, the first DEPARTURE_GRACE_MIN
 * minutes within DEPARTURE_GRACE_KM of the departure airport (side `before`).
 */
function preciseVerdict(photo: PhotoPoint, at: Coord, flight: FlightAnchor): InFlightClass | null {
  const { depMs, arrMs } = flight;
  if (depMs === null || arrMs === null || photo.tMs <= depMs || photo.tMs >= arrMs) return null;
  const nearLanding =
    photo.tMs >= arrMs - ARRIVAL_TOLERANCE_MIN * MINUTE_MS &&
    distanceKm(at, flight.arr) <= ARRIVAL_TOLERANCE_KM;
  if (nearLanding) return onGround(flight, "arrivalTolerance", "after");
  const justLeft =
    !flight.hasActualDep &&
    photo.tMs <= depMs + DEPARTURE_GRACE_MIN * MINUTE_MS &&
    distanceKm(at, flight.dep) <= DEPARTURE_GRACE_KM;
  if (justLeft) return onGround(flight, "departureGrace", "before");
  return airborne(flight, "precise");
}

/**
 * Between the airports and not near either: more than AIRPORT_NEAR_KM from both, within
 * CORRIDOR_KM of the track and between its two ends.
 */
function onCorridor(at: Coord, flight: FlightAnchor): boolean {
  if (
    distanceKm(at, flight.dep) <= AIRPORT_NEAR_KM ||
    distanceKm(at, flight.arr) <= AIRPORT_NEAR_KM
  ) {
    return false;
  }
  const fix = corridorFix(flight.dep, flight.arr, at);
  return fix.crossKm <= CORRIDOR_KM && fix.alongKm >= 0 && fix.alongKm <= fix.lengthKm;
}

/**
 * A flight with no actual arrival may have run late: a photo up to DELAY_CORRIDOR_H after the
 * scheduled arrival, on the corridor and not part of a stationary group, is still in the air.
 */
function delayVerdict(
  photo: PhotoPoint,
  at: Coord,
  flight: FlightAnchor,
  photos: readonly PhotoPoint[]
): InFlightClass | null {
  const { arrMs } = flight;
  if (arrMs === null || flight.hasActualArr) return null;
  const late = photo.tMs > arrMs && photo.tMs <= arrMs + DELAY_CORRIDOR_H * HOUR_MS;
  return late && onCorridor(at, flight) && !isStationary(photo, photos)
    ? airborne(flight, "delay")
    : null;
}

/** The two photos that tell the ends of a day-level flight apart in time. */
interface TimeOrderReference {
  /** The last photo within AIRPORT_NEAR_KM of the departure airport on the flight's days. */
  lastDepartureMs: number | null;
  /** The first photo within AIRPORT_NEAR_KM of the arrival airport on the flight's days. */
  firstArrivalMs: number | null;
}

/** A missing reference leaves its bound open. */
const NO_REFERENCE: TimeOrderReference = { lastDepartureMs: null, firstArrivalMs: null };

function timeOrderReference(
  flight: FlightAnchor,
  photos: readonly PhotoPoint[]
): TimeOrderReference {
  let lastDepartureMs: number | null = null;
  let firstArrivalMs: number | null = null;
  for (const photo of photos) {
    const at = coordOf(photo);
    if (!at || photo.day < flight.depDay || photo.day > flight.arrDay) continue;
    if (distanceKm(at, flight.dep) <= AIRPORT_NEAR_KM) {
      lastDepartureMs = lastDepartureMs === null ? photo.tMs : Math.max(lastDepartureMs, photo.tMs);
    }
    if (distanceKm(at, flight.arr) <= AIRPORT_NEAR_KM) {
      firstArrivalMs = firstArrivalMs === null ? photo.tMs : Math.min(firstArrivalMs, photo.tMs);
    }
  }
  return { lastDepartureMs, firstArrivalMs };
}

/** The references of every day-level flight among `flights`, by flight id. */
function timeOrderReferences(
  flights: readonly FlightAnchor[],
  photos: readonly PhotoPoint[]
): Map<string, TimeOrderReference> {
  const references = new Map<string, TimeOrderReference>();
  for (const flight of flights) {
    if (!flight.precise) references.set(flight.id, timeOrderReference(flight, photos));
  }
  return references;
}

/**
 * A day-level flight: on one of its days, on the corridor, after the last photo at the departure
 * airport and before the first at the arrival airport, and not part of a stationary group.
 */
function impreciseVerdict(
  photo: PhotoPoint,
  at: Coord,
  flight: FlightAnchor,
  photos: readonly PhotoPoint[],
  reference: TimeOrderReference
): InFlightClass | null {
  if (photo.day < flight.depDay || photo.day > flight.arrDay) return null;
  if (!onCorridor(at, flight)) return null;
  if (reference.lastDepartureMs !== null && photo.tMs <= reference.lastDepartureMs) return null;
  if (reference.firstArrivalMs !== null && photo.tMs >= reference.firstArrivalMs) return null;
  if (isStationary(photo, photos)) return null;
  return airborne(flight, "corridor");
}

function verdictFor(
  photo: PhotoPoint,
  anchors: readonly FlightAnchor[],
  photos: readonly PhotoPoint[],
  references: ReadonlyMap<string, TimeOrderReference>
): InFlightClass {
  const at = coordOf(photo);
  if (at) {
    for (const flight of anchors) {
      const verdict = flight.precise
        ? (preciseVerdict(photo, at, flight) ?? delayVerdict(photo, at, flight, photos))
        : impreciseVerdict(photo, at, flight, photos, references.get(flight.id) ?? NO_REFERENCE);
      if (verdict) return verdict;
    }
  }
  return { inFlight: false, flightId: null, rule: null, side: null };
}

/**
 * Judges every photo against the flights: in the air or on the ground, by which rule, and for a
 * ground photo pinned to one side of a flight, which side. `photos` is every located,
 * non-duplicate, non-misdated photo of the window; `anchors` are the flights in departure order
 * (the first flight that has a verdict wins). The answer holds an entry for each photo.
 */
export function classifyInFlight(
  photos: readonly PhotoPoint[],
  anchors: readonly FlightAnchor[]
): Map<string, InFlightClass> {
  const references = timeOrderReferences(anchors, photos);
  const verdicts = new Map<string, InFlightClass>();
  for (const photo of photos) {
    verdicts.set(photo.id, verdictFor(photo, anchors, photos, references));
  }
  return verdicts;
}
