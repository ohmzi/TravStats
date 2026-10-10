jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { loadVisibleDomains } from "../../domainVisibility";
import { prepareCommit } from "../commitPlan";
import {
  AREA_KEY,
  JOURNEY_ID,
  K_NV,
  K_PC,
  K_SB,
  fixtureBody,
  fixtureDraft,
} from "./commitFixtures";

const mockDomains = loadVisibleDomains as jest.Mock;
const FLIGHT = "ff0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
const OTHER_AREA = "2031-05-09#1";
const K_HOME = "-904|3369|2031-05-02";
const K_AIRPORT = "-881|3402|2031-05-05";

describe("prepareCommit", () => {
  let userId: string;
  let strangerId: string;
  let flightId: string;
  let strangerFlightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tb-plan", "tb-plan-2"] } } });
    const make = async (username: string) =>
      prisma.user.create({ data: { username, passwordHash: await hashPassword("password123") } });
    userId = (await make("tb-plan")).id;
    strangerId = (await make("tb-plan-2")).id;
    const flight = (owner: string) =>
      prisma.flight.create({
        data: {
          userId: owner,
          flightNumber: "ZZ101",
          depLat: -44.72,
          depLon: 169.17,
          arrLat: -38.02,
          arrLon: 177.01,
        },
      });
    flightId = (await flight(userId)).id;
    strangerFlightId = (await flight(strangerId)).id;
  });

  beforeEach(() => mockDomains.mockResolvedValue(["flight", "roadtrip"]));

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tb-plan", "tb-plan-2"] } } });
    await prisma.$disconnect();
  });

  const draft = (flightIds: string[] = [flightId]) => fixtureDraft(userId, flightIds);
  const plan = (body = fixtureBody([flightId]), d = draft()) => prepareCommit(userId, d, body);
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as {
        statusCode: number;
        code?: string;
        field?: string;
        extra?: Record<string, unknown>;
      };
    }
    throw new Error("expected prepareCommit to refuse");
  };

  it("derives the roadtrip rows, the leg modes and the night count from the nights", async () => {
    const result = await plan();

    expect(result.window).toEqual({ startDay: "2031-05-02", endDay: "2031-05-05" });
    expect(result.flightIds).toEqual([flightId]);
    expect(result.unknownNights).toBe(0);
    expect(result.roadtrips).toHaveLength(1);
    const [roadtrip] = result.roadtrips;
    expect(roadtrip).toMatchObject({
      areaKey: AREA_KEY,
      name: "Northvale loop",
      vehicle: "car",
      legModes: ["road", "ferry"],
      nights: 3,
    });
    expect(
      roadtrip.stations.map((s) => [
        s.title,
        s.startDate?.toISOString(),
        s.endDate?.toISOString(),
        s.night.kind,
      ])
    ).toEqual([
      ["Northvale", "2031-05-02T00:00:00.000Z", "2031-05-04T00:00:00.000Z", "free"],
      ["Port Carrow", "2031-05-04T00:00:00.000Z", "2031-05-05T00:00:00.000Z", "free"],
      ["Selby Bay", "2031-05-05T00:00:00.000Z", "2031-05-05T00:00:00.000Z", "pass"],
    ]);
  });

  it("fills the new trip's window, countries and labels from the draft", async () => {
    const { target } = await plan();
    expect(target).toMatchObject({
      kind: "new",
      trip: { name: "Northvale loop", countries: ["NZ"] },
    });
    if (target.kind !== "new") throw new Error("unreachable");
    expect(target.trip.startDate?.toISOString()).toBe("2031-05-02T00:00:00.000Z");
    expect(target.trip.endDate?.toISOString()).toBe("2031-05-05T00:00:00.000Z");
  });

  it("counts a night nobody assigned as unknown", async () => {
    const body = fixtureBody([flightId]);
    delete body.nights["2031-05-04"];
    expect((await plan(body)).unknownNights).toBe(1);
  });

  it("turns a stops area into timeline stops, leaving home and airport stations out and merging runs of one title", async () => {
    // The traveller's home must never reach the timeline, so the area is
    // bracketed by a home and an airport station the scan offered.
    const home = {
      key: K_HOME,
      title: "Kelmore",
      lat: -45.1,
      lon: 168.6,
      kind: "home" as const,
      firstDay: "2031-05-02",
      lastDay: "2031-05-02",
    };
    const airport = {
      key: K_AIRPORT,
      title: "Kelmore Airport",
      lat: -44.1,
      lon: 170.0,
      kind: "airport" as const,
      firstDay: "2031-05-05",
      lastDay: "2031-05-05",
    };
    const body = fixtureBody([flightId]);
    body.areas[0].as = "stops";
    body.areas[0].stations[1].title = "Northvale";
    body.areas[0].stations = [home, ...body.areas[0].stations, airport];
    body.areas[0].legModes = ["road", "road", "ferry", "road"];
    body.nights = {};
    const offered = fixtureDraft(userId, [flightId], {
      stationIndex: new Map([
        ...draft().stationIndex,
        [home.key, { areaKey: AREA_KEY, firstDay: home.firstDay, lastDay: home.lastDay }],
        [airport.key, { areaKey: AREA_KEY, firstDay: airport.firstDay, lastDay: airport.lastDay }],
      ]),
    });
    const result = await plan(body, offered);

    expect(result.roadtrips).toEqual([]);
    expect(result.stops).toEqual([
      {
        areaKey: AREA_KEY,
        title: "Northvale",
        lat: -45.05,
        lon: 168.7,
        startDay: "2031-05-02",
        endDay: "2031-05-04",
        notes: null,
      },
      {
        areaKey: AREA_KEY,
        title: "Selby Bay",
        lat: -44.2,
        lon: 169.95,
        startDay: "2031-05-05",
        endDay: "2031-05-05",
        notes: null,
      },
    ]);
  });

  it("merges the two stops either side of a dropped station into one when they share a title", async () => {
    const body = fixtureBody([flightId]);
    body.areas[0].as = "stops";
    body.areas[0].stations[1].kind = "airport";
    body.areas[0].stations[2].title = "Northvale";
    body.nights = {};
    const result = await plan(body);

    // The airport is dropped first and the run is merged after, so the one
    // Northvale stop spans the days the dropped station covered (2031-05-04).
    expect(result.stops).toEqual([
      {
        areaKey: AREA_KEY,
        title: "Northvale",
        lat: -45.05,
        lon: 168.7,
        startDay: "2031-05-02",
        endDay: "2031-05-05",
        notes: null,
      },
    ]);
  });

  it("writes nothing for an area the user skipped", async () => {
    const body = fixtureBody([flightId]);
    body.areas[0].as = "skip";
    body.nights = {};
    const result = await plan(body);
    expect([result.roadtrips, result.stops]).toEqual([[], []]);
    expect(result.unknownNights).toBe(3);
  });

  it("refuses 409 WINDOW_CHANGED for another window, or a typed trip date that disagrees", async () => {
    const moved = fixtureBody([flightId]);
    moved.window.endDay = "2031-05-06";
    expect((await refusal(plan(moved))).code).toBe("WINDOW_CHANGED");

    const typed = fixtureBody([flightId]);
    typed.target = {
      kind: "new",
      trip: { name: "Northvale loop", startDate: new Date("2031-05-03T00:00:00.000Z") },
    };
    const error = await refusal(plan(typed));
    expect([error.statusCode, error.code]).toEqual([409, "WINDOW_CHANGED"]);
  });

  it("refuses 400 DRAFT_MISMATCH for things the draft never offered", async () => {
    const field = async (body: ReturnType<typeof fixtureBody>, d = draft()) => {
      const error = await refusal(plan(body, d));
      return [error.statusCode, error.code, error.field];
    };

    expect(await field(fixtureBody([FLIGHT]))).toEqual([400, "DRAFT_MISMATCH", "flightIds"]);
    expect(await field(fixtureBody([strangerFlightId]), draft([strangerFlightId]))).toEqual([
      400,
      "DRAFT_MISMATCH",
      "flightIds",
    ]);

    const journeys = fixtureBody([flightId]);
    journeys.photoJourneyIds = ["99999999-9999-4999-8999-999999999999"];
    expect(await field(journeys)).toEqual([400, "DRAFT_MISMATCH", "photoJourneyIds"]);

    const area = fixtureBody([flightId]);
    area.areas[0].key = OTHER_AREA;
    expect(await field(area)).toEqual([400, "DRAFT_MISMATCH", "areas"]);

    const station = fixtureBody([flightId]);
    station.areas[0].stations[0].key = "-1|-1|2031-05-02";
    expect(await field(station)).toEqual([400, "DRAFT_MISMATCH", "stations"]);

    const late = fixtureBody([flightId]);
    late.areas[0].stations[2].lastDay = "2031-05-09";
    expect(await field(late)).toEqual([400, "DRAFT_MISMATCH", "stations"]);

    const album = fixtureBody([flightId]);
    album.album.create = true;
    const noAlbum = draft();
    noAlbum.dto.album = null;
    expect(await field(album, noAlbum)).toEqual([400, "DRAFT_MISMATCH", "album"]);

    const target = fixtureBody([flightId]);
    target.target = {
      kind: "existing",
      tripId: "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01",
      applyWindow: true,
    };
    expect(await field(target)).toEqual([400, "DRAFT_MISMATCH", "target"]);
  });

  it("accepts a ticked photo-journey finding the draft offered", async () => {
    const body = fixtureBody([flightId]);
    body.photoJourneyIds = [JOURNEY_ID];
    expect((await plan(body)).photoJourneyIds).toEqual([JOURNEY_ID]);
  });

  it("refuses 404 for an existing target that is not the caller's", async () => {
    const trip = await prisma.trip.create({ data: { userId: strangerId, name: "Theirs" } });
    const d = draft();
    d.input = { ...d.input, target: { kind: "existing", tripId: trip.id } };
    const body = fixtureBody([flightId]);
    body.target = { kind: "existing", tripId: trip.id, applyWindow: true };
    expect((await refusal(plan(body, d))).statusCode).toBe(404);
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  it("unions the existing trip's countries with the draft's", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Spring", countries: ["AU"] } });
    const d = draft();
    d.input = { ...d.input, target: { kind: "existing", tripId: trip.id } };
    const body = fixtureBody([flightId]);
    body.target = { kind: "existing", tripId: trip.id, applyWindow: false };
    const { target } = await plan(body, d);
    expect(target).toEqual({
      kind: "existing",
      tripId: trip.id,
      tripName: "Spring",
      applyWindow: false,
      countries: ["AU", "NZ"],
    });
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  it("refuses 409 ROADTRIPS_HIDDEN for a roadtrip area while roadtrips are hidden", async () => {
    mockDomains.mockResolvedValue(["flight"]);
    const error = await refusal(plan());
    expect([error.statusCode, error.code]).toEqual([409, "ROADTRIPS_HIDDEN"]);

    const stops = fixtureBody([flightId]);
    stops.areas[0].as = "stops";
    stops.nights = {};
    await expect(plan(stops)).resolves.toBeDefined();
  });

  it("refuses 400 NIGHT_PLAN_INVALID with the first reason, station and day", async () => {
    const body = fixtureBody([flightId]);
    body.nights["2031-05-03"] = K_SB;
    const error = await refusal(plan(body));
    expect([error.statusCode, error.code]).toEqual([400, "NIGHT_PLAN_INVALID"]);
    expect(error.extra).toEqual({
      reason: "nightNotAdjacent",
      stationKey: K_SB,
      day: "2031-05-03",
    });

    const unknown = fixtureBody([flightId]);
    unknown.nights["2031-05-03"] = "-1|-1|2031-05-03";
    expect((await refusal(plan(unknown))).extra).toMatchObject({ reason: "unknownStation" });

    const outside = fixtureBody([flightId]);
    outside.nights["2031-05-09"] = K_NV;
    expect((await refusal(plan(outside))).extra).toMatchObject({
      reason: "nightOutsideWindow",
      day: "2031-05-09",
    });
  });

  it("refuses 400 STATIONS_INVALID when a roadtrip would have fewer than two stations", async () => {
    const body = fixtureBody([flightId]);
    body.areas[0].stations = [body.areas[0].stations[0]];
    body.areas[0].legModes = [];
    body.nights = { "2031-05-02": K_NV, "2031-05-03": K_NV };
    const error = await refusal(plan(body));
    expect([error.statusCode, error.code]).toEqual([400, "STATIONS_INVALID"]);
    expect(K_PC).toBeDefined();
  });
});
