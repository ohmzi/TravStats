import { describe, expect, it } from "vitest";
import type { Trip } from "../../types";
import { formatTimelineDate } from "../tripTimeline";
import { buildTimelineEvents } from "../tripTimelineEvents";
import { dayAt, stationDto } from "./roadtripStationFixture";

/**
 * The trip's own days place its entries on the journey's timeline (owner
 * 2026-10-13). The report: "my flight to muscat is showing up after the trip
 * of muscat starts". The server sends the trip's effective span on every
 * station (`routeStartDate`/`routeEndDate` — the row's own days where set);
 * the timeline draws a station the span leaves outside at the bound, and a
 * station with no time of day sorts AFTER the flights of its day, so the
 * arriving flight precedes the trip it brought the traveller to.
 *
 * Synthetic fixtures only: invented places, 2031.
 */
type TripFlight = NonNullable<Trip["flights"]>[number];

/** The flight INTO the trip's first city: out on D at 07:45, there at 10:00. */
const arrivalFlight = {
  id: "f1",
  depIata: "ZZA",
  arrIata: "ZZB",
  departureTime: "2031-05-02T07:45:00.000Z",
  arrivalTime: "2031-05-02T10:00:00.000Z",
  depTimezone: "UTC",
  arrTimezone: "UTC",
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
} as TripFlight;

function trip(over: Partial<Trip>): Trip {
  return {
    id: "t1",
    flights: [],
    cruises: [],
    stops: [],
    journalEntries: [],
    ...over,
  } as unknown as Trip;
}

describe("the trip's own days on the journey timeline", () => {
  it("renders the arriving flight before the trip whose stored start is its day", () => {
    // The trip's stored start is D (05-02) although its first station is
    // still dated the day before: the span's start places it.
    const station = stationDto({
      startDate: "2031-05-01T00:00:00.000Z",
      endDate: "2031-05-04T00:00:00.000Z",
      times: { start: dayAt("2031-05-01"), end: dayAt("2031-05-04") },
      routeStartDate: "2031-05-02T00:00:00.000Z",
      routeEndDate: "2031-05-06T00:00:00.000Z",
    });

    const events = buildTimelineEvents(
      trip({ flights: [arrivalFlight], roadtripStations: [station] }),
      []
    );

    expect(events.map((e) => e.kind)).toEqual(["flight", "roadtrip-station"]);
    // The flight is on its departure day ("… 07:45"); the trip's entry is
    // drawn on the stored start, never before it.
    expect(events.map((e) => formatTimelineDate(e.when).slice(0, 10))).toEqual([
      "02.05.2031",
      "02.05.2031",
    ]);
  });

  it("sorts a time-less station after a timed flight of the same day", () => {
    // Same day for both, no stored move: the station is still the place you
    // ARRIVE at, so the flight that carried you there comes first.
    const station = stationDto({
      times: { start: dayAt("2031-05-02"), end: dayAt("2031-05-04") },
      routeStartDate: "2031-05-02T00:00:00.000Z",
      routeEndDate: "2031-05-06T00:00:00.000Z",
    });

    const events = buildTimelineEvents(
      trip({ flights: [arrivalFlight], roadtripStations: [station] }),
      []
    );

    expect(events.map((e) => e.kind)).toEqual(["flight", "roadtrip-station"]);
  });

  it("draws a station past the trip's stored end at the end", () => {
    const late = stationDto({
      id: "b1b1b1b1-0000-4000-8000-000000000002",
      title: "Selby Bay",
      startDate: "2031-05-09T00:00:00.000Z",
      endDate: "2031-05-10T00:00:00.000Z",
      times: { start: dayAt("2031-05-09"), end: dayAt("2031-05-10") },
      routeStartDate: "2031-05-02T00:00:00.000Z",
      routeEndDate: "2031-05-06T00:00:00.000Z",
    });

    const events = buildTimelineEvents(trip({ roadtripStations: [late] }), []);

    expect(events.map((e) => formatTimelineDate(e.when))).toEqual(["06.05.2031"]);
  });

  it("leaves a trip with no stored days exactly where its stations put it", () => {
    const station = stationDto({
      times: { start: dayAt("2031-05-04"), end: dayAt("2031-05-06") },
      routeStartDate: "2031-05-02T00:00:00.000Z",
      routeEndDate: "2031-05-06T00:00:00.000Z",
    });

    const events = buildTimelineEvents(trip({ roadtripStations: [station] }), []);

    expect(events.map((e) => formatTimelineDate(e.when))).toEqual(["04.05.2031"]);
  });
});
