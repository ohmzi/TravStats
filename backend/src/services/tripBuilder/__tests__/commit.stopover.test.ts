import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import * as replaceModule from "../../roadtrip/replaceStations";
import { writeCommit } from "../commit";
import { fixturePlan, fixtureStopoverPlan } from "./commitFixtures";

/**
 * Phase B of the stopover roadtrips (spec 2026-10-11 §5.3, §2.2, §6): a
 * toggled stopover becomes an ordinary roadtrip — car, road, its own stations,
 * no nights — in the same transaction as the trip, and a matched one is left
 * untouched. Synthetic fixtures only (public repository).
 */
describe("writeCommit, the stopover roadtrips", () => {
  let userId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-stopover" } });
    userId = (
      await prisma.user.create({
        data: { username: "tb-stopover", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  beforeEach(async () => {
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          flightNumber: "ZZ101",
          depIata: "ZPC",
          arrIata: "ZEP",
          depLat: -44.72,
          depLon: 169.17,
          arrLat: -38.02,
          arrLon: 177.01,
        },
      })
    ).id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const stopoverTrip = () => ({
    ...fixturePlan(userId, [flightId]),
    stopovers: [fixtureStopoverPlan()],
  });

  it("writes the stopover as an ordinary roadtrip — car, road, its stations, no nights", async () => {
    const written = await writeCommit(stopoverTrip());

    const routes = await prisma.tripRoute.findMany({
      where: { tripId: written.tripId },
      orderBy: { orderIdx: "asc" },
    });
    expect(routes.map((route) => [route.name, route.orderIdx])).toEqual([
      ["Northvale loop", 0],
      ["Northvale loop · Port Carrow", 1],
    ]);
    const stopover = routes[1];
    expect(stopover).toMatchObject({
      kind: "roadtrip",
      mode: "road",
      vehicle: "car",
      userId,
    });

    const stations = await prisma.tripStop.findMany({
      where: { routeId: stopover.id },
      orderBy: { routeOrderIdx: "asc" },
    });
    expect(
      stations.map((s) => [s.title, s.overnight, s.lodgingStayId, s.viaPoint, s.tripId, s.domain])
    ).toEqual([
      ["ZPC airport", false, null, false, null, "roadtrip"],
      ["Port Carrow", false, null, false, null, "roadtrip"],
    ]);
    expect(await prisma.tripRouteLeg.count({ where: { routeId: stopover.id, mode: "road" } })).toBe(
      1
    );

    expect(written.roadtrips.map((r) => [r.name, r.stations, r.nights])).toEqual([
      ["Northvale loop", 3, 3],
      ["Northvale loop · Port Carrow", 2, 0],
    ]);
  });

  it("leaves the areas and the timeline stops exactly as they were", async () => {
    const written = await writeCommit(stopoverTrip());

    expect(written.stopIds).toHaveLength(1);
    const timeline = await prisma.tripStop.findMany({
      where: { tripId: written.tripId, routeId: null },
    });
    expect(timeline.map((s) => s.title)).toEqual(["Selby Bay day"]);
    const area = await prisma.tripRoute.findFirstOrThrow({
      where: { tripId: written.tripId, name: "Northvale loop" },
    });
    expect(await prisma.tripStop.count({ where: { routeId: area.id } })).toBe(3);
    expect(await prisma.tripRoute.count({ where: { userId } })).toBe(2);
  });

  it("writes no roadtrip for a stopover a re-sync already matched (spec §6, add-only)", async () => {
    const written = await writeCommit({
      ...fixturePlan(userId, [flightId]),
      stopovers: [fixtureStopoverPlan({ roadtripId: "9d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60" })],
    });

    expect(
      await prisma.tripRoute.count({
        where: { tripId: written.tripId, name: "Northvale loop · Port Carrow" },
      })
    ).toBe(0);
    expect(written.roadtrips.map((r) => r.name)).toEqual(["Northvale loop"]);
  });

  it("is one transaction: a failing stopover write leaves no trip at all", async () => {
    const real = replaceModule.replaceStationsInTx;
    jest
      .spyOn(replaceModule, "replaceStationsInTx")
      .mockImplementationOnce(real)
      .mockRejectedValueOnce(new Error("stopover station write failed"));

    await expect(writeCommit(stopoverTrip())).rejects.toThrow("stopover station write failed");

    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
    expect(await prisma.tripRoute.count({ where: { userId } })).toBe(0);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: flightId } })).tripId).toBeNull();
  });
});
