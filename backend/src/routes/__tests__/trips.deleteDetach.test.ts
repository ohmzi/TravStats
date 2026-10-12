import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * §J of the trip-builder spec (2026-10-09, "Risks …: Deletion"): deleting a
 * journey detaches its trips — they are a domain of their own, like a flight
 * or a cruise — and NEVER deletes the album in Immich. The detach itself is
 * pinned in `roadtrips.test.ts`; what this file pins is the half no row can
 * show: the delete path must not reach for an Immich client at all, so a
 * future "clean up the album too" line fails here first.
 */
const immichClientCalls: unknown[][] = [];
jest.mock("../../services/immich/immichClient", () => {
  const actual = jest.requireActual<typeof import("../../services/immich/immichClient")>(
    "../../services/immich/immichClient"
  );
  return {
    ...actual,
    createImmichClient: (...args: unknown[]) => {
      immichClientCalls.push(args);
      return {};
    },
  };
});

describe("deleting a journey", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "journeydetach" } });
    const user = await prisma.user.create({
      data: { username: "journeydetach", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "journeydetach" } });
    await prisma.$disconnect();
  });

  it("detaches its trips, keeps their borrowed stations, and never touches Immich", async () => {
    immichClientCalls.length = 0;
    const journey = await prisma.trip.create({ data: { userId, name: "Northvale run" } });
    const roadtrip = await prisma.tripRoute.create({
      data: { userId, tripId: journey.id, name: "Dunholme loop", mode: "road", kind: "roadtrip" },
    });
    // A station borrowed from the journey's timeline: it must survive detached,
    // not go with the journey (routes/trips.ts releases it before the delete).
    const borrowed = await prisma.tripStop.create({
      data: {
        tripId: journey.id,
        title: "Dunholme",
        lat: 58,
        lon: 6,
        routeId: roadtrip.id,
        routeOrderIdx: 0,
      },
    });
    // The album the builder created and linked: the LINK ROW is the journey's
    // own record and goes with it; the album in Immich must stay untouched.
    await prisma.tripImmichAlbum.create({
      data: {
        tripId: journey.id,
        immichAlbumId: "immich-album-1",
        albumName: "Northvale run · Dunholme",
        assetCount: 52,
        mode: "link",
      },
    });

    const res = await request(app).delete(`/api/v1/trips/${journey.id}`).set("Cookie", cookie);
    expect(res.status).toBe(204);

    const kept = await prisma.tripRoute.findUniqueOrThrow({ where: { id: roadtrip.id } });
    expect(kept).toMatchObject({ tripId: null, kind: "roadtrip" });
    const keptStop = await prisma.tripStop.findUniqueOrThrow({ where: { id: borrowed.id } });
    expect(keptStop.tripId).toBeNull();
    expect(await prisma.tripImmichAlbum.count({ where: { tripId: journey.id } })).toBe(0);

    // §J: "never deletes the Immich album" — nothing on this path may build a
    // client, and building one is the first step of any Immich write.
    expect(immichClientCalls).toEqual([]);
  });
});
