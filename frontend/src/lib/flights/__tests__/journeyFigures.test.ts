import { describe, it, expect } from "vitest";

import {
  distancePrefix,
  distinctAirports,
  distinctCities,
  journeyDistanceKm,
  nightsFromStays,
  type JourneyFlight,
  type JourneyStay,
} from "../journeyFigures";

/** A Munich → Copenhagen flight; every field a test does not care about. */
function flight(over: Partial<JourneyFlight> = {}): JourneyFlight {
  return {
    depIata: "MUC",
    arrIata: "CPH",
    depLat: 48.3538,
    depLon: 11.7861,
    arrLat: 55.618,
    arrLon: 12.6508,
    ...over,
  };
}

const stay = (over: Partial<JourneyStay> = {}): JourneyStay => ({
  checkIn: "2026-06-01T00:00:00.000Z",
  checkOut: "2026-06-03T00:00:00.000Z",
  datePrecision: "DAY",
  nights: null,
  ...over,
});

/**
 * The estimate rule, put through the fold: if a journey's distance reads as
 * MEASURED when it is not, the band is lying, and this is where that is caught
 * before any render test could see it.
 */
describe("journeyDistanceKm", () => {
  it("sums the stamped chords and calls the sum derived, not measured", () => {
    const result = journeyDistanceKm([
      flight({ routeDistance: 800 }),
      flight({ routeDistance: 600 }),
    ]);
    expect(result.km).toBe(1400);
    expect(result.derivedLegs).toBe(2);
    expect(result.liveLegs).toBe(0);
    expect(result.unknownLegs).toBe(0);
    // A leg with no recorded track is derived, so the band marks the total "~".
    expect(result.estimated).toBe(true);
  });

  it("counts a recorded track as measured, so a fully tracked journey is no estimate", () => {
    const result = journeyDistanceKm([
      flight({ routeDistance: 800, routeSource: "live_tracking" }),
    ]);
    expect(result.liveLegs).toBe(1);
    expect(result.derivedLegs).toBe(0);
    expect(result.estimated).toBe(false);
  });

  it("falls back to the great-circle chord when the row stamped no distance", () => {
    const result = journeyDistanceKm([flight()]);
    expect(result.km).toBeGreaterThan(0);
    expect(result.derivedLegs).toBe(1);
    expect(result.estimated).toBe(true);
  });

  it("adds NOTHING for a leg with neither a distance nor usable coordinates", () => {
    const result = journeyDistanceKm([
      flight({ routeDistance: 800 }),
      flight({ routeDistance: undefined, depLat: Number.NaN, depLon: Number.NaN }),
    ]);
    expect(result.km).toBe(800);
    expect(result.unknownLegs).toBe(1);
    expect(result.derivedLegs).toBe(1);
  });

  it("treats a stored routeDistance of 0 as absent, like the stats rollup does", () => {
    // `services/stats/records.ts` reads a distance with `routeDistance > 0`, so
    // a 0 is "we never worked one out" — the leg falls back to its coordinates
    // rather than counting as a real 0-km hop.
    const result = journeyDistanceKm([flight({ routeDistance: 0 })]);
    expect(result.km).toBeGreaterThan(0);
    expect(result.derivedLegs).toBe(1);
    expect(result.unknownLegs).toBe(0);
  });

  it("adds NOTHING for a leg whose endpoint is the (0,0) no-coordinate sentinel", () => {
    // A prisma Float is non-nullable, so an unresolved airport is stored (0,0),
    // not null; TripMap draws no arc for such a leg. It must not fold a chord
    // from Null Island into the headline — it is an unknown leg.
    const result = journeyDistanceKm([
      flight({ routeDistance: 800 }),
      flight({ routeDistance: undefined, arrLat: 0, arrLon: 0 }),
    ]);
    expect(result.km).toBe(800);
    expect(result.unknownLegs).toBe(1);
    expect(result.derivedLegs).toBe(1);
  });

  it("refuses even a stamped routeDistance when an endpoint is the (0,0) sentinel", () => {
    // The stamp itself was computed from the sentinel by the write path
    // (`routes/flights.ts`), so a positive routeDistance here is a phantom
    // chord, not a measurement.
    const result = journeyDistanceKm([flight({ routeDistance: 5000, arrLat: 0, arrLon: 0 })]);
    expect(result.km).toBe(0);
    expect(result.unknownLegs).toBe(1);
    expect(result.derivedLegs).toBe(0);
  });

  it("marks a derived AND partial sum with both the lower-bound and the derived sign", () => {
    // One derived leg and one unknown leg: the sum is a lower bound AND a set of
    // chords, so the prefix says both (the card and the band share this rule).
    const distance = journeyDistanceKm([
      flight({ routeDistance: 800 }),
      flight({ routeDistance: undefined, depLat: Number.NaN, depLon: Number.NaN }),
    ]);
    expect(distancePrefix(distance)).toBe("≈ ~");
  });

  it("marks a fully measured journey with no sign at all", () => {
    const distance = journeyDistanceKm([
      flight({ routeDistance: 800, routeSource: "live_tracking" }),
    ]);
    expect(distancePrefix(distance)).toBe("");
  });

  it("reports an empty journey honestly — no distance and nothing estimated", () => {
    expect(journeyDistanceKm([])).toEqual({
      km: 0,
      estimated: false,
      liveLegs: 0,
      derivedLegs: 0,
      unknownLegs: 0,
    });
  });
});

