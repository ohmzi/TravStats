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
  LAYOVER_MAX_H,
  LAYOVER_RADIUS_KM,
} from "./thresholds";
import type {
  AreaSplit,
  FlightAnchor,
  FlightSide,
  GroundArea,
  InFlightClass,
  InFlightRule,
  Layover,
  PhotoPoint,
} from "./types";

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

function byTime(a: PhotoPoint, b: PhotoPoint): number {
  return a.tMs - b.tMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Chronological order of two flights: by departure instant when both have one, else by
 * departure day, then by clock. Two flights that still tie come in the order they connect (the
 * one that lands where the other leaves first), then by id.
 */
function compareAnchors(a: FlightAnchor, b: FlightAnchor): number {
  if (a.depMs !== null && b.depMs !== null && a.depMs !== b.depMs) return a.depMs - b.depMs;
  if (a.depDay !== b.depDay) return a.depDay < b.depDay ? -1 : 1;
  if (a.depClock !== null && b.depClock !== null && a.depClock !== b.depClock) {
    return a.depClock < b.depClock ? -1 : 1;
  }
  const forward = sharesAirport(a, b);
  const backward = sharesAirport(b, a);
  if (forward !== backward) return forward ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** `after` when the photo lies closer to the arrival airport than to the departure airport. */
function nearerSide(photo: PhotoPoint, flight: FlightAnchor): FlightSide {
  const at = coordOf(photo);
  if (!at) return "before";
  return distanceKm(at, flight.arr) < distanceKm(at, flight.dep) ? "after" : "before";
}

/**
 * Which side of `flight` a ground photo is on.
 * - A photo the classifier pinned to this flight (arrival tolerance, departure grace) keeps that
 *   side: the cut sits at the last grace photo and the first tolerance photo, not at the
 *   scheduled instants.
 * - A precise flight cuts at its departure and arrival instants; a photo inside the flight that
 *   nobody classified goes to the nearer airport.
 * - A day-level flight cuts by day; on its own days the time-order references decide (before the
 *   last photo at the departure airport, after the first at the arrival airport) and a photo no
 *   reference decides goes to the nearer airport.
 */
function sideOf(
  photo: PhotoPoint,
  flight: FlightAnchor,
  verdict: InFlightClass | undefined,
  references: ReadonlyMap<string, TimeOrderReference>
): FlightSide {
  if (verdict && verdict.flightId === flight.id && verdict.side) return verdict.side;
  if (flight.depMs !== null && flight.arrMs !== null) {
    if (photo.tMs <= flight.depMs) return "before";
    if (photo.tMs >= flight.arrMs) return "after";
    return nearerSide(photo, flight);
  }
  if (photo.day < flight.depDay) return "before";
  if (photo.day > flight.arrDay) return "after";
  const { lastDepartureMs, firstArrivalMs } = references.get(flight.id) ?? NO_REFERENCE;
  const early = lastDepartureMs !== null && photo.tMs <= lastDepartureMs;
  const late = firstArrivalMs !== null && photo.tMs >= firstArrivalMs;
  if (early && !late) return "before";
  if (late && !early) return "after";
  return nearerSide(photo, flight);
}

/** `arriving` lands where `departing` leaves: the same IATA code (a flight without codes never connects). */
function sharesAirport(arriving: FlightAnchor, departing: FlightAnchor): boolean {
  return arriving.arrIata !== null && arriving.arrIata === departing.depIata;
}

/**
 * Ground between two flights at one airport that is only a connection: for two precise flights,
 * less than LAYOVER_MAX_H between landing and the next departure; otherwise landing and
 * departure on one day. Either way every photo lies within LAYOVER_RADIUS_KM of the airport.
 */
function isLayover(
  arriving: FlightAnchor,
  departing: FlightAnchor,
  members: readonly PhotoPoint[]
): boolean {
  if (!sharesAirport(arriving, departing)) return false;
  if (arriving.arrMs !== null && departing.depMs !== null) {
    const ground = departing.depMs - arriving.arrMs;
    if (ground < 0 || ground >= LAYOVER_MAX_H * HOUR_MS) return false;
  } else if (arriving.arrDay !== departing.depDay) {
    return false;
  }
  return members.every((photo) => {
    const at = coordOf(photo);
    return at !== null && distanceKm(at, arriving.arr) <= LAYOVER_RADIUS_KM;
  });
}

function groundAreaOf(
  members: readonly PhotoPoint[],
  arriving: FlightAnchor | null,
  departing: FlightAnchor | null
): GroundArea | null {
  const movement = members.filter((photo) => !photo.flags.atSea);
  if (movement.length === 0) return null;
  const first = movement[0];
  const last = movement[movement.length - 1];
  return {
    photoIds: movement.map((photo) => photo.id),
    seaPhotoIds: members.filter((photo) => photo.flags.atSea).map((photo) => photo.id),
    afterFlightId: arriving ? arriving.id : null,
    beforeFlightId: departing ? departing.id : null,
    startMs: first.tMs,
    endMs: last.tMs,
    startDay: first.day,
    endDay: last.day,
  };
}

/**
 * Cuts the ground photos at the flights. Every photo gets a side of every flight; the photos
 * with the same number of flights behind them are one stretch of ground. A stretch between two
 * flights that is only a layover is reported as one and is no area; any other stretch with a
 * movement photo is an area, and one with only sea photos is dropped. A road leg never crosses
 * a flight.
 *
 * `ground` is the movement photos plus the at-sea photos (they go to `seaPhotoIds`); `classes`
 * is `classifyInFlight` over the same photos. A photo `classes` calls in the air is ignored.
 */
export function splitIntoAreas(
  ground: readonly PhotoPoint[],
  anchors: readonly FlightAnchor[],
  classes: ReadonlyMap<string, InFlightClass>
): AreaSplit {
  const flights = [...anchors].sort(compareAnchors);
  const photos = ground.filter((photo) => !classes.get(photo.id)?.inFlight).sort(byTime);
  const references = timeOrderReferences(flights, photos);

  const stretches = new Map<number, PhotoPoint[]>();
  for (const photo of photos) {
    const verdict = classes.get(photo.id);
    const behind = flights.filter(
      (flight) => sideOf(photo, flight, verdict, references) === "after"
    ).length;
    const members = stretches.get(behind);
    if (members) members.push(photo);
    else stretches.set(behind, [photo]);
  }

  const areas: GroundArea[] = [];
  const layovers: Layover[] = [];
  for (const [behind, members] of [...stretches].sort((a, b) => a[0] - b[0])) {
    const arriving = behind > 0 ? flights[behind - 1] : null;
    const departing = behind < flights.length ? flights[behind] : null;
    if (arriving && departing && isLayover(arriving, departing, members)) {
      layovers.push({
        inFlightId: arriving.id,
        outFlightId: departing.id,
        airportIata: arriving.arrIata,
        photoIds: members.map((photo) => photo.id),
      });
    } else {
      const area = groundAreaOf(members, arriving, departing);
      if (area) areas.push(area);
    }
  }
  return { areas, layovers };
}
