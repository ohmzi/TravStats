import { describe, expect, it } from "vitest";
import { compareTimelineEvents, dayAsTimeValue } from "../tripTimeline";
import type { TimeValue } from "../../shared/time";

/**
 * The owner's report (2026-10-13, "Sumayya's wedding"): "after karachi its
 * showing presence in istanbul and then flight from karachi to istanbul …
 * the flight should be moved ahead of the displacement into next city". A
 * flight sorts BEFORE the place entries it moved the traveller to: a station
 * entry on the flight's own arrival day sorts after the flight, and the rank
 * stays a fallback for a MISSING clock — a recorded time keeps its place.
 */

/** A place's wall clock, and its instant (default: the same clock read as UTC). */
const at = (local: string, utc = `${local}:00.000Z`): TimeValue => ({
  utc,
  zone: "Europe/Istanbul",
  offset: "+03:00",
  local,
  precision: "minute",
});

/** A day-precision value at a place. */
const day = (date: string): TimeValue => dayAsTimeValue({ date, zone: null, precision: "day" });

const flight = (local: string, arrivalDay: string | null) => ({
  kind: "flight",
  when: at(local),
  arrivalDay,
});
const stop = (date: string) => ({ kind: "stop", when: day(date), id: `stop-${date}` });
const station = (date: string) => ({
  kind: "roadtrip-station",
  when: day(date),
  id: `station-${date}`,
});
const visit = (date: string) => ({ kind: "place-visit", when: day(date), id: `visit-${date}` });

const order = (events: ReadonlyArray<{ kind: string; when: TimeValue }>) =>
  [...events].sort(compareTimelineEvents).map((e) => e.kind);

/** A payload point, the way the event builder carries coordinates on an event. */
const point = (lat: number, lon: number) => ({ lat, lon });

/** A flight that carries its two airports' points, as the builder now does. */
const geoFlight = (
  local: string,
  arrivalDay: string | null,
  depPoint: { lat: number; lon: number } | null,
  arrPoint: { lat: number; lon: number } | null
) => ({ kind: "flight", when: at(local), arrivalDay, depPoint, arrPoint });

/** A time-less place station that carries its own point. */
const geoStation = (date: string, point: { lat: number; lon: number } | null) => ({
  kind: "roadtrip-station",
  when: day(date),
  id: `station-${date}`,
  point,
});

describe("a flight and the place entries it moved the traveller to", () => {
  it("puts the flight before the Istanbul presence of its own arrival day", () => {
    const events = [
      station("2031-05-17"),
      stop("2031-05-17"),
      flight("2031-05-17T06:10", "2031-05-17"),
    ];
    expect(order(events)).toEqual(["flight", "stop", "roadtrip-station"]);
  });

  it("puts the flight before a place visit of its arrival day too", () => {
    const events = [visit("2031-05-17"), flight("2031-05-17T06:10", "2031-05-17")];
    expect(order(events)).toEqual(["flight", "place-visit"]);
  });

  it("leaves a day without a place entry, and other days, exactly as they were", () => {
    const events = [
      stop("2031-05-16"),
      flight("2031-05-17T06:10", "2031-05-17"),
      stop("2031-05-18"),
      station("2031-05-18"),
    ];
    expect(order(events)).toEqual(["stop", "flight", "stop", "roadtrip-station"]);
  });

  it("keeps a recorded clock: a place entry that carries a time is never overridden", () => {
    // An entry WITH a time is information, not a tie: a stop at 05:00 the
    // morning of the flight stays before the flight that leaves at 06:10.
    const timed = [
      { kind: "stop", when: at("2031-05-17T05:00") },
      flight("2031-05-17T06:10", "2031-05-17"),
    ];
    expect(order(timed)).toEqual(["stop", "flight"]);
    // A time-less entry of the same day goes after the flight, as reported.
    const tied = [stop("2031-05-17"), flight("2031-05-17T06:10", "2031-05-17")];
    expect(order(tied)).toEqual(["flight", "stop"]);
  });

  it("keeps the departure day's entries before an overnight flight", () => {
    // The flight leaves late on the 17th and lands on the 18th: the 17th's
    // stop is a place the traveller was at BEFORE boarding — it stays first.
    const events = [flight("2031-05-17T23:00", "2031-05-18"), stop("2031-05-17")];
    expect(order(events)).toEqual(["stop", "flight"]);
  });

  it("changes nothing for a flight whose arrival day is not known", () => {
    const events = [stop("2031-05-17"), flight("2031-05-17T06:10", null)];
    // Same ranks, so the instants decide: the day-only stop reads as midnight
    // and stays first, exactly as before this rule.
    expect(order(events)).toEqual(["stop", "flight"]);
  });
});

