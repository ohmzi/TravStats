import { describe, it, expect } from "vitest";

import {
  distancePrefix,
  distinctAirports,
  distinctCities,
  journeyDistanceKm,
  journeyNights,
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

describe("journeyNights", () => {
  it("counts from the day of leaving to the day it returns to the same city", () => {
    // Depart 1 Oct, home again on the 6th: five nights away — the span, NOT the
    // sum of any stays.
    expect(
      journeyNights([
        flight({
          depCity: "Oslo",
          arrCity: "Rome",
          departureTime: "2026-10-01T06:00:00.000Z",
          arrivalTime: "2026-10-01T09:00:00.000Z",
        }),
        flight({
          depCity: "Rome",
          arrCity: "Oslo",
          departureTime: "2026-10-06T18:00:00.000Z",
          arrivalTime: "2026-10-06T21:00:00.000Z",
        }),
      ])
    ).toBe(5);
  });

  it("ends a one-way at the last arrival — start to end of journey", () => {
    expect(
      journeyNights([
        flight({
          depCity: "Oslo",
          arrCity: "Rome",
          departureTime: "2026-10-01T06:00:00.000Z",
          arrivalTime: "2026-10-01T09:00:00.000Z",
        }),
        flight({
          depCity: "Rome",
          arrCity: "Athens",
          departureTime: "2026-10-03T06:00:00.000Z",
          arrivalTime: "2026-10-03T09:00:00.000Z",
        }),
      ])
    ).toBe(2);
  });

  it("closes at the FIRST return and ignores the legs after it", () => {
    // The first leg back to Oslo closes the journey; the later hop to Athens is
    // a different trip and must not stretch the span.
    expect(
      journeyNights([
        flight({
          depCity: "Oslo",
          arrCity: "Rome",
          departureTime: "2026-10-01T06:00:00.000Z",
          arrivalTime: "2026-10-01T09:00:00.000Z",
        }),
        flight({
          depCity: "Rome",
          arrCity: "Oslo",
          departureTime: "2026-10-03T06:00:00.000Z",
          arrivalTime: "2026-10-03T09:00:00.000Z",
        }),
        flight({
          depCity: "Oslo",
          arrCity: "Athens",
          departureTime: "2026-10-10T06:00:00.000Z",
          arrivalTime: "2026-10-10T09:00:00.000Z",
        }),
      ])
    ).toBe(2);
  });

  it("orders the legs by their departure, not by the order handed in", () => {
    const early = flight({
      depCity: "Oslo",
      arrCity: "Rome",
      departureTime: "2026-10-01T06:00:00.000Z",
      arrivalTime: "2026-10-01T09:00:00.000Z",
    });
    const late = flight({
      depCity: "Rome",
      arrCity: "Oslo",
      departureTime: "2026-10-06T18:00:00.000Z",
      arrivalTime: "2026-10-06T21:00:00.000Z",
    });
    expect(journeyNights([late, early])).toBe(5);
  });

  it("matches the return by city even when the airport code differs", () => {
    // Out of Gatwick, home to Heathrow: the same city, a different airport — the
    // span closes on the city, not the code.
    expect(
      journeyNights([
        flight({
          depIata: "LGW",
          arrIata: "JFK",
          depCity: "London",
          arrCity: "New York",
          departureTime: "2026-10-01T06:00:00.000Z",
          arrivalTime: "2026-10-01T14:00:00.000Z",
        }),
        flight({
          depIata: "JFK",
          arrIata: "LHR",
          depCity: "New York",
          arrCity: "London",
          departureTime: "2026-10-06T18:00:00.000Z",
          arrivalTime: "2026-10-07T03:00:00.000Z",
        }),
      ])
    ).toBe(6);
  });

  it("matches a return by code when the city is named on one leg and missing on the other", () => {
    // A partial airport catalogue (the case `airportsWithoutCity` exists for)
    // can name the origin's city on the outbound leg and leave the return's
    // arrival to its code. The return must still close the journey, or the legs
    // after it stretch the span: home again on the 5th and off again on the
    // 20th is 4 nights away, not 19.
    expect(
      journeyNights([
        flight({
          depIata: "YYZ",
          arrIata: "YUL",
          depCity: "Toronto",
          arrCity: "Montreal",
          departureTime: "2026-10-01T06:00:00.000Z",
          arrivalTime: "2026-10-01T09:00:00.000Z",
        }),
        flight({
          depIata: "YUL",
          arrIata: "YYZ",
          depCity: "Montreal",
          arrCity: null,
          departureTime: "2026-10-05T18:00:00.000Z",
          arrivalTime: "2026-10-05T21:00:00.000Z",
        }),
        flight({
          depIata: "YYZ",
          arrIata: "ATH",
          depCity: "Toronto",
          arrCity: "Athens",
          departureTime: "2026-10-20T06:00:00.000Z",
          arrivalTime: "2026-10-20T14:00:00.000Z",
        }),
      ])
    ).toBe(4);
  });

  it("matches the mirror case: origin known only by code, return by city", () => {
    // The same partial catalogue the other way round — the first leg leaves an
    // unnamed airport by its code, the return resolves the city. The span must
    // close on the return all the same.
    expect(
      journeyNights([
        flight({
          depIata: "YYZ",
          arrIata: "YUL",
          depCity: null,
          arrCity: "Montreal",
          departureTime: "2026-10-01T06:00:00.000Z",
          arrivalTime: "2026-10-01T09:00:00.000Z",
        }),
        flight({
          depIata: "YUL",
          arrIata: "YYZ",
          depCity: "Montreal",
          arrCity: "Toronto",
          departureTime: "2026-10-05T18:00:00.000Z",
          arrivalTime: "2026-10-05T21:00:00.000Z",
        }),
      ])
    ).toBe(4);
  });

  it("counts a same-day return honestly as zero", () => {
    expect(
      journeyNights([
        flight({
          depCity: "Oslo",
          arrCity: "Rome",
          departureTime: "2026-10-01T06:00:00.000Z",
          arrivalTime: "2026-10-01T09:00:00.000Z",
        }),
        flight({
          depCity: "Rome",
          arrCity: "Oslo",
          departureTime: "2026-10-01T18:00:00.000Z",
          arrivalTime: "2026-10-01T21:00:00.000Z",
        }),
      ])
    ).toBe(0);
  });

  it("is a dash — null — with no dated leg to order by", () => {
    expect(journeyNights([flight({ departureTime: null, arrivalTime: null })])).toBeNull();
    expect(journeyNights([])).toBeNull();
  });

  it("is a dash — null — when the returning leg has no arrival", () => {
    expect(
      journeyNights([
        flight({
          depCity: "Oslo",
          arrCity: "Rome",
          departureTime: "2026-10-01T06:00:00.000Z",
          arrivalTime: "2026-10-01T09:00:00.000Z",
        }),
        flight({
          depCity: "Rome",
          arrCity: "Oslo",
          departureTime: "2026-10-06T18:00:00.000Z",
          arrivalTime: null,
        }),
      ])
    ).toBeNull();
  });

  it("refuses a leg whose arrival falls before its own departure", () => {
    expect(
      journeyNights([
        flight({
          depCity: "Oslo",
          arrCity: "Rome",
          departureTime: "2026-10-06T06:00:00.000Z",
          arrivalTime: "2026-10-01T09:00:00.000Z",
        }),
      ])
    ).toBeNull();
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