describe("distinctAirports and distinctCities", () => {
  it("counts distinct airports by IATA, the rule the logbook strip shares", () => {
    expect(
      distinctAirports([
        flight({ depIata: "MUC", arrIata: "CPH" }),
        flight({ depIata: "CPH", arrIata: "MUC" }),
      ])
    ).toBe(2);
  });

  it("counts CITIES — fewer than airports when two airports share one", () => {
    const flights = [
      flight({ depIata: "LHR", arrIata: "JFK", depCity: "London", arrCity: "New York" }),
      flight({ depIata: "LGW", arrIata: "JFK", depCity: "London", arrCity: "New York" }),
    ];
    // Heathrow and Gatwick are both London: three airports, two cities.
    expect(distinctAirports(flights)).toBe(3);
    expect(distinctCities(flights).count).toBe(2);
  });

  it("says how many airports had no city, so a partial count reads as a lower bound", () => {
    const cities = distinctCities([
      flight({ depIata: "MUC", arrIata: "CPH", depCity: "Munich", arrCity: null }),
    ]);
    expect(cities.count).toBe(1);
    expect(cities.airportsWithoutCity).toBe(1);
  });

  it("yields ZERO cities — a dash with a reason, not a hidden zero", () => {
    const cities = distinctCities([flight({ depCity: null, arrCity: null })]);
    expect(cities.count).toBe(0);
    expect(cities.airportsWithoutCity).toBe(2);
  });
});

describe("nightsFromStays", () => {
  it("sums the recorded stays' nights", () => {
    const nights = nightsFromStays([
      stay({ checkIn: "2026-06-01T00:00:00.000Z", checkOut: "2026-06-03T00:00:00.000Z" }),
      stay({ checkIn: "2026-06-05T00:00:00.000Z", checkOut: "2026-06-08T00:00:00.000Z" }),
    ]);
    expect(nights).toEqual({ nights: 5, approximate: false, stays: 2 });
  });

  it("returns null for a journey with no stay — a dash with a reason, never a zero", () => {
    expect(nightsFromStays([])).toBeNull();
  });

  it("marks the total approximate when a stay's length is itself only a bound", () => {
    const nights = nightsFromStays([
      stay({ checkIn: "2026-06-01T00:00:00.000Z", checkOut: null, datePrecision: "YEAR" }),
    ]);
    expect(nights?.approximate).toBe(true);
  });

  it("skips a cancelled stay whole — a night that did not happen", () => {
    expect(nightsFromStays([stay({ status: "cancelled" })])).toBeNull();
  });
});
