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

  it("puts the flight before the stations and stops of the day it arrived on", () => {
    // Owner report 2026-10-13 ("Sumayya's wedding"): the journey's timeline
    // showed a transit's stop before the flight that carried the traveller
    // there. Synthetic fixture only (public repository).
    const arrival = {
      id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
      depIata: "ZPC",
      arrIata: "ZEP",
      departureTime: "2031-05-17T01:10:00.000Z",
      arrivalTime: "2031-05-17T07:25:00.000Z",
      depTimezone: "Pacific/Auckland",
      arrTimezone: "Pacific/Auckland",
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
    } as NonNullable<Trip["flights"]>[number];
    const transitStop = {
      id: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
      tripId: "t1",
      orderIdx: 0,
      domain: null,
      sourceId: null,
      title: "Port Carrow",
      description: null,
      startDate: "2031-05-17T00:00:00.000Z",
      endDate: null,
      lat: 41.0,
      lon: 28.8,
      notes: null,
      createdAt: "2031-05-01T00:00:00.000Z",
      updatedAt: "2031-05-01T00:00:00.000Z",
    } satisfies TripStop;
    const transitStation = stationDto({
      id: "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70",
      startDate: "2031-05-17T00:00:00.000Z",
      endDate: "2031-05-17T00:00:00.000Z",
      routeStartDate: "2031-05-17T00:00:00.000Z",
      routeEndDate: "2031-05-17T00:00:00.000Z",
      times: { start: dayAt("2031-05-17"), end: dayAt("2031-05-17") },
    });

    const events = buildTimelineEvents(
      trip({ flights: [arrival], stops: [transitStop], roadtripStations: [transitStation] }),
      []
    );

    expect(events.map((e) => e.kind)).toEqual(["flight", "stop", "roadtrip-station"]);
  });

  it("puts a station before the flight that TOOK the traveller away from it (owner 2026-10-14)", () => {
    // The owner's report: a journey showed the flight out of the departure
    // airport and only THEN presence at the place (the drive back to the
    // airport). The flight's DEPARTURE airport is the one beside the station,
    // so the station must sort BEFORE it. Synthetic fixture only (public
    // repository): invented airports, places and year.
    const departure = {
      id: "e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7081",
      depIata: "QDV",
      arrIata: "ZAR",
      departureTime: "2031-06-03T07:40:00.000Z",
      arrivalTime: "2031-06-03T10:45:00.000Z",
      depTimezone: "UTC",
      arrTimezone: "UTC",
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
      depLat: 34.0,
      depLon: 22.0,
      arrLat: 52.0,
      arrLon: 8.0,
    } as NonNullable<Trip["flights"]>[number];
    const backToAirport = stationDto({
      id: "f6a7b8c9-d0e1-4f2a-9b3c-4d5e6f708192",
      title: "Qdv Port",
      lat: 34.05,
      lon: 22.1,
      state: "pass",
      nights: 0,
      routeOrderIdx: 19,
      startDate: "2031-06-03T00:00:00.000Z",
      endDate: "2031-06-03T00:00:00.000Z",
      routeStartDate: "2031-06-03T00:00:00.000Z",
      routeEndDate: "2031-06-03T00:00:00.000Z",
      times: { start: dayAt("2031-06-03"), end: dayAt("2031-06-03") },
    });

    const events = buildTimelineEvents(
      trip({ flights: [departure], roadtripStations: [backToAirport] }),
      []
    );

    expect(events.map((e) => e.kind)).toEqual(["roadtrip-station", "flight"]);
  });

  it("keeps the flight before a station at its ARRIVAL airport on the day it landed", () => {
    // The mirror: the flight's ARRIVAL airport is the one beside the station,
    // so the flight still sorts first (owner 2026-10-13 ruling, kept).
    const arrival = {
      id: "a7b8c9d0-e1f2-4a3b-8c4d-5e6f70819a2b",
      depIata: "QDV",
      arrIata: "ZAR",
      departureTime: "2031-06-03T07:40:00.000Z",
      arrivalTime: "2031-06-03T10:45:00.000Z",
      depTimezone: "UTC",
      arrTimezone: "UTC",
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
      depLat: 34.0,
      depLon: 22.0,
      arrLat: 52.0,
      arrLon: 8.0,
    } as NonNullable<Trip["flights"]>[number];
    const atArrival = stationDto({
      id: "b8c9d0e1-f2a3-4b4c-9d5e-6f70819a2b3c",
      title: "Zar Harbour",
      lat: 52.05,
      lon: 8.1,
      state: "pass",
      nights: 0,
      routeOrderIdx: 0,
      startDate: "2031-06-03T00:00:00.000Z",
      endDate: "2031-06-03T00:00:00.000Z",
      routeStartDate: "2031-06-03T00:00:00.000Z",
      routeEndDate: "2031-06-03T00:00:00.000Z",
      times: { start: dayAt("2031-06-03"), end: dayAt("2031-06-03") },
    });

    const events = buildTimelineEvents(
      trip({ flights: [arrival], roadtripStations: [atArrival] }),
      []
    );

    expect(events.map((e) => e.kind)).toEqual(["flight", "roadtrip-station"]);
  });
});
