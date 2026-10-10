jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(),
}));

import { prisma } from "../../../db";
import { setClockForTests } from "../../../shared/time/clock";
import { hashPassword } from "../../../utils/password";
import * as autoRouteModule from "../../tour/routing/autoRouteLegs";
import { resolveRouteProvider } from "../../tour/routing/resolveProvider";
import type { RouteRequest } from "../../tour/routing/types";
import { resolvePhotoJourneys, routeCommittedLegs, writeCommit } from "../commit";
import type { PhaseBResult } from "../types";
import { fixturePlan } from "./commitFixtures";

const mockProvider = resolveRouteProvider as jest.Mock;

/** Answers every request with a bent road anchored at the leg's own ends. */
const bentRoad = jest.fn(async ({ from, to }: RouteRequest) => ({
  waypoints: [
    [from.lon, from.lat],
    [(from.lon + to.lon) / 2 + 0.05, (from.lat + to.lat) / 2],
    [to.lon, to.lat],
  ] as Array<[number, number]>,
  distanceKm: 70,
  drivingMinutes: 90,
}));

const STRANGER_FINDING_OWNER = "tb-phasec-2";

describe("phase C", () => {
  let userId: string;
  let strangerId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tb-phasec", STRANGER_FINDING_OWNER] } },
    });
    const make = async (username: string) =>
      prisma.user.create({ data: { username, passwordHash: await hashPassword("password123") } });
    userId = (await make("tb-phasec")).id;
    strangerId = (await make(STRANGER_FINDING_OWNER)).id;
  });

  beforeEach(() => {
    bentRoad.mockClear();
    mockProvider.mockResolvedValue({ id: "custom", route: bentRoad });
  });

  afterEach(async () => {
    setClockForTests(null);
    await prisma.photoJourney.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  describe("routeCommittedLegs", () => {
    it("routes the road leg along the road and leaves the ferry leg a ferry", async () => {
      const written = await writeCommit(fixturePlan(userId));

      expect(await routeCommittedLegs(userId, written)).toEqual({
        routed: 1,
        straight: 0,
        ferry: 1,
        providerAvailable: true,
      });
      expect(bentRoad).toHaveBeenCalledTimes(1);
      const legs = await prisma.tripRouteLeg.findMany({
        where: { routeId: written.roadtrips[0].id },
        orderBy: { fromStop: { routeOrderIdx: "asc" } },
      });
      expect(legs.map((l) => [l.mode, l.source])).toEqual([
        ["road", "routed"],
        ["ferry", "straight"],
      ]);
    });

    it("leaves every leg straight, and says so, when the instance has no router", async () => {
      mockProvider.mockResolvedValue(null);
      const written = await writeCommit(fixturePlan(userId));

      expect(await routeCommittedLegs(userId, written)).toEqual({
        routed: 0,
        straight: 1,
        ferry: 1,
        providerAvailable: false,
      });
      expect(bentRoad).not.toHaveBeenCalled();
    });

    it("routes in chunks of 25 legs", async () => {
      const spy = jest.spyOn(autoRouteModule, "autoRouteNewLegs").mockResolvedValue(0);
      const createdLegs = Array.from({ length: 60 }, (_, i) => ({
        fromStopId: `f${i}`,
        toStopId: `t${i}`,
      }));
      const written: PhaseBResult = {
        tripId: "t",
        created: true,
        roadtrips: [{ id: "r1", name: "n", stations: 61, nights: 0, createdLegs, ferryLegs: 0 }],
        stopIds: [],
        flightsAssigned: 0,
        flightsMovedFrom: [],
      };

      const routing = await routeCommittedLegs(userId, written);

      expect(spy.mock.calls.map((call) => call[2].length)).toEqual([25, 25, 10]);
      expect(routing).toEqual({ routed: 0, straight: 60, ferry: 0, providerAvailable: true });
      spy.mockRestore();
    });

    it("stops starting chunks once the two-minute budget is spent", async () => {
      let nowMs = Date.parse("2031-05-20T08:00:00Z");
      setClockForTests(() => new Date(nowMs));
      const spy = jest.spyOn(autoRouteModule, "autoRouteNewLegs").mockImplementation(async () => {
        nowMs += 121_000;
        return 3;
      });
      const createdLegs = Array.from({ length: 60 }, (_, i) => ({
        fromStopId: `f${i}`,
        toStopId: `t${i}`,
      }));
      const written: PhaseBResult = {
        tripId: "t",
        created: true,
        roadtrips: [{ id: "r1", name: "n", stations: 61, nights: 0, createdLegs, ferryLegs: 0 }],
        stopIds: [],
        flightsAssigned: 0,
        flightsMovedFrom: [],
      };

      const routing = await routeCommittedLegs(userId, written);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(routing).toEqual({ routed: 3, straight: 57, ferry: 0, providerAvailable: true });
      spy.mockRestore();
    });
  });

  describe("resolvePhotoJourneys", () => {
    const WINDOW = { startDay: "2031-05-02", endDay: "2031-05-06" };
    const finding = (owner: string, fingerprint: string, over: Record<string, unknown> = {}) =>
      prisma.photoJourney.create({
        data: {
          userId: owner,
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

    it("marks the ticked findings inside the window as accepted by the new trip", async () => {
      setClockForTests("2031-05-20T08:30:00Z");
      const trip = await prisma.trip.create({ data: { userId, name: "Northvale loop" } });
      const inside = await finding(userId, "fp-in");
      const outside = await finding(userId, "fp-out", {
        startDate: new Date("2031-06-01T08:00:00.000Z"),
        endDate: new Date("2031-06-02T08:00:00.000Z"),
      });
      const dismissed = await finding(userId, "fp-done", { status: "dismissed" });
      const theirs = await finding(strangerId, "fp-theirs");

      const count = await resolvePhotoJourneys(
        userId,
        trip.id,
        [inside.id, outside.id, dismissed.id, theirs.id],
        WINDOW
      );

      expect(count).toBe(1);
      const row = await prisma.photoJourney.findUniqueOrThrow({ where: { id: inside.id } });
      expect(row).toMatchObject({ status: "accepted", createdTripId: trip.id });
      expect(row.resolvedAt?.toISOString()).toBe("2031-05-20T08:30:00.000Z");
      for (const untouched of [outside, dismissed, theirs]) {
        const other = await prisma.photoJourney.findUniqueOrThrow({ where: { id: untouched.id } });
        expect(other.createdTripId).toBeNull();
      }
    });

    it("does nothing without ticked findings", async () => {
      expect(await resolvePhotoJourneys(userId, "any", [], WINDOW)).toBe(0);
    });
  });
});
