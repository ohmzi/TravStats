// The gate logs a warning when it cannot verify a key; keep it out of the test output.
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import logger from "../../../utils/logger";
import { ImmichError } from "../../immich/types";
import {
  albumGateOf,
  linkedTripNameOf,
  loadTargetTrip,
  overlappingTripsOf,
  pendingJourneysOf,
} from "../builderQueries";

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const WINDOW = { startDay: "2031-05-02", endDay: "2031-05-06" };

describe("builder queries", () => {
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tb-queries", "tb-queries-other"] } },
    });
    userId = (
      await prisma.user.create({
        data: { username: "tb-queries", passwordHash: await hashPassword("password123") },
      })
    ).id;
    otherUserId = (
      await prisma.user.create({
        data: { username: "tb-queries-other", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.photoJourney.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  const makeTrip = (owner: string, name: string, start: string, end: string) =>
    prisma.trip.create({
      data: {
        userId: owner,
        name,
        startDate: day(start),
        endDate: day(end),
        startDay: day(start),
        endDay: day(end),
        countries: ["AU"],
      },
    });

  describe("loadTargetTrip", () => {
    it("is null when the scan targets a new trip", async () => {
      expect(await loadTargetTrip(userId, null)).toBeNull();
    });

    it("reads the trip's name, countries and roadtrip names", async () => {
      const trip = await makeTrip(userId, "Spring trip", "2031-05-02", "2031-05-06");
      await prisma.tripRoute.create({
        data: { userId, tripId: trip.id, name: "Spring trip", mode: "road", kind: "roadtrip" },
      });
      await prisma.tripRoute.create({
        data: { userId, tripId: trip.id, name: "Day tour", mode: "foot", kind: "tour" },
      });

      expect(await loadTargetTrip(userId, trip.id)).toEqual({
        id: trip.id,
        name: "Spring trip",
        countries: ["AU"],
        roadtripNames: ["Spring trip"],
      });
    });

    it("answers 404 for a trip that is not the caller's", async () => {
      const foreign = await makeTrip(otherUserId, "Their trip", "2031-05-02", "2031-05-06");
      await expect(loadTargetTrip(userId, foreign.id)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  it("lists the caller's overlapping trips, never the target, a stranger's or a disjoint one", async () => {
    const inside = await makeTrip(userId, "Inside", "2031-05-04", "2031-05-05");
    const target = await makeTrip(userId, "Target", "2031-05-01", "2031-05-09");
    await makeTrip(userId, "Later", "2031-08-01", "2031-08-09");
    await makeTrip(otherUserId, "Stranger", "2031-05-03", "2031-05-04");

    expect(await overlappingTripsOf(userId, WINDOW, target.id)).toEqual([
      { id: inside.id, name: "Inside", startDay: "2031-05-04", endDay: "2031-05-05" },
    ]);
  });

  it("offers pending trip findings inside the window, ticked, with their local days", async () => {
    const finding = (fingerprint: string, over: Record<string, unknown> = {}) =>
      prisma.photoJourney.create({
        data: {
          userId,
          kind: "trip",
          status: "pending",
          startDate: new Date("2031-05-02T08:00:00.000Z"),
          endDate: new Date("2031-05-03T20:00:00.000Z"),
          photoCount: 12,
          locatedCount: 10,
          lat: -45.05,
          lon: 168.7,
          previewAssetIds: [],
          fingerprint,
          ...over,
        },
      });
    const inWindow = await finding("fp-in");
    await finding("fp-accepted", { status: "accepted" });
    await finding("fp-place", { kind: "place" });
    await finding("fp-late", {
      startDate: new Date("2031-06-01T08:00:00.000Z"),
      endDate: new Date("2031-06-02T08:00:00.000Z"),
    });

    expect(await pendingJourneysOf(userId, WINDOW)).toEqual([
      { id: inWindow.id, startDay: "2031-05-02", endDay: "2031-05-04", defaultTick: true },
    ]);
  });

  describe("linkedTripNameOf", () => {
    it("names the other trip an album is linked to, and not the target itself", async () => {
      const other = await makeTrip(userId, "Rented cabin", "2031-05-02", "2031-05-06");
      await prisma.tripImmichAlbum.create({
        data: { tripId: other.id, immichAlbumId: "album-1", albumName: "Cabin", assetCount: 4 },
      });

      expect(await linkedTripNameOf(userId, "album-1", null)).toBe("Rented cabin");
      expect(await linkedTripNameOf(userId, "album-1", other.id)).toBeNull();
      expect(await linkedTripNameOf(userId, "album-2", null)).toBeNull();
    });
  });

  describe("albumGateOf", () => {
    const userConn = { baseUrl: "http://immich.test", apiKey: "k", source: "user" as const };
    const sharedConn = { ...userConn, source: "global" as const };
    const keyed = (permissions: string[]) => ({ getMyApiKey: async () => ({ permissions }) });

    it("refuses an album on a shared connection without asking Immich", async () => {
      const client = { getMyApiKey: jest.fn() };
      expect(await albumGateOf(sharedConn, client)).toEqual({
        allowed: false,
        blockedReason: "sharedConnection",
        missingScopes: [],
      });
      expect(client.getMyApiKey).not.toHaveBeenCalled();
    });

    it("allows an unverifiable key and says so", async () => {
      expect(await albumGateOf(userConn, { getMyApiKey: async () => null })).toEqual({
        allowed: true,
        blockedReason: "unverified",
        missingScopes: [],
      });
      expect(
        await albumGateOf(userConn, {
          getMyApiKey: async () => {
            throw new Error("timeout");
          },
        })
      ).toMatchObject({ allowed: true, blockedReason: "unverified" });
    });

    it("logs why a key could not be verified, with the error kind and no detail", async () => {
      const warn = jest.mocked(logger.warn);
      warn.mockClear();

      await albumGateOf(userConn, {
        getMyApiKey: async () => {
          throw new ImmichError("unreachable", "Immich is unreachable at http://immich.test");
        },
      });
      await albumGateOf(userConn, {
        getMyApiKey: async () => {
          throw new Error("timeout");
        },
      });
      await albumGateOf(userConn, { getMyApiKey: async () => null });

      expect(warn.mock.calls).toEqual([
        [{ message: "immich_capability_check_failed", context: { kind: "unreachable" } }],
        [{ message: "immich_capability_check_failed", context: { kind: "unexpected" } }],
      ]);
    });

    it("does not call a rejected key unverified: a 401 propagates", async () => {
      const rejected = new ImmichError("auth", "Immich rejected the API key", 401);

      await expect(
        albumGateOf(userConn, {
          getMyApiKey: async () => {
            throw rejected;
          },
        })
      ).rejects.toBe(rejected);
    });

    it("lists the album scopes a key lacks", async () => {
      expect(await albumGateOf(userConn, keyed(["album.read"]))).toEqual({
        allowed: false,
        blockedReason: "missingScopes",
        missingScopes: ["album.create", "albumAsset.create"],
      });
    });

    it("allows a key with every album scope, or the all-scope key", async () => {
      const gate = { allowed: true, missingScopes: [] };
      expect(
        await albumGateOf(userConn, keyed(["album.read", "album.create", "albumAsset.create"]))
      ).toEqual(gate);
      expect(await albumGateOf(userConn, keyed(["all"]))).toEqual(gate);
    });
  });
});
