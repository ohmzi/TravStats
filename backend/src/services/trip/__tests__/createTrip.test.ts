import { prisma } from "../../../db";
import { createTripSchema, TRIP_COLORS } from "../../../schemas/trip";
import { hashPassword } from "../../../utils/password";
import { createTripRecord, insertTrip, prepareTripCreate } from "../createTrip";

/**
 * Trip creation lives in one service, so `POST /trips` and the photo trip
 * builder's commit derive a new trip the same way and the builder can write it
 * inside the transaction that also writes its roadtrips (spec 2026-10-09 §D1).
 * Synthetic fixtures only (public repository).
 */
const USERNAME = "create-trip-service";

describe("services/trip/createTrip", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it("creates a trip with its typed days, its own-dates status and its companions in order", async () => {
    const trip = await createTripRecord(
      userId,
      createTripSchema.parse({
        name: "Northvale loop",
        startDate: "2031-05-02",
        endDate: "2031-05-09",
        companions: ["Ari", "Bex"],
        summary: "A week along the Westshire coast.",
        originLabel: "Kelmore, Westshire",
      })
    );

    expect(trip).toMatchObject({
      userId,
      name: "Northvale loop",
      color: TRIP_COLORS[0],
      status: "planned",
      startZone: null,
      endZone: null,
      companions: ["Ari", "Bex"],
      summarySource: "user",
      originLabel: "Kelmore, Westshire",
    });
    expect(trip.startDay?.toISOString()).toBe("2031-05-02T00:00:00.000Z");
    expect(trip.endDay?.toISOString()).toBe("2031-05-09T00:00:00.000Z");
    const links = await prisma.tripCompanion.findMany({
      where: { tripId: trip.id },
      orderBy: { position: "asc" },
      include: { companion: true },
    });
    expect(links.map((link) => link.companion.displayName)).toEqual(["Ari", "Bex"]);
  });

  it("gives the user's next trip the next palette colour", async () => {
    await createTripRecord(userId, createTripSchema.parse({ name: "Northvale loop" }));

    const second = await createTripRecord(
      userId,
      createTripSchema.parse({ name: "Port Carrow weekend" })
    );

    expect(second.color).toBe(TRIP_COLORS[1]);
  });

  it("writes no trip before the insert, and none when the surrounding transaction rolls back", async () => {
    const prepared = await prepareTripCreate(
      userId,
      createTripSchema.parse({ name: "Port Carrow weekend", companions: ["Cato"] })
    );
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);

    await expect(
      prisma.$transaction(async (tx) => {
        await insertTrip(tx, prepared);
        throw new Error("a later write of the same commit failed");
      })
    ).rejects.toThrow("a later write of the same commit failed");

    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
    // Find-or-create: the companion outlives the rollback and the next attempt reuses it.
    expect(await prisma.companion.count({ where: { userId, displayName: "Cato" } })).toBe(1);
  });
});
