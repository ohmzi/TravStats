import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { haversineKm } from "../../shared/geo/haversine";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * The owner's "Total logged km" tile (2026-10-14): every roadtrip, flight and
 * cruise kilometre the logbook holds, summed once, on the server.
 *
 * Computed UNCAPPED over every row the user has — not folded in the browser
 * over the capped `GET /trips` payload (500 trips, 200 nested rows per domain),
 * which would silently miss a trip beyond the cap and every row not attached to
 * a trip at all. Served inside the existing `includeInsights` envelope beside
 * `mostExpensiveTrip`, so there is no new endpoint and no schema change.
 *
 * The three terms and their ONE rule apiece:
 *   - flights      `distanceKm` (stamped `routeDistance`, else the great-circle
 *                  chord) — the only flight distance the app has;
 *   - cruise legs  the router's own `distanceKm`, summed (an unrouted cruise has
 *                  none and contributes 0);
 *   - road legs    `drivenKm`'s allow-list, `tripRoute.kind === "roadtrip"` only
 *                  — ferry/rail/foot/bike never roll an odometer.
 *
 * A planned trip contributes nothing (consistent with the other superlatives),
 * and a domain the user does not see is left out through the same visibility
 * helper the cost superlative uses.
 */
describe("GET /trips?includeInsights=true — total logged km", () => {
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;
  let portA: number;
  let portB: number;

  const enableDomains = (domains: string[]) =>
    prisma.userSettings.upsert({
      where: { userId },
      create: { userId, enabledDomains: domains, data: {} },
      update: { enabledDomains: domains },
    });

  /** A roadtrip section (kind "roadtrip") with the given legs, on `tripId`. */
  const roadtripWithLegs = async (
    tripId: string,
    legs: Array<{ mode: string; distanceKm: number }>
  ) => {
    const route = await prisma.tripRoute.create({
      data: { userId, tripId, name: "Coast road", mode: "road", kind: "roadtrip" },
    });
    // One stop per leg endpoint: a leg is keyed by its two stops
    // (`[routeId, fromStopId, toStopId]`), so a shared pair would collide.
    const stops = await prisma.tripStop.createManyAndReturn({
      data: Array.from({ length: legs.length + 1 }, (_, i) => ({
        routeId: route.id,
        tripId,
        title: `Stop ${i}`,
        orderIdx: i,
      })),
      select: { id: true },
    });
    await prisma.tripRouteLeg.createMany({
      data: legs.map((leg, i) => ({
        routeId: route.id,
        fromStopId: stops[i].id,
        toStopId: stops[i + 1].id,
        distanceKm: leg.distanceKm,
        source: "straight",
        mode: leg.mode,
      })),
    });
    return route;
  };

  const cruiseWithLegs = async (tripId: string | null, distances: number[]) => {
    const cruise = await prisma.cruise.create({
      data: { userId, tripId, cruiseLine: "Test Line", status: "completed" },
    });
    if (distances.length > 0) {
      await prisma.cruiseLeg.createMany({
        data: distances.map((distanceKm, i) => ({
          cruiseId: cruise.id,
          ordinal: i + 1,
          fromPortId: portA,
          toPortId: portB,
          distanceKm,
          method: "test",
          routerVersion: "test",
        })),
      });
    }
    return cruise;
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "totalLoggedKmTest" } });
    const user = await prisma.user.create({
      data: { username: "totalLoggedKmTest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;

    const a = await prisma.port.upsert({
      where: { unlocode: "XXKMA" },
      update: {},
      create: { name: "Test Port A", unlocode: "XXKMA", lat: 53.5, lon: 9.9 },
    });
    const b = await prisma.port.upsert({
      where: { unlocode: "XXKMB" },
      update: {},
      create: { name: "Test Port B", unlocode: "XXKMB", lat: 59.9, lon: 10.7 },
    });
    portA = a.id;
    portB = b.id;
  });

  beforeEach(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await enableDomains(["flight", "cruise", "roadtrip"]);
  });

  afterEach(async () => {
    await prisma.cruiseLeg.deleteMany({ where: { cruise: { userId } } });
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.tripRouteLeg.deleteMany({ where: { route: { userId } } });
    await prisma.tripStop.deleteMany({ where: { route: { userId } } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.port.deleteMany({ where: { unlocode: { in: ["XXKMA", "XXKMB"] } } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("is absent from the response unless insights are explicitly requested", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalLoggedKm).toBeUndefined();
  });

  it("sums flights, cruise legs and driven road legs, leaving ferry and rail legs out", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "One of each", status: "completed" },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        routeDistance: 1000,
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
    });
    await cruiseWithLegs(trip.id, [800, 700]);
    await roadtripWithLegs(trip.id, [
      { mode: "road", distanceKm: 120 },
      // Carried, not driven: neither may reach the odometer figure.
      { mode: "ferry", distanceKm: 300 },
      { mode: "rail", distanceKm: 200 },
    ]);

    const res = await request(app).get("/api/v1/trips?includeInsights=true").set("Cookie", cookie);
    expect(res.status).toBe(200);
    // 1000 (flight) + 1500 (cruise) + 120 (driven road) — the 300 ferry and
    // 200 rail kilometres are not driven and must not inflate the figure.
    expect(res.body.totalLoggedKm).toBe(2620);
  });

  it("counts a flight's great-circle chord when no route distance is stamped", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Chord", status: "completed" },
    });
    // Nothing routed: the app's flight distance is the great-circle chord.
    const from = { lat: 50.03, lon: 8.56 };
    const to = { lat: 38.77, lon: -9.13 };
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        depLat: from.lat,
        depLon: from.lon,
        arrLat: to.lat,
        arrLon: to.lon,
      },
    });

    const res = await request(app).get("/api/v1/trips?includeInsights=true").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalLoggedKm).toBe(Math.round(haversineKm(from, to)));
  });

  it("adds nothing for a planned trip's rows", async () => {
    const done = await prisma.trip.create({
      data: { userId, name: "Flown", status: "completed" },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: done.id,
        status: "flown",
        routeDistance: 1000,
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
    });

    // A trip still on the drawing board has not flown, sailed or driven yet.
    const planned = await prisma.trip.create({
      data: { userId, name: "Someday", status: "planned" },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: planned.id,
        status: "scheduled",
        routeDistance: 5000,
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
    });
    await cruiseWithLegs(planned.id, [900]);
    await roadtripWithLegs(planned.id, [{ mode: "road", distanceKm: 400 }]);

    const res = await request(app).get("/api/v1/trips?includeInsights=true").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalLoggedKm).toBe(1000);
  });

  it("contributes zero for a cruise whose legs were never routed", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Unrouted sea week", status: "completed" },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        routeDistance: 250,
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
    });
    // No legs at all — the honest number available is 0, never an estimate.
    await cruiseWithLegs(trip.id, []);

    const res = await request(app).get("/api/v1/trips?includeInsights=true").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalLoggedKm).toBe(250);
  });

  it("adds nothing for a roadtrip whose legs are only ferry and rail", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Rail and sea", status: "completed" },
    });
    await roadtripWithLegs(trip.id, [
      { mode: "ferry", distanceKm: 300 },
      { mode: "rail", distanceKm: 200 },
      { mode: "foot", distanceKm: 12 },
      { mode: "bike", distanceKm: 40 },
    ]);

    const res = await request(app).get("/api/v1/trips?includeInsights=true").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalLoggedKm).toBe(0);
  });

  it("counts a trip beyond the 500-trip cap (the uncapped property)", async () => {
    // 501 trips, each a millisecond apart so the newest-500 window is the last
    // 500 created and the very first falls OUTSIDE the list.
    const base = Date.parse("2020-01-01T00:00:00.000Z");
    await prisma.trip.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        userId,
        name: `Trip ${i}`,
        status: "completed" as const,
        createdAt: new Date(base + i * 1000),
      })),
    });
    const oldest = await prisma.trip.findFirstOrThrow({
      where: { userId, name: "Trip 0" },
      select: { id: true },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: oldest.id,
        status: "flown",
        routeDistance: 777,
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
    });

    const res = await request(app).get("/api/v1/trips?includeInsights=true").set("Cookie", cookie);
    expect(res.status).toBe(200);
    // The capped list really did drop it...
    expect(res.body.trips).toHaveLength(500);
    expect(res.body.trips.map((t: { id: string }) => t.id)).not.toContain(oldest.id);
    // ...and the total counted it anyway.
    expect(res.body.totalLoggedKm).toBe(777);
  }, 30_000);

  it("leaves a hidden domain's kilometres out", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Mixed", status: "completed" },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        routeDistance: 1000,
        depLat: 0,
        depLon: 0,
        arrLat: 0,
        arrLon: 0,
      },
    });
    await cruiseWithLegs(trip.id, [1500]);
    await roadtripWithLegs(trip.id, [{ mode: "road", distanceKm: 120 }]);

    // Cruise and roadtrip switched off: only the flight's kilometre counts.
    await enableDomains(["flight"]);
    const hidden = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", cookie);
    expect(hidden.body.totalLoggedKm).toBe(1000);

    await enableDomains(["flight", "cruise", "roadtrip"]);
    const shown = await request(app)
      .get("/api/v1/trips?includeInsights=true")
      .set("Cookie", cookie);
    expect(shown.body.totalLoggedKm).toBe(2620);
  });
});
