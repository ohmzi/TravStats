import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { insertRoadtrip } from "../createRoadtrip";

/**
 * `insertRoadtrip` is what `POST /roadtrips` and the photo trip builder's
 * commit both create a roadtrip with, inside a transaction the caller owns
 * (spec 2026-10-09 §D2). Synthetic fixtures only (public repository).
 */
const USERNAME = "insert-roadtrip-service";

describe("insertRoadtrip", () => {
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Northvale loop" } })).id;
  });

  beforeEach(async () => {
    await prisma.tripRoute.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it("files the roadtrip on its trip after the trip's last section", async () => {
    await prisma.tripRoute.create({
      data: { userId, tripId, name: "Harbour walk", mode: "foot", kind: "tour", orderIdx: 4 },
    });

    const row = await prisma.$transaction((tx) =>
      insertRoadtrip(tx, userId, {
        tripId,
        name: "Northvale loop · Port Carrow",
        mode: "road",
        vehicle: "car",
      })
    );

    expect(row).toMatchObject({
      userId,
      tripId,
      kind: "roadtrip",
      name: "Northvale loop · Port Carrow",
      mode: "road",
      vehicle: "car",
      vehicleName: null,
      orderIdx: 5,
      legs: [],
      _count: { stops: 0 },
    });
  });

  it("places a standalone roadtrip among the standalone sections only", async () => {
    await prisma.tripRoute.create({
      data: { userId, tripId, name: "Harbour walk", mode: "foot", kind: "tour", orderIdx: 7 },
    });

    const row = await prisma.$transaction((tx) =>
      insertRoadtrip(tx, userId, { tripId: null, name: "Kelmore run", mode: "road" })
    );

    expect(row).toMatchObject({ tripId: null, orderIdx: 0, vehicle: null });
  });

  it("leaves nothing behind when the surrounding transaction rolls back", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await insertRoadtrip(tx, userId, { tripId, name: "Northvale loop", mode: "road" });
        throw new Error("a later write of the same commit failed");
      })
    ).rejects.toThrow("a later write of the same commit failed");

    expect(await prisma.tripRoute.count({ where: { userId } })).toBe(0);
  });
});
