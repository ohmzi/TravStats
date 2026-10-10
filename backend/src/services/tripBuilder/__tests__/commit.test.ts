import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import * as replaceModule from "../../roadtrip/replaceStations";
import { writeCommit } from "../commit";
import { fixturePlan } from "./commitFixtures";

describe("writeCommit, new trip", () => {
  let userId: string;
  let strangerId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tb-commit", "tb-commit-2"] } } });
    const make = async (username: string) =>
      prisma.user.create({ data: { username, passwordHash: await hashPassword("password123") } });
    userId = (await make("tb-commit")).id;
    strangerId = (await make("tb-commit-2")).id;
  });

  const makeFlight = (owner: string) =>
    prisma.flight.create({
      data: {
        userId: owner,
        flightNumber: "ZZ101",
        depIata: "ZPC",
        arrIata: "ZEP",
        depLat: -44.72,
        depLon: 169.17,
        arrLat: -38.02,
        arrLon: 177.01,
      },
    });

  beforeEach(async () => {
    flightId = (await makeFlight(userId)).id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tb-commit", "tb-commit-2"] } } });
    await prisma.$disconnect();
  });

  it("writes the trip, its flights, its timeline stop and its roadtrip stations together", async () => {
    const written = await writeCommit(fixturePlan(userId, [flightId]));

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: written.tripId } });
    expect(trip).toMatchObject({ userId, name: "Northvale loop", countries: ["NZ"] });
    expect(trip.startDay?.toISOString()).toBe("2031-05-02T00:00:00.000Z");
    expect(trip.endDay?.toISOString()).toBe("2031-05-05T00:00:00.000Z");
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: flightId } })).tripId).toBe(
      written.tripId
    );

    const stops = await prisma.tripStop.findMany({ where: { tripId: written.tripId } });
    expect(stops.map((s) => [s.title, s.orderIdx, s.routeId, s.domain, s.precision])).toEqual([
      ["Selby Bay day", 0, null, null, "day"],
    ]);

    const [roadtrip] = written.roadtrips;
    const route = await prisma.tripRoute.findUniqueOrThrow({ where: { id: roadtrip.id } });
    expect(route).toMatchObject({
      tripId: written.tripId,
      userId,
      kind: "roadtrip",
      name: "Northvale loop",
      vehicle: "car",
    });
    const stations = await prisma.tripStop.findMany({
      where: { routeId: roadtrip.id },
      orderBy: { routeOrderIdx: "asc" },
    });
    expect(stations.map((s) => [s.title, s.overnight, s.tripId])).toEqual([
      ["Northvale", true, null],
      ["Port Carrow", true, null],
      ["Selby Bay", false, null],
    ]);
    const legs = await prisma.tripRouteLeg.findMany({
      where: { routeId: roadtrip.id },
      orderBy: { fromStop: { routeOrderIdx: "asc" } },
    });
    expect(legs.map((l) => [l.mode, l.source])).toEqual([
      ["road", "straight"],
      ["ferry", "straight"],
    ]);

    expect(written).toMatchObject({
      created: true,
      flightsAssigned: 1,
      flightsMovedFrom: [],
      stopIds: [stops[0].id],
    });
    expect(roadtrip).toMatchObject({
      name: "Northvale loop",
      stations: 3,
      nights: 3,
      ferryLegs: 1,
    });
    expect(roadtrip.createdLegs).toHaveLength(2);
  });

  it("is all or nothing: a failing station write leaves no trip, route, stop or filed flight", async () => {
    jest
      .spyOn(replaceModule, "replaceStationsInTx")
      .mockRejectedValueOnce(new Error("station write failed"));

    await expect(writeCommit(fixturePlan(userId, [flightId]))).rejects.toThrow(
      "station write failed"
    );

    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
    expect(await prisma.tripRoute.count({ where: { userId } })).toBe(0);
    expect(await prisma.tripStop.count({ where: { trip: { userId } } })).toBe(0);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: flightId } })).tripId).toBeNull();
  });

  it("files only the caller's own flights", async () => {
    const theirs = await makeFlight(strangerId);
    const written = await writeCommit(fixturePlan(userId, [flightId, theirs.id]));
    expect(written.flightsAssigned).toBe(1);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: theirs.id } })).tripId).toBeNull();
  });
});
