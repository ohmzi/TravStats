import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A trip's rename reaches the sections still named after it: the one named
 * exactly like the trip, and every "<trip> · <city>" the photo trip builder
 * gives a trip's several roadtrips (spec 2026-10-09 §D1b). Synthetic names only.
 */
const USERNAME = "trip-rename-sections";

describe("PATCH /api/v1/trips/:id renames the trip's sections with it", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  async function tripWithSections(tripName: string, sectionNames: string[]): Promise<string> {
    const trip = await prisma.trip.create({ data: { userId, name: tripName } });
    for (const [orderIdx, name] of sectionNames.entries()) {
      await prisma.tripRoute.create({
        data: { userId, tripId: trip.id, name, kind: "roadtrip", mode: "road", orderIdx },
      });
    }
    return trip.id;
  }

  async function sectionNames(tripId: string): Promise<string[]> {
    const sections = await prisma.tripRoute.findMany({
      where: { tripId },
      orderBy: { orderIdx: "asc" },
      select: { name: true },
    });
    return sections.map((section) => section.name);
  }

  const rename = (tripId: string, name: string) =>
    request(app).patch(`/api/v1/trips/${tripId}`).set("Cookie", cookie).send({ name });

  it("renames the section named like the trip and every '<trip> · <city>' one", async () => {
    const tripId = await tripWithSections("Northvale loop", [
      "Northvale loop",
      "Northvale loop · Port Carrow",
      "Northvale loop · Kelmore, Westshire",
      "Coastal detour",
      "Northvale loop extra",
      "Northvale loop·Port Carrow",
    ]);

    const res = await rename(tripId, "Westshire circuit");

    expect(res.status).toBe(200);
    expect(await sectionNames(tripId)).toEqual([
      "Westshire circuit",
      "Westshire circuit · Port Carrow",
      "Westshire circuit · Kelmore, Westshire",
      "Coastal detour",
      "Northvale loop extra",
      "Northvale loop·Port Carrow",
    ]);
  });

  it("leaves another trip's sections alone, even when the trips share a name", async () => {
    const otherId = await tripWithSections("Northvale loop", ["Northvale loop · Port Carrow"]);
    const tripId = await tripWithSections("Northvale loop", ["Northvale loop · Kelmore"]);

    await rename(tripId, "Westshire circuit").expect(200);

    expect(await sectionNames(tripId)).toEqual(["Westshire circuit · Kelmore"]);
    expect(await sectionNames(otherId)).toEqual(["Northvale loop · Port Carrow"]);
  });

  it("reads the old name literally, wildcard characters included", async () => {
    const tripId = await tripWithSections("100% Northvale_loop", [
      "100% Northvale_loop · Port Carrow",
      "100X NorthvaleXloop · Kelmore",
    ]);

    await rename(tripId, "Westshire circuit").expect(200);

    expect(await sectionNames(tripId)).toEqual([
      "Westshire circuit · Port Carrow",
      "100X NorthvaleXloop · Kelmore",
    ]);
  });

  it("renames each section once when the new name starts with the old one and the separator", async () => {
    const tripId = await tripWithSections("Northvale loop", [
      "Northvale loop",
      "Northvale loop · Port Carrow",
    ]);

    await rename(tripId, "Northvale loop · Westshire").expect(200);

    expect(await sectionNames(tripId)).toEqual([
      "Northvale loop · Westshire",
      "Northvale loop · Westshire · Port Carrow",
    ]);
  });
});
