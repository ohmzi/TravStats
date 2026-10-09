jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(() => ({ configured: true, providerId: "custom" })),
}));

import { prisma } from "../../../db";
import { stationsSchema } from "../../../schemas/roadtrip";
import { hashPassword } from "../../../utils/password";
import { autoRouteNewLegs } from "../../tour/routing/autoRouteLegs";
import { resolveRouteProvider } from "../../tour/routing/resolveProvider";
import type { RouteProvider, RouteRequest } from "../../tour/routing/types";
import { insertRoadtrip } from "../createRoadtrip";
import { replaceStations, replaceStationsInTx } from "../replaceStations";

const mockResolveProvider = resolveRouteProvider as jest.Mock<Promise<RouteProvider | null>>;

/**
 * The photo trip builder writes a roadtrip's stations AND its ferry legs in
 * one transaction, then routes what it created (spec 2026-10-09 §D3). A ferry
 * must be marked before the routing pass, or the pass drives it along a road.
 * The router is a fake at the module boundary; synthetic places only.
 */
const USERNAME = "replace-stations-leg-modes";
const NORTHVALE = { title: "Northvale", lat: -45.05, lon: 168.7 };
const PORT_CARROW = { title: "Port Carrow", lat: -44.7, lon: 169.15 };
const KELMORE = { title: "Kelmore", lat: -44.4, lon: 168.9 };

/** A road anchored at the leg's own ends, bent so it is not the chord. */
const road = jest.fn(async ({ from, to }: RouteRequest) => ({
  waypoints: [
    [from.lon, from.lat],
    [(from.lon + to.lon) / 2 + 0.05, (from.lat + to.lat) / 2],
    [to.lon, to.lat],
  ] as Array<[number, number]>,
  distanceKm: 80,
  drivingMinutes: 70,
}));

const passStations = (...places: Array<typeof NORTHVALE>) =>
  stationsSchema.parse({ stations: places.map((p) => ({ ...p, night: { kind: "pass" } })) })
    .stations;

describe("replaceStationsInTx leg modes", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveProvider.mockResolvedValue({ id: "custom", route: road });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  async function newRoadtrip(): Promise<string> {
    const row = await prisma.$transaction((tx) =>
      insertRoadtrip(tx, userId, { tripId: null, name: "Northvale loop", mode: "road" })
    );
    return row.id;
  }

  async function storedLegs(routeId: string) {
    return prisma.tripRouteLeg.findMany({
      where: { routeId },
      orderBy: { fromStop: { routeOrderIdx: "asc" } },
      select: { mode: true, source: true },
    });
  }

  it("writes a ferry onto the leg it joins and leaves the other legs on the route's mode", async () => {
    const routeId = await newRoadtrip();

    const { createdLegs } = await prisma.$transaction((tx) =>
      replaceStationsInTx(tx, userId, routeId, passStations(NORTHVALE, PORT_CARROW, KELMORE), {
        legModes: ["ferry", undefined],
      })
    );

    expect(createdLegs).toHaveLength(2);
    expect(await storedLegs(routeId)).toEqual([
      { mode: "ferry", source: "straight" },
      { mode: "road", source: "straight" },
    ]);
    expect(road).not.toHaveBeenCalled();
  });

  it("routes the road legs it created after the commit, and never the ferry", async () => {
    const routeId = await newRoadtrip();
    const { createdLegs } = await prisma.$transaction((tx) =>
      replaceStationsInTx(tx, userId, routeId, passStations(NORTHVALE, PORT_CARROW, KELMORE), {
        legModes: ["ferry", "road"],
      })
    );

    expect(await autoRouteNewLegs(userId, routeId, createdLegs)).toBe(1);

    expect(road).toHaveBeenCalledTimes(1);
    expect(road.mock.calls[0][0]).toMatchObject({
      from: { lat: PORT_CARROW.lat, lon: PORT_CARROW.lon },
      to: { lat: KELMORE.lat, lon: KELMORE.lon },
      mode: "road",
    });
    expect(await storedLegs(routeId)).toEqual([
      { mode: "ferry", source: "straight" },
      { mode: "road", source: "routed" },
    ]);
  });

  it("refuses more leg modes than the list has legs, and writes no station", async () => {
    const routeId = await newRoadtrip();

    await expect(
      prisma.$transaction((tx) =>
        replaceStationsInTx(tx, userId, routeId, passStations(NORTHVALE, PORT_CARROW), {
          legModes: ["road", "ferry"],
        })
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await prisma.tripStop.count({ where: { routeId } })).toBe(0);
  });

  it("rolls the stations and legs back with the surrounding transaction", async () => {
    const routeId = await newRoadtrip();

    await expect(
      prisma.$transaction(async (tx) => {
        await replaceStationsInTx(tx, userId, routeId, passStations(NORTHVALE, PORT_CARROW), {
          legModes: ["ferry"],
        });
        throw new Error("a later write of the same commit failed");
      })
    ).rejects.toThrow("a later write of the same commit failed");

    expect(await prisma.tripStop.count({ where: { routeId } })).toBe(0);
    expect(await prisma.tripRouteLeg.count({ where: { routeId } })).toBe(0);
  });

  it("keeps the public writer's answer: the route, its routed legs and the stations", async () => {
    const routeId = await newRoadtrip();

    const saved = await replaceStations(userId, routeId, passStations(NORTHVALE, PORT_CARROW));

    expect(saved.route).toMatchObject({ id: routeId, _count: { stops: 2 } });
    expect(saved.stations.map((s) => s.title)).toEqual(["Northvale", "Port Carrow"]);
    expect(saved.legs).toHaveLength(1);
    expect(saved.legs[0]).toMatchObject({ mode: "road", source: "routed", distanceKm: 80 });
  });
});
