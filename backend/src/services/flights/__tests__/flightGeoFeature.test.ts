import { describe, expect, it } from "@jest/globals";

import { buildAirportCoordinateIndex } from "../../airportCoordinates";
import { calculateDistance } from "../../../utils/geo";
import { flightGeoFeature, type AirportInfoLookup, type GeoFlight } from "../flightGeoFeature";

/**
 * `GET /flights/geo` draws every flight through this one function, moved out
 * of routes/flights.ts for the file-size ratchet. Synthetic airports and
 * flight only (public repository).
 */
const NORTHVALE = { iata: "NVL", icao: "ZZNV", lat: -45.0195, lon: 168.741, isClosed: false };
const PORT_CARROW = { iata: "PCR", icao: "ZZPC", lat: -44.1012, lon: 171.2004, isClosed: false };

const ZZ101: GeoFlight = {
  id: "5e0f1c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  tripId: null,
  airline: "Zephyr Air",
  operatingAirline: null,
  flightNumber: "ZZ101",
  callsign: null,
  aircraft: null,
  depIcao: "ZZNV",
  depIata: "NVL",
  depName: "Northvale",
  depLat: -45.021,
  depLon: 168.739,
  arrIcao: "ZZPC",
  arrIata: "PCR",
  arrName: "Port Carrow",
  arrLat: -44.1,
  arrLon: 171.2,
  departureTime: new Date("2031-05-02T08:10:00.000Z"),
  arrivalTime: new Date("2031-05-02T09:25:00.000Z"),
  status: "flown",
  category: null,
  tags: [],
  price: null,
  currency: null,
  taxes: null,
  fees: null,
};

const FACTS: Record<string, { country: string | null; city: string | null }> = {
  NVL: { country: "ZZ", city: "Northvale" },
  PCR: { country: "ZZ", city: "Port Carrow" },
};
const airportInfo: AirportInfoLookup = (iata) =>
  (iata ? FACTS[iata] : undefined) ?? { country: null, city: null };

const catalogue = buildAirportCoordinateIndex([NORTHVALE, PORT_CARROW]);

describe("flightGeoFeature", () => {
  it("draws the arc between the catalogue's airport positions, not the row's copies", () => {
    const line = flightGeoFeature(ZZ101, catalogue, airportInfo).geometry.coordinates;

    expect(line).toHaveLength(51);
    expect(line[0][0]).toBeCloseTo(NORTHVALE.lon, 6);
    expect(line[0][1]).toBeCloseTo(NORTHVALE.lat, 6);
    expect(line[50][0]).toBeCloseTo(PORT_CARROW.lon, 6);
    expect(line[50][1]).toBeCloseTo(PORT_CARROW.lat, 6);
  });

  it("falls back to the row's own coordinates for airports the catalogue does not know", () => {
    const line = flightGeoFeature(ZZ101, buildAirportCoordinateIndex([]), airportInfo).geometry
      .coordinates;

    expect(line[0][0]).toBeCloseTo(ZZ101.depLon, 6);
    expect(line[0][1]).toBeCloseTo(ZZ101.depLat, 6);
    expect(line[50][0]).toBeCloseTo(ZZ101.arrLon, 6);
    expect(line[50][1]).toBeCloseTo(ZZ101.arrLat, 6);
  });

  it("names each end's country and city, and measures the row's own distance", () => {
    const feature = flightGeoFeature(ZZ101, catalogue, airportInfo);

    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("LineString");
    expect(feature.properties).toMatchObject({
      id: ZZ101.id,
      tripId: null,
      flightNumber: "ZZ101",
      status: "flown",
      tags: [],
      departureAirport: { iata: "NVL", icao: "ZZNV", name: "Northvale", country: "ZZ" },
      arrivalAirport: { iata: "PCR", icao: "ZZPC", name: "Port Carrow", city: "Port Carrow" },
    });
    expect(feature.properties.distance).toBeCloseTo(
      calculateDistance(ZZ101.depLat, ZZ101.depLon, ZZ101.arrLat, ZZ101.arrLon),
      9
    );
  });

  it("answers nulls for an airport it has no facts for", () => {
    const unlisted = { ...ZZ101, arrIata: null, arrIcao: "ZZQQ" };

    const feature = flightGeoFeature(unlisted, buildAirportCoordinateIndex([]), airportInfo);

    expect(feature.properties.arrivalAirport).toEqual({
      icao: "ZZQQ",
      iata: null,
      name: "Port Carrow",
      country: null,
      city: null,
    });
  });
});