/**
 * The owner's report (2026-10-14): the SAME pairing rule was one-directional.
 * A flight that TOOK the traveller away — its DEPARTURE airport, not its
 * arrival one, is the airport at the place — was treated like an arrival and
 * drawn before the place's time-less entries, so the place continued to be
 * shown AFTER the traveller had already flown home. The rule now asks which of
 * the flight's two airports is NEARER the place (the points the event builder
 * carries): nearer arrival ⇒ brought the traveller there ⇒ first (unchanged),
 * nearer departure ⇒ took them away ⇒ last. Coordinates on both sides decide
 * it; where either is missing the rule keeps today's behaviour exactly.
 *
 * Synthetic fixtures only — invented airports, places and years 2031+.
 */
describe("a flight and the place entries it took the traveller away from", () => {
  // Two invented airports far apart, and a place beside the DEPARTURE one.
  const DEP = point(34.0, 22.0);
  const ARR = point(52.0, 8.0);
  const AT_DEPARTURE = point(34.05, 22.1);
  const AT_ARRIVAL = point(52.05, 8.1);

  it("puts a same-day time-less place entry BEFORE the departure flight (the owner's report)", () => {
    // The flight leaves at 07:40 and lands later the same day; the place is the
    // drive back to the departure airport. The place must come first.
    const events = [
      geoStation("2031-06-03", AT_DEPARTURE),
      geoFlight("2031-06-03T07:40", "2031-06-03", DEP, ARR),
    ];
    expect(order(events)).toEqual(["roadtrip-station", "flight"]);
  });

  it("keeps the arrival shape: an arrival flight still sorts FIRST (an arrival at the place)", () => {
    const events = [
      geoStation("2031-06-03", AT_ARRIVAL),
      geoFlight("2031-06-03T07:40", "2031-06-03", DEP, ARR),
    ];
    expect(order(events)).toEqual(["flight", "roadtrip-station"]);
  });

  it("leaves an unrelated flight crossing the day exactly as today", () => {
    // The flight departs late on the 3rd and lands on the 4th: it does not
    // share the place's day, and neither airport is near the place. Nothing
    // moves — the timed flight keeps its rank order, as before this rule.
    const crossing = geoFlight("2031-06-03T23:00", "2031-06-04", DEP, ARR);
    const place = geoStation("2031-06-03", point(5.0, 5.0));
    expect(order([place, crossing])).toEqual(["flight", "roadtrip-station"]);
    // The same order as a flight that carries no points at all — the
    // coordinates change nothing here.
    const plain = geoFlight("2031-06-03T23:00", "2031-06-04", null, null);
    expect(order([place, plain])).toEqual(["flight", "roadtrip-station"]);
  });

  it("keeps today's behaviour when either side has no coordinates", () => {
    // The flight carries none: unknown direction ⇒ the arrival rule stands.
    const noAirports = [
      geoStation("2031-06-03", AT_DEPARTURE),
      geoFlight("2031-06-03T07:40", "2031-06-03", null, null),
    ];
    expect(order(noAirports)).toEqual(["flight", "roadtrip-station"]);
    // The place carries none: likewise unknown.
    const noPlace = [
      geoStation("2031-06-03", null),
      geoFlight("2031-06-03T07:40", "2031-06-03", DEP, ARR),
    ];
    expect(order(noPlace)).toEqual(["flight", "roadtrip-station"]);
  });

  it("never overrides a place entry that carries a time", () => {
    // A station WITH a clock keeps its place in the clock order even when it
    // sits beside the departure airport.
    const timed = {
      kind: "roadtrip-station",
      when: at("2031-06-03T09:00"),
      id: "timed-station",
      point: AT_DEPARTURE,
    };
    const events = [timed, geoFlight("2031-06-03T07:40", "2031-06-03", DEP, ARR)];
    expect(order(events)).toEqual(["flight", "roadtrip-station"]);
  });

  it("never drags an entry of another day after the departure", () => {
    // The place is the day BEFORE the flight: the day-first ordering holds.
    const events = [
      geoStation("2031-06-02", AT_DEPARTURE),
      geoFlight("2031-06-03T07:40", "2031-06-03", DEP, ARR),
    ];
    expect(order(events)).toEqual(["roadtrip-station", "flight"]);
  });
});
