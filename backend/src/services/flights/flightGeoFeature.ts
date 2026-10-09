/**
 * One flight as a feature of `GET /flights/geo`: the great-circle arc between
 * its two airports and the facts the map overlays print beside it.
 *
 * Moved out of `routes/flights.ts`, which is frozen at its size in
 * `scripts/file-size-baseline.json` and may only shrink. Pure: the route loads
 * the catalogue rows once per request and hands in both lookups.
 */
import type { Flight } from "../../prisma";
import { calculateDistance, generateArcPoints } from "../../utils/geo";
import { resolveAirportCoordinate, type AirportCoordinateIndex } from "../airportCoordinates";

/** The country and city a map overlay prints beside an airport's code. */
export interface AirportInfo {
  country: string | null;
  city: string | null;
}

/** IATA first, then ICAO; an airport the catalogue does not know answers nulls. */
export type AirportInfoLookup = (iata: string | null, icao: string | null) => AirportInfo;

/** The columns of a flight row that one feature reads. */
export type GeoFlight = Pick<
  Flight,
  | "id"
  | "tripId"
  | "airline"
  | "operatingAirline"
  | "flightNumber"
  | "callsign"
  | "aircraft"
  | "depIcao"
  | "depIata"
  | "depName"
  | "depLat"
  | "depLon"
  | "arrIcao"
  | "arrIata"
  | "arrName"
  | "arrLat"
  | "arrLon"
  | "departureTime"
  | "arrivalTime"
  | "status"
  | "category"
  | "tags"
  | "price"
  | "currency"
  | "taxes"
  | "fees"
>;

export function flightGeoFeature(
  flight: GeoFlight,
  coordinateIndex: AirportCoordinateIndex,
  airportInfo: AirportInfoLookup
) {
  // Draw from the catalogue, not from the flight's own copy of the
  // coordinates. Those copies disagree between flights for the same
  // airport, and the map derives its airport DOT from the first-seen flight
  // per airport but each ARC from the first-seen flight per route — two
  // different "first seen" on two different coordinates, so the arc visibly
  // misses the dot (found at one airport, 739 m out). Falls back to the stored
  // value for airports the catalogue does not know.
  const depPosition = resolveAirportCoordinate(
    coordinateIndex,
    flight.depIata,
    flight.depIcao,
    flight.depLat,
    flight.depLon
  );
  const arrPosition = resolveAirportCoordinate(
    coordinateIndex,
    flight.arrIata,
    flight.arrIcao,
    flight.arrLat,
    flight.arrLon
  );
  const arcPoints = generateArcPoints(depPosition, arrPosition);

  return {
    type: "Feature",
    properties: {
      id: flight.id,
      tripId: flight.tripId,
      airline: flight.airline,
      operatingAirline: flight.operatingAirline,
      flightNumber: flight.flightNumber,
      callsign: flight.callsign,
      aircraft: flight.aircraft,
      departureAirport: {
        icao: flight.depIcao,
        iata: flight.depIata,
        name: flight.depName,
        country: airportInfo(flight.depIata, flight.depIcao).country,
        city: airportInfo(flight.depIata, flight.depIcao).city,
      },
      arrivalAirport: {
        icao: flight.arrIcao,
        iata: flight.arrIata,
        name: flight.arrName,
        country: airportInfo(flight.arrIata, flight.arrIcao).country,
        city: airportInfo(flight.arrIata, flight.arrIcao).city,
      },
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      status: flight.status,
      category: flight.category,
      tags: flight.tags || [],
      price: flight.price,
      currency: flight.currency,
      taxes: flight.taxes,
      fees: flight.fees,
      distance: calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon),
    },
    geometry: {
      type: "LineString",
      coordinates: arcPoints,
    },
  };
}
