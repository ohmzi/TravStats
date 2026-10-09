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
const TARN_LANDING = { title: "Tarn Landing", lat: -44.55, lon: 169.05 };

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

  /** The stations as stored, in route order, with the id each one is kept under. */
  async function storedStations(routeId: string, db: Pick<typeof prisma, "tripStop"> = prisma) {
    return db.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
      select: { id: true, title: true, routeOrderIdx: true },
    });
  }

  /** The legs as stored, in route order, with the row id a kept leg is known by. */
  async function storedLegRows(routeId: string, db: Pick<typeof prisma, "tripRouteLeg"> = prisma) {
    return db.tripRouteLeg.findMany({
      where: { routeId },
      orderBy: { fromStop: { routeOrderIdx: "asc" } },
      select: { id: true, mode: true, source: true },
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
    await replaceStations(userId, routeId, passStations(NORTHVALE, PORT_CARROW));
    const stationsBefore = await storedStations(routeId);
    const legsBefore = await storedLegRows(routeId);

    // The refusal is caught INSIDE the transaction and the transaction then
    // commits: whatever the refused call wrote would stay, so a rollback of an
    // outer transaction cannot be what keeps the stored list as it was.
    const during = await prisma.$transaction(async (tx) => {
      await expect(
        replaceStationsInTx(tx, userId, routeId, passStations(KELMORE, PORT_CARROW), {
          legModes: ["road", "ferry"],
        })
      ).rejects.toMatchObject({ statusCode: 400 });
      return {
        stations: await storedStations(routeId, tx),
        legs: await storedLegRows(routeId, tx),
      };
    });

    expect(stationsBefore.map((s) => s.title)).toEqual(["Northvale", "Port Carrow"]);
    expect(during.stations).toEqual(stationsBefore);
    expect(during.legs).toEqual(legsBefore);
    expect(await storedStations(routeId)).toEqual(stationsBefore);
    expect(await storedLegRows(routeId)).toEqual(legsBefore);
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

  /**
   * `legModes` is for the legs a write CREATES. A leg the list keeps already
   * has a mode, a routed or drawn line and costs of its own; changing its mode
   * would leave a ferry carrying a road's geometry. The builder's re-sync
   * deletes a changed leg itself, so a kept leg is never asked to change.
   */
  describe("over a roadtrip whose legs already exist", () => {
    async function routedRoadtrip(): Promise<string> {
      const routeId = await newRoadtrip();
      await replaceStations(userId, routeId, passStations(NORTHVALE, PORT_CARROW, KELMORE));
      road.mockClear();
      return routeId;
    }

    it("marks the legs a station inserted between two others creates, and keeps the untouched leg's row", async () => {
      const routeId = await routedRoadtrip();
      const [north, port, kelmore] = await storedStations(routeId);
      const [keptBefore] = await storedLegRows(routeId);
      expect(keptBefore).toMatchObject({ mode: "road", source: "routed" });
      const [n, p, t, k] = passStations(NORTHVALE, PORT_CARROW, TARN_LANDING, KELMORE);

      const { createdLegs } = await prisma.$transaction((tx) =>
        replaceStationsInTx(
          tx,
          userId,
          routeId,
          [{ ...n, id: north.id }, { ...p, id: port.id }, t, { ...k, id: kelmore.id }],
          { legModes: [undefined, "ferry", "road"] }
        )
      );

      const stations = await storedStations(routeId);
      expect(stations.map((s) => s.title)).toEqual([
        "Northvale",
        "Port Carrow",
        "Tarn Landing",
        "Kelmore",
      ]);
      expect(createdLegs).toEqual([
        { fromStopId: port.id, toStopId: stations[2].id },
        { fromStopId: stations[2].id, toStopId: kelmore.id },
      ]);
      expect(await storedLegRows(routeId)).toEqual([
        { id: keptBefore.id, mode: "road", source: "routed" },
        { id: expect.any(String), mode: "ferry", source: "straight" },
        { id: expect.any(String), mode: "road", source: "straight" },
      ]);

      // Only the road leg it created is routed; the ferry stays a crossing.
      expect(await autoRouteNewLegs(userId, routeId, createdLegs)).toBe(1);
      expect(road).toHaveBeenCalledTimes(1);
      expect(await storedLegRows(routeId)).toEqual([
        { id: keptBefore.id, mode: "road", source: "routed" },
        { id: expect.any(String), mode: "ferry", source: "straight" },
        { id: expect.any(String), mode: "road", source: "routed" },
      ]);
    });

    it("refuses a different mode for a leg the write keeps, and writes nothing", async () => {
      const routeId = await routedRoadtrip();
      const stationsBefore = await storedStations(routeId);
      const legsBefore = await storedLegRows(routeId);
      const [n, p, k] = passStations(NORTHVALE, PORT_CARROW, KELMORE);
      // Renamed, so a write that got as far as the stations would show.
      const renamed = [
        { ...n, id: stationsBefore[0].id },
        { ...p, id: stationsBefore[1].id, title: "Port Carrow Landing" },
        { ...k, id: stationsBefore[2].id },
      ];

      await expect(
        prisma.$transaction((tx) =>
          replaceStationsInTx(tx, userId, routeId, renamed, { legModes: ["ferry", undefined] })
        )
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Leg modes apply only to legs this write creates",
      });

      expect(await storedStations(routeId)).toEqual(stationsBefore);
      expect(await storedLegRows(routeId)).toEqual(legsBefore);
    });

    it("accepts the mode a kept leg already has, and touches nothing", async () => {
      const routeId = await newRoadtrip();
      await prisma.$transaction((tx) =>
        replaceStationsInTx(tx, userId, routeId, passStations(NORTHVALE, PORT_CARROW, KELMORE), {
          legModes: ["ferry", undefined],
        })
      );
      const stations = await storedStations(routeId);
      const legsBefore = await storedLegRows(routeId);
      const [n, p, k] = passStations(NORTHVALE, PORT_CARROW, KELMORE);

      const { createdLegs } = await prisma.$transaction((tx) =>
        replaceStationsInTx(
          tx,
          userId,
          routeId,
          [
            { ...n, id: stations[0].id },
            { ...p, id: stations[1].id },
            { ...k, id: stations[2].id },
          ],
          { legModes: ["ferry", "road"] }
        )
      );

      expect(createdLegs).toEqual([]);
      expect(legsBefore.map((l) => l.mode)).toEqual(["ferry", "road"]);
      expect(await storedLegRows(routeId)).toEqual(legsBefore);
    });
  });
});
