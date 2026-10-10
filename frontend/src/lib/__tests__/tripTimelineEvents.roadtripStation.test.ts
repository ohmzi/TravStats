import { describe, expect, it } from "vitest";
import type { Trip, TripStop } from "../../types";
import { formatTimelineDate } from "../tripTimeline";
import { buildTimelineEvents } from "../tripTimelineEvents";
import { dayAt, stationDto } from "./roadtripStationFixture";

/**
 * A roadtrip's stations are on its trip's timeline (spec 2026-10-09 §E), each
 * on the day it begins at the station. A station adopted onto the trip is
 * already one of `trip.stops`, so it must not be drawn a second time.
 */
const PORT_CARROW = stationDto({
  id: "b1b1b1b1-0000-4000-8000-000000000001",
  title: "Port Carrow",
  state: "pass",
  nights: 0,
  routeOrderIdx: 1,
  times: { start: dayAt("2031-05-04"), end: dayAt("2031-05-04") },
});

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

describe("roadtrip stations on the trip timeline", () => {
  it("draws each station on the day it begins", () => {
    const events = buildTimelineEvents(trip({ roadtripStations: [PORT_CARROW, stationDto()] }), []);

    expect(events.map((e) => [e.kind, formatTimelineDate(e.when)])).toEqual([
      ["roadtrip-station", "02.05.2031"],
      ["roadtrip-station", "04.05.2031"],
    ]);
  });

  it("draws a station that is also a timeline stop only once", () => {
    const adopted = {
      id: PORT_CARROW.id,
      tripId: "t1",
      orderIdx: 0,
      domain: "roadtrip",
      sourceId: null,
      title: "Port Carrow",
      description: null,
      startDate: "2031-05-04T00:00:00.000Z",
      endDate: null,
      lat: -44.7,
      lon: 169.15,
      notes: null,
      createdAt: "2031-05-01T00:00:00.000Z",
      updatedAt: "2031-05-01T00:00:00.000Z",
    } satisfies TripStop;

    const events = buildTimelineEvents(
      trip({ stops: [adopted], roadtripStations: [stationDto(), PORT_CARROW] }),
      []
    );

    expect(events.map((e) => e.id)).toEqual([
      "roadtrip-station-7c6b5a49-3827-4615-9d0c-1b2a3f4e5d6c",
      `stop-${PORT_CARROW.id}`,
    ]);
  });

  it("leaves out a station with no day", () => {
    const undated = stationDto({
      startDate: null,
      endDate: null,
      times: { start: null, end: null },
    });

    expect(buildTimelineEvents(trip({ roadtripStations: [undated] }), [])).toEqual([]);
  });

  it("reads a trip payload that has no stations at all", () => {
    expect(buildTimelineEvents(trip({}), [])).toEqual([]);
  });

  it("puts a station before the diary entry of its day", () => {
    const diary = {
      id: "j1",
      tripId: "t1",
      date: "2031-05-02T00:00:00.000Z",
      title: "First night",
      body: "",
      mood: null,
      weather: null,
      createdAt: "",
      updatedAt: "",
    };

    const events = buildTimelineEvents(
      trip({
        journalEntries: [diary] as unknown as Trip["journalEntries"],
        roadtripStations: [stationDto()],
      }),
      []
    );

    expect(events.map((e) => e.kind)).toEqual(["roadtrip-station", "journal"]);
  });
});
