/**
 * Flights as the trip builder's anchors (spec 2026-10-09 §C.3).
 *
 * `toFlightAnchor` reads one stored flight the way the rest of the app does: the day and clock
 * of each end in the zone the row was WRITTEN with, a legacy fake-UTC row as the wall clock it
 * stores, a date-only row as the date it stores. It decides what the flight is good for: an
 * exact airborne interval (`precise`), a line in the review's flight list (`listed`) and
 * whether its tick starts on.
 */
import type { Prisma } from "../../prisma";

import { toLocal } from "../../shared/time/instant";
import { isValidZone } from "../../shared/time/zonedParts";
import { addDays } from "../../shared/tour/builderNightPlan";
import { flightEndZone } from "../stats/departureClock";
import { FLIGHT_LIST_EARLY_DAYS } from "./thresholds";
import type { Day, FlightAnchor, ScanWindow } from "./types";

/** The columns an anchor is built from, and nothing else. */
export const FLIGHT_ANCHOR_SELECT = {
  id: true,
  flightNumber: true,
  airline: true,
  depIata: true,
  depIcao: true,
  depLat: true,
  depLon: true,
  arrIata: true,
  arrIcao: true,
  arrLat: true,
  arrLon: true,
  departureTime: true,
  arrivalTime: true,
  actualDeparture: true,
  actualArrival: true,
  depTimeSemantics: true,
  arrTimeSemantics: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
  tripId: true,
  trip: { select: { id: true, name: true } },
} satisfies Prisma.FlightSelect;

export type FlightAnchorRow = Prisma.FlightGetPayload<{ select: typeof FLIGHT_ANCHOR_SELECT }>;

/** One end of a flight on its airport's clock; `clock` is null when the row only knows the day. */
interface EndReading {
  day: Day;
  clock: string | null;
}

/**
 * The wall clock of one end.
 * - `DATE_ONLY` stores noon UTC of the airport's own date, so the date is read as stored: in
 *   UTC+12 and further east the noon placeholder would land on the next day.
 * - `LEGACY_FAKE_UTC` stores the wall clock as if it were UTC, and a row without a usable zone
 *   has nothing else to offer: both are read as stored.
 * - Anything else is a real instant, read in the zone the row was written with.
 */
function readEnd(
  time: Date,
  zone: string | null,
  semantics: string,
  precision: string | null
): EndReading {
  if (semantics === "DATE_ONLY") {
    return { day: time.toISOString().slice(0, 10), clock: null };
  }
  const wall =
    semantics === "LEGACY_FAKE_UTC" || zone === null
      ? time.toISOString().slice(0, 19)
      : toLocal(time, zone).local;
  return { day: wall.slice(0, 10), clock: precision === "day" ? null : wall.slice(11, 16) };
}

function usableZone(zone: string | null): string | null {
  return isValidZone(zone) ? zone : null;
}

/** "ZZ101 NVL→PCR": the flight number, else the airline, then the route. */
function labelOf(row: FlightAnchorRow): string {
  const name = row.flightNumber?.trim() || row.airline?.trim() || null;
  const route = `${row.depIata ?? row.depIcao ?? "?"}→${row.arrIata ?? row.arrIcao ?? "?"}`;
  return name ? `${name} ${route}` : route;
}

/**
 * `precise` needs real instants at both ends (UTC semantics, not a day-only precision) and an
 * arrival after the departure; `depMs` and `arrMs` are then the actual times when the row has
 * them, else the scheduled ones. `targetTripId` is the trip being re-synced, if any: a flight
 * already on it comes out locked and ticked, a flight filed on another trip comes out unticked
 * and names that trip. Throws for a row without a departure time, which `loadFlights` never
 * selects.
 */
export function toFlightAnchor(
  row: FlightAnchorRow,
  tzMap: ReadonlyMap<string, string>,
  window: ScanWindow,
  targetTripId: string | null
): FlightAnchor {
  if (row.departureTime === null) throw new Error(`Flight ${row.id} has no departure time`);
  const depZone = usableZone(flightEndZone(row.depTimezone, tzMap, row.depIata, row.depIcao));
  const arrZone = usableZone(flightEndZone(row.arrTimezone, tzMap, row.arrIata, row.arrIcao));
  const dep = readEnd(row.departureTime, depZone, row.depTimeSemantics, row.depPrecision);
  const arr = row.arrivalTime
    ? readEnd(row.arrivalTime, arrZone, row.arrTimeSemantics, row.arrPrecision)
    : null;

  const depInstant = row.actualDeparture ?? row.departureTime;
  const arrInstant = row.actualArrival ?? row.arrivalTime;
  const precise =
    arrInstant !== null &&
    arrInstant.getTime() > depInstant.getTime() &&
    row.depTimeSemantics === "UTC" &&
    row.arrTimeSemantics === "UTC" &&
    row.depPrecision !== "day" &&
    row.arrPrecision !== "day";

  const depDay = dep.day;
  const arrDay = arr ? arr.day : dep.day;
  const locked = targetTripId !== null && row.tripId === targetTripId;

  return {
    id: row.id,
    label: labelOf(row),
    depIata: row.depIata,
    arrIata: row.arrIata,
    dep: { lat: row.depLat, lon: row.depLon },
    arr: { lat: row.arrLat, lon: row.arrLon },
    depZone,
    arrZone,
    depDay,
    arrDay,
    depClock: dep.clock,
    arrClock: arr ? arr.clock : null,
    precise,
    depMs: precise ? depInstant.getTime() : null,
    arrMs: precise && arrInstant !== null ? arrInstant.getTime() : null,
    hasActualDep: row.actualDeparture !== null,
    hasActualArr: row.actualArrival !== null,
    tripId: row.tripId,
    tripName: row.trip ? row.trip.name : null,
    listed:
      depDay <= window.endDay &&
      arrDay >= window.startDay &&
      depDay >= addDays(window.startDay, -FLIGHT_LIST_EARLY_DAYS),
    defaultAssign: row.tripId === null || locked,
    locked,
  };
}
