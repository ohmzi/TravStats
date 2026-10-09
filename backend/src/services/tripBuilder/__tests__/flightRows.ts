import type { FlightAnchorRow } from "../loadFlights";
import type { ScanWindow } from "../types";

/** The scan window of the flight tests: 2031-05-02 … 2031-05-09. */
export const WINDOW: ScanWindow = {
  startDay: "2031-05-02",
  endDay: "2031-05-09",
  contextFromDay: "2031-04-29",
  contextToDay: "2031-05-12",
  fetchFrom: new Date("2031-04-28T10:00:00Z"),
  fetchTo: new Date("2031-05-13T12:00:00Z"),
};

/**
 * A stored flight, ZZ101 from Northvale to Port Carrow, leaving 08:30 on 2031-05-02
 * (Pacific/Auckland, UTC+12 in May) and landing at 09:30. Override what a test varies.
 */
export function flightRow(over: Partial<FlightAnchorRow> = {}): FlightAnchorRow {
  return {
    id: "fl-1",
    flightNumber: "ZZ101",
    airline: "Zephyr Air",
    depIata: "NVL",
    depIcao: null,
    depLat: -45.021,
    depLon: 168.739,
    arrIata: "PCR",
    arrIcao: null,
    arrLat: -43.489,
    arrLon: 172.532,
    departureTime: new Date("2031-05-01T20:30:00Z"),
    arrivalTime: new Date("2031-05-01T21:30:00Z"),
    actualDeparture: null,
    actualArrival: null,
    depTimeSemantics: "UTC",
    arrTimeSemantics: "UTC",
    depTimezone: "Pacific/Auckland",
    arrTimezone: "Pacific/Auckland",
    depPrecision: "minute",
    arrPrecision: "minute",
    tripId: null,
    trip: null,
    ...over,
  };
}
