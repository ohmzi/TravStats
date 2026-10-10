import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { writeCommit } from "../commit";
import { fixturePlan } from "./commitFixtures";

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

describe("writeCommit, existing trip", () => {
  let userId: string;
  let tripId: string;
  let oldTripId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-commit-existing" } });
    userId = (
      await prisma.user.create({
        data: { username: "tb-commit-existing", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  beforeEach(async () => {
    tripId = (
      await prisma.trip.create({
        data: {
          userId,
          name: "Spring trip",
          startDate: day("2031-05-03"),
          endDate: day("2031-05-04"),
          startDay: day("2031-05-03"),
          endDay: day("2031-05-04"),
          countries: ["AU"],
        },
      })
    ).id;
    await prisma.tripStop.create({
      data: { tripId, title: "Hand-made stop", lat: -45.0, lon: 168.6, orderIdx: 0 },
    });
    oldTripId = (await prisma.trip.create({ data: { userId, name: "Old trip" } })).id;
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          tripId: oldTripId,
          flightNumber: "ZZ101",
          depLat: -44.72,
          depLon: 169.17,
          arrLat: -38.02,
          arrLon: 177.01,
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const existing = (applyWindow: boolean) => ({
    kind: "existing" as const,
    tripId,
    tripName: "Spring trip",
    applyWindow,
    countries: ["AU", "NZ"],
  });

  it("moves the trip's days to the window, unions its countries and adds to what it already holds", async () => {
    const written = await writeCommit(fixturePlan(userId, [flightId], existing(true)));

    expect(written).toMatchObject({
      tripId,
      created: false,
      flightsAssigned: 1,
      flightsMovedFrom: [{ tripId: oldTripId, name: "Old trip" }],
    });
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.startDate?.toISOString()).toBe("2031-05-02T00:00:00.000Z");
    expect(trip.endDate?.toISOString()).toBe("2031-05-05T00:00:00.000Z");
    expect(trip.startDay?.toISOString()).toBe("2031-05-02T00:00:00.000Z");
    expect(trip.endDay?.toISOString()).toBe("2031-05-05T00:00:00.000Z");
    expect(trip.countries).toEqual(["AU", "NZ"]);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: flightId } })).tripId).toBe(
      tripId
    );

    const stops = await prisma.tripStop.findMany({
      where: { tripId },
      orderBy: { orderIdx: "asc" },
    });
    expect(stops.map((s) => [s.title, s.orderIdx])).toEqual([
      ["Hand-made stop", 0],
      ["Selby Bay day", 1],
    ]);
    expect(await prisma.tripRoute.count({ where: { tripId, kind: "roadtrip" } })).toBe(1);
  });

  it("leaves the trip's own days alone unless asked to apply the window", async () => {
    await writeCommit(fixturePlan(userId, [], existing(false)));
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.startDate?.toISOString()).toBe("2031-05-03T00:00:00.000Z");
    expect(trip.endDay?.toISOString()).toBe("2031-05-04T00:00:00.000Z");
    expect(trip.countries).toEqual(["AU", "NZ"]);
  });

  it("keeps the flights it was not asked to move where they are", async () => {
    await writeCommit(fixturePlan(userId, [], existing(true)));
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: flightId } })).tripId).toBe(
      oldTripId
    );
  });
});
