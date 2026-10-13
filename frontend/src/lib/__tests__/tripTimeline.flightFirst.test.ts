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
