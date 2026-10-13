jest.mock("../../services/tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resolveRouteProvider } from "../../services/tour/routing/resolveProvider";
import type {
  RouteFailure,
  RouteProvider,
  RouteRequest,
  RouteResult,
} from "../../services/tour/routing/types";
import { AUTOFETCH_MIN_OFF_KM } from "../../services/tour/routing/autoFetch";
import { haversineKm } from "../../shared/geo/haversine";

const mockResolveProvider = resolveRouteProvider as jest.Mock<Promise<RouteProvider | null>>;

/**
 * Task 6 (phase 3) — routing exposed over HTTP: a single leg routed through
 * the configured provider, and a whole section routed in one call.
 *
 * `resolveRouteProvider` is mocked at the module boundary so these tests
 * never touch the network — every "provider" here is a `jest.fn()` this
 * suite controls directly, exactly like `routeLegGeometry`'s own test suite
 * (task 5) does. `routeLegGeometry` itself is NOT mocked: its trustworthiness
 * checks (anchor tolerance, sanity ratio, finiteness) run for real against
 * whatever the fake provider returns, so a test's fake waypoints must
 * actually anchor at the real leg endpoints below.
 */
describe("Tour route sections — provider routing", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;
  let routeId: string;
  let osloId: string;
  let kristiansandId: string;
  let bergenId: string;

  // Real-world coordinates so a provider "answer" anchored at them passes
  // routeLegGeometry's 1 km anchor check and its 20x sanity-ratio check.
  const OSLO = { lat: 59.91, lon: 10.75 };
  const KRISTIANSAND = { lat: 58.15, lon: 8.0 };
  const BERGEN = { lat: 60.39, lon: 5.32 };

  function fakeProvider(
    routeImpl: jest.Mock<Promise<RouteResult | RouteFailure | null>>
  ): RouteProvider {
    return { id: "graphhopper", route: routeImpl };
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourrouting" } });
    const u = await prisma.user.create({
      data: { username: "tourrouting", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Assigning the stops below routes their new legs automatically; with the
    // previous test's provider still mocked, every leg would start "routed".
    mockResolveProvider.mockResolvedValue(null);
    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({ data: { userId, name: "T" } });
    tripId = trip.id;
    const route = await prisma.tripRoute.create({
      data: { userId, tripId, name: "S", mode: "road" },
    });
    routeId = route.id;

    const oslo = await prisma.tripStop.create({
      data: { tripId, title: "Oslo", lat: OSLO.lat, lon: OSLO.lon },
    });
    const kristiansand = await prisma.tripStop.create({
      data: { tripId, title: "Kristiansand", lat: KRISTIANSAND.lat, lon: KRISTIANSAND.lon },
    });
    const bergen = await prisma.tripStop.create({
      data: { tripId, title: "Bergen", lat: BERGEN.lat, lon: BERGEN.lon },
    });
    osloId = oslo.id;
    kristiansandId = kristiansand.id;
    bergenId = bergen.id;

    await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [osloId, kristiansandId, bergenId] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourrouting" } });
    await prisma.$disconnect();
  });

  const routeLegUrl = (from: string, to: string) =>
    `/api/v1/trips/${tripId}/routes/${routeId}/legs/${from}/${to}/route`;
  const legUrl = (from: string, to: string) =>
    `/api/v1/trips/${tripId}/routes/${routeId}/legs/${from}/${to}`;
  const routeAllUrl = () => `/api/v1/trips/${tripId}/routes/${routeId}/route-all`;

  it("routes a single leg through the configured provider and stores its geometry and distance", async () => {
    const line: Array<[number, number]> = [
      [OSLO.lon, OSLO.lat],
      [9.0, 59.0],
      [KRISTIANSAND.lon, KRISTIANSAND.lat],
    ];
    const routeImpl = jest.fn().mockResolvedValue({
      waypoints: line,
      distanceKm: 350,
      drivingMinutes: 240,
    });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.leg.source).toBe("routed");
    expect(res.body.leg.confidence).toBe("high");
    expect(res.body.leg.distanceKm).toBe(350);
    expect(res.body.leg.drivingMinutes).toBe(240);
    expect(res.body.leg.waypoints).toEqual(line);
    expect(res.body.fallbackReason).toBeNull();
    expect(res.body.fallbackDetail).toBeNull();
    expect(routeImpl).toHaveBeenCalledTimes(1);
  });

  it("names why a single leg stayed straight, so the client can say more than 'nothing happened'", async () => {
    const routeImpl = jest.fn().mockResolvedValue({ failure: "point_not_near_road" });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.leg.source).toBe("straight");
    expect(res.body.fallbackReason).toBe("point_not_near_road");
    // A named failure has no provider answer to quote numbers from.
    expect(res.body.fallbackDetail).toBeNull();
  });

  it("a discarded answer comes back with the numbers that refused it, so the client can say how far off it was", async () => {
    // 2026-10-13 (owner's Muscat roadtrip): a routing graph with no data for
    // the region snaps both stops ~10,000 km away and every leg stays
    // straight. "Did not fit" alone reads like the app being fussy about a
    // good answer; the offsets show the provider never had the roads.
    const head = { lat: OSLO.lat + 2, lon: OSLO.lon + 2 };
    const tail = { lat: KRISTIANSAND.lat + 2, lon: KRISTIANSAND.lon + 2 };
    const routeImpl = jest.fn().mockResolvedValue({
      waypoints: [
        [head.lon, head.lat],
        [tail.lon, tail.lat],
      ],
      distanceKm: 400,
      drivingMinutes: 300,
    });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.leg.source).toBe("straight");
    expect(res.body.fallbackReason).toBe("untrustworthy");
    expect(res.body.fallbackDetail.kind).toBe("anchors");
    expect(res.body.fallbackDetail.headOffKm).toBeCloseTo(haversineKm(OSLO, head), 6);
    expect(res.body.fallbackDetail.tailOffKm).toBeCloseTo(haversineKm(KRISTIANSAND, tail), 6);
  });

  it("a failed routing attempt leaves a hand-drawn leg as it was drawn", async () => {
    const drawn: Array<[number, number]> = [
      [OSLO.lon, OSLO.lat],
      [9.5, 59.2],
      [KRISTIANSAND.lon, KRISTIANSAND.lat],
    ];
    const put = await request(app)
      .put(legUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send({ source: "drawn", waypoints: drawn });
    expect(put.status).toBe(200);
    const routeImpl = jest.fn().mockResolvedValue({ failure: "no_route" });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.fallbackReason).toBe("no_route");
    expect(res.body.leg.source).toBe("drawn");
    expect(res.body.leg.waypoints).toEqual(drawn);
  });

  it("hands the section's vehicle to the provider", async () => {
    await prisma.tripRoute.update({ where: { id: routeId }, data: { vehicle: "bicycle" } });
    const routeImpl = jest.fn().mockResolvedValue(null);
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    await request(app).post(routeLegUrl(osloId, kristiansandId)).set("Cookie", cookie).send();

    expect(routeImpl).toHaveBeenCalledWith(expect.objectContaining({ vehicle: "bicycle" }));
  });

  it("refuses to route a leg when no provider is configured (409, not 400)", async () => {
    mockResolveProvider.mockResolvedValue(null);

    const res = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/configur/i);
  });

  it("a provider failure on a single leg leaves it a straight chord with low confidence, still 200", async () => {
    // The provider's own contract: null means "could not route this", never
    // a thrown error — see `routeLegGeometry`'s doc comment.
    const routeImpl = jest.fn().mockResolvedValue(null);
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.leg.source).toBe("straight");
    expect(res.body.leg.confidence).toBe("low");
    expect(res.body.fallbackReason).toBe("provider_error");
  });

  it("route-all routes every routable leg of a section and reports how many it skipped", async () => {
    // Mark the Kristiansand → Bergen leg as a ferry crossing, inside an
    // otherwise-road section — it must be skipped, not routed.
    await request(app)
      .put(legUrl(kristiansandId, bergenId))
      .set("Cookie", cookie)
      .send({ source: "straight", mode: "ferry" });

    const line: Array<[number, number]> = [
      [OSLO.lon, OSLO.lat],
      [KRISTIANSAND.lon, KRISTIANSAND.lat],
    ];
    const routeImpl = jest.fn().mockResolvedValue({
      waypoints: line,
      distanceKm: 320,
      drivingMinutes: 210,
    });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app).post(routeAllUrl()).set("Cookie", cookie).send();

    expect(res.status).toBe(200);
    expect(res.body.routedCount).toBe(1);
    expect(res.body.fallbackCount).toBe(0);
    expect(res.body.fallbackReason).toBeNull();
    expect(res.body.skippedCount).toBe(1);
    // Only the road leg was ever handed to the provider.
    expect(routeImpl).toHaveBeenCalledTimes(1);

    const roadLeg = await prisma.tripRouteLeg.findUniqueOrThrow({
      where: {
        routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId },
      },
    });
    expect(roadLeg.source).toBe("routed");
    expect(roadLeg.distanceKm).toBe(320);

    const ferryLeg = await prisma.tripRouteLeg.findUniqueOrThrow({
      where: {
        routeId_fromStopId_toStopId: { routeId, fromStopId: kristiansandId, toStopId: bergenId },
      },
    });
    expect(ferryLeg.source).toBe("straight");
    expect(ferryLeg.mode).toBe("ferry");
  });

  it("a provider failure during route-all leaves that leg a straight chord, and counts it as a fallback, not a route", async () => {
    const routeImpl = jest.fn().mockResolvedValue({ failure: "rate_limited" });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app).post(routeAllUrl()).set("Cookie", cookie).send();

    expect(res.status).toBe(200);
    // Both legs are road-mode and both were sent; neither was routed. The
    // old count said "2 routed" here, which read as success.
    expect(res.body.routedCount).toBe(0);
    expect(res.body.fallbackCount).toBe(2);
    expect(res.body.fallbackReason).toBe("rate_limited");
    expect(res.body.skippedCount).toBe(0);

    const legs = res.body.legs as Array<{ source: string; confidence: string }>;
    expect(legs.every((l) => l.source === "straight" && l.confidence === "low")).toBe(true);
  });

  it("route-all pairs the numbers with the first cause, so the batch message says how far off the answer was", async () => {
    // Both legs answer from ~200 km away — the harness's stand-in for a road
    // graph with no data for the region (the owner's Muscat case, 2026-10-13).
    // The batch keeps only the FIRST fallback's cause; its detail must be
    // that same leg's numbers, never another leg's offset attached to it.
    const routeImpl = jest.fn().mockImplementation(async (req: RouteRequest) => ({
      waypoints: [
        [req.from.lon + 2, req.from.lat + 2],
        [req.to.lon + 2, req.to.lat + 2],
      ],
      distanceKm: 400,
      drivingMinutes: 300,
    }));
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const res = await request(app).post(routeAllUrl()).set("Cookie", cookie).send();

    expect(res.status).toBe(200);
    expect(res.body.routedCount).toBe(0);
    expect(res.body.fallbackCount).toBe(2);
    expect(res.body.fallbackReason).toBe("untrustworthy");
    expect(res.body.fallbackDetail.kind).toBe("anchors");
    // The first leg is Oslo → Kristiansand (route order), so its head
    // offset is measured from Oslo.
    expect(res.body.fallbackDetail.headOffKm).toBeCloseTo(
      haversineKm(OSLO, { lat: OSLO.lat + 2, lon: OSLO.lon + 2 }),
      6
    );
  });

  it('rejects a leg override with source "track" and no trackId (400) — trackId is required, track itself is NOT refused', async () => {
    // Fix round 1: this test used to be titled "still rejects ... track ...
    // phase 3b owns producing it", from when `track` was not yet a valid
    // source at all. Phase 3b IS this task now, and `track` IS produced by
    // this same endpoint (see tourLegs.adopt.test.ts) — this 400 is ONLY
    // about the missing `trackId`, not about `track` being rejected
    // outright. The assertion below is written to actually distinguish the
    // two: a 400 whose Zod issue lands on `trackId` (this case) vs. one
    // that would land on `source` (a `track` rejected outright, the way
    // `routed` still is below) — asserting merely `res.status === 400`
    // would pass either way and prove nothing.
    const res = await request(app)
      .put(legUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send({ source: "track" });

    expect(res.status).toBe(400);
    const details = res.body.details as Array<{ field: string; message: string }>;
    expect(details.some((d) => d.field === "trackId")).toBe(true);
    expect(details.some((d) => d.field === "source")).toBe(false);
  });

  it('refuses a leg override with source "routed" (400) — that geometry comes from the routing endpoint, not this one', async () => {
    // Fix round 1: the manual override endpoint and the routing endpoint own
    // DIFFERENT source vocabularies now (MANUAL_LEG_SOURCES vs
    // ACCEPTED_LEG_SOURCES). A caller cannot hand-supply "routed" here.
    const res = await request(app)
      .put(legUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send({ source: "routed" });

    expect(res.status).toBe(400);
    // The error handler puts Zod's per-field message in `details`, not the
    // top-level `error` string (which is always the generic "Validation error").
    const details = res.body.details as Array<{ field: string; message: string }>;
    expect(details.some((d) => d.field === "source" && /route/i.test(d.message))).toBe(true);
  });

  it("a leg that was routed, then manually reverted to straight, ends up a consistent state — not a routed leg holding a chord", async () => {
    // Pins the actual harm fix round 1 closed: before the split, sending
    // source: "routed" through this endpoint (accepted then) without
    // waypoints cleared the stored line while the column kept saying
    // "routed" — a false provenance claim. Now the only way back from a
    // routed leg through this endpoint is source: "straight", and that must
    // leave EVERY field consistent: no leftover geometry, no leftover
    // routed distance, no leftover "routed" label.
    const original = await prisma.tripRouteLeg.findUniqueOrThrow({
      where: {
        routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId },
      },
    });
    expect(original.source).toBe("straight");
    expect(original.waypoints).toBeNull();

    const line: Array<[number, number]> = [
      [OSLO.lon, OSLO.lat],
      [KRISTIANSAND.lon, KRISTIANSAND.lat],
    ];
    const routeImpl = jest.fn().mockResolvedValue({
      waypoints: line,
      distanceKm: 999,
      drivingMinutes: 300,
    });
    mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

    const routedRes = await request(app)
      .post(routeLegUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send();
    expect(routedRes.status).toBe(200);
    expect(routedRes.body.leg.source).toBe("routed");
    expect(routedRes.body.leg.distanceKm).toBe(999);

    const revertRes = await request(app)
      .put(legUrl(osloId, kristiansandId))
      .set("Cookie", cookie)
      .send({ source: "straight" });

    expect(revertRes.status).toBe(200);
    expect(revertRes.body.leg.source).toBe("straight");
    expect(revertRes.body.leg.waypoints).toBeNull();
    expect(revertRes.body.leg.distanceKm).toBeCloseTo(original.distanceKm, 6);

    const persisted = await prisma.tripRouteLeg.findUniqueOrThrow({
      where: {
        routeId_fromStopId_toStopId: { routeId, fromStopId: osloId, toStopId: kristiansandId },
      },
    });
    expect(persisted.source).toBe("straight");
    expect(persisted.waypoints).toBeNull();
    expect(persisted.distanceKm).toBeCloseTo(original.distanceKm, 6);
  });

  /**
   * Task 6 of the osrm-autofetch plan (2026-10-13): when a refusal is a
   * wrong-region one (the provider's line snapped hundreds of km away — what
   * a road graph with no data for that area does), the endpoint asks the
   * host's `osrm-autofetch` service to fetch and build the missing map, and
   * carries its answer as `autofetch` beside `fallbackReason`/`fallbackDetail`
   * on the SAME body, so the client can say a download is running. The admin
   * setting `routingAutoFetchUrl` is the switch: unset, no call is made and
   * the response is exactly the pre-feature shape.
   */
  describe("on-demand map fetching (osrm-autofetch)", () => {
    const AUTOFETCH_URL = "http://10.86.15.1:5013";
    let fetchSpy: jest.SpyInstance;

    /** A refusal whose answer snapped ~750 km away — the wrong-region case. */
    function farOffProvider(): jest.Mock<Promise<RouteResult | RouteFailure | null>> {
      return jest.fn().mockImplementation(async (req: RouteRequest) => ({
        waypoints: [
          [req.from.lon + 6, req.from.lat + 6],
          [req.to.lon + 6, req.to.lat + 6],
        ],
        distanceKm: 900,
        drivingMinutes: 600,
      }));
    }

    async function setAutoFetchUrl(url: string | null): Promise<void> {
      const row = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
      await prisma.adminSettings.update({
        where: { id: row.id },
        data: { routingAutoFetchUrl: url },
      });
    }

    beforeEach(async () => {
      await setAutoFetchUrl(null);
      // Default to a refusing stub so a test that does not expect a call can
      // never reach a real service (or the network) by accident.
      fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
        throw new Error("fetch is stubbed in tests — no test may call the network");
      });
    });

    afterEach(async () => {
      fetchSpy.mockRestore();
      await setAutoFetchUrl(null);
    });

    afterAll(async () => {
      await setAutoFetchUrl(null);
    });

    it("a wrong-region refusal asks /ensure with that leg's two points and carries the answer", async () => {
      await setAutoFetchUrl(AUTOFETCH_URL);
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "started", region: "Tennessee", etaMinutes: 25 }),
      } as Response);
      mockResolveProvider.mockResolvedValue(fakeProvider(farOffProvider()));

      const res = await request(app)
        .post(routeLegUrl(osloId, kristiansandId))
        .set("Cookie", cookie)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.fallbackReason).toBe("untrustworthy");
      expect(res.body.fallbackDetail.kind).toBe("anchors");
      expect(res.body.fallbackDetail.headOffKm).toBeGreaterThan(AUTOFETCH_MIN_OFF_KM);
      // The service's answer rides beside the reason it belongs to.
      expect(res.body.autofetch).toEqual({
        status: "started",
        region: "Tennessee",
        etaMinutes: 25,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${AUTOFETCH_URL}/ensure`);
      expect(init.method).toBe("POST");
      // THAT leg's points, as [lat, lon] pairs the service expects.
      expect(JSON.parse(String(init.body))).toEqual({
        points: [
          [OSLO.lat, OSLO.lon],
          [KRISTIANSAND.lat, KRISTIANSAND.lon],
        ],
      });
    });

    it("a mid-sized anchor offset is refused and triggers the download", async () => {
      await setAutoFetchUrl(AUTOFETCH_URL);
      // ~27 km off at both ends: past the 25 km snap bound (the line IS
      // refused — owner ruling 2026-10-13) AND past the 20 km wrong-region
      // threshold, so the refusal carries the anchors detail and the
      // auto-fetch fires. This is the new band: refused, but no longer a
      // "pin-sized" refusal that would have been accepted under the old 1 km
      // bound.
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "started", region: "Oslo", etaMinutes: 5 }),
      } as Response);
      const routeImpl = jest.fn().mockImplementation(async (req: RouteRequest) => ({
        waypoints: [
          [req.from.lon, req.from.lat + 0.24],
          [req.to.lon, req.to.lat + 0.24],
        ],
        distanceKm: 300,
        drivingMinutes: 200,
      }));
      mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

      const res = await request(app)
        .post(routeLegUrl(osloId, kristiansandId))
        .set("Cookie", cookie)
        .send();

      expect(res.body.fallbackReason).toBe("untrustworthy");
      expect(res.body.fallbackDetail.kind).toBe("anchors");
      expect(res.body.fallbackDetail.headOffKm).toBeGreaterThan(25);
      expect(res.body.autofetch).toEqual({ status: "started", region: "Oslo", etaMinutes: 5 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("a genuine distance mismatch never triggers a download, however implausible the number", async () => {
      await setAutoFetchUrl(AUTOFETCH_URL);
      // Anchored exactly at both stops, reporting 20x+ the chord: a broken
      // answer (kind "distance"), which carries no wrong-region signal.
      const routeImpl = jest.fn().mockImplementation(async (req: RouteRequest) => ({
        waypoints: [
          [req.from.lon, req.from.lat],
          [req.to.lon, req.to.lat],
        ],
        distanceKm: 9000,
        drivingMinutes: 600,
      }));
      mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

      const res = await request(app)
        .post(routeLegUrl(osloId, kristiansandId))
        .set("Cookie", cookie)
        .send();

      expect(res.body.fallbackReason).toBe("untrustworthy");
      expect(res.body.fallbackDetail.kind).toBe("distance");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(res.body.autofetch).toBeUndefined();
    });

    it("an unset setting leaves the response exactly as it was — no field, no call", async () => {
      await setAutoFetchUrl(null);
      mockResolveProvider.mockResolvedValue(fakeProvider(farOffProvider()));

      const res = await request(app)
        .post(routeLegUrl(osloId, kristiansandId))
        .set("Cookie", cookie)
        .send();

      expect(res.body.fallbackDetail.kind).toBe("anchors");
      expect(res.body.fallbackDetail.headOffKm).toBeGreaterThan(AUTOFETCH_MIN_OFF_KM);
      expect(fetchSpy).not.toHaveBeenCalled();
      // Byte-identical includes the key set: the field is ABSENT, not null.
      expect(Object.keys(res.body).sort()).toEqual(["fallbackDetail", "fallbackReason", "leg"]);
    });

    it("an empty-string setting is off too — a blank field cannot produce a request", async () => {
      // The admin UI saves a cleared field as null, but a blank written
      // straight into the column must read the same way: "off".
      await setAutoFetchUrl("");
      mockResolveProvider.mockResolvedValue(fakeProvider(farOffProvider()));

      const res = await request(app)
        .post(routeLegUrl(osloId, kristiansandId))
        .set("Cookie", cookie)
        .send();

      expect(res.body.fallbackDetail.kind).toBe("anchors");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(Object.keys(res.body).sort()).toEqual(["fallbackDetail", "fallbackReason", "leg"]);
    });

    it("an auto-fetch service that refuses the connection leaves the response exactly as it was", async () => {
      await setAutoFetchUrl(AUTOFETCH_URL); // the rejecting stub above answers
      mockResolveProvider.mockResolvedValue(fakeProvider(farOffProvider()));

      const res = await request(app)
        .post(routeLegUrl(osloId, kristiansandId))
        .set("Cookie", cookie)
        .send();

      // It WAS asked (the refusal qualifies) — and the answer simply did not
      // arrive, which must leave the response as today's (Review Focus 4).
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(res.body.fallbackReason).toBe("untrustworthy");
      expect(res.body.fallbackDetail.kind).toBe("anchors");
      expect(Object.keys(res.body).sort()).toEqual(["fallbackDetail", "fallbackReason", "leg"]);
    });

    it("route-all asks once, with the FIRST fallback leg's points, and carries the answer there", async () => {
      await setAutoFetchUrl(AUTOFETCH_URL);
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "running", region: "Norway", etaMinutes: 30 }),
      } as Response);
      mockResolveProvider.mockResolvedValue(fakeProvider(farOffProvider()));

      const res = await request(app).post(routeAllUrl()).set("Cookie", cookie).send();

      expect(res.status).toBe(200);
      expect(res.body.fallbackReason).toBe("untrustworthy");
      expect(res.body.fallbackDetail.kind).toBe("anchors");
      // The first fallback is Oslo → Kristiansand (route order); its numbers
      // and the ensure call must describe that same leg, never a later one.
      expect(res.body.fallbackDetail.headOffKm).toBeCloseTo(
        haversineKm(OSLO, { lat: OSLO.lat + 6, lon: OSLO.lon + 6 }),
        6
      );
      expect(res.body.autofetch).toEqual({ status: "running", region: "Norway", etaMinutes: 30 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        points: [
          [OSLO.lat, OSLO.lon],
          [KRISTIANSAND.lat, KRISTIANSAND.lon],
        ],
      });
    });

    it("route-all never triggers on a LATER leg's big offsets — the first fallback decides", async () => {
      await setAutoFetchUrl(AUTOFETCH_URL);
      const routeImpl = jest.fn().mockImplementation(async (req: RouteRequest) => {
        // Oslo → Kristiansand (first) is ~27 km off (refused, below the
        // wrong-region threshold); Kristiansand → Bergen (later) is hundreds
        // of km off. The batch keeps only the FIRST fallback's numbers, so
        // only those may decide the download.
        const first = req.from.lat === OSLO.lat;
        const shift = first ? 0.24 : 6;
        return {
          waypoints: [
            [req.from.lon, req.from.lat + shift],
            [req.to.lon, req.to.lat + shift],
          ],
          distanceKm: 900,
          drivingMinutes: 600,
        };
      });
      mockResolveProvider.mockResolvedValue(fakeProvider(routeImpl));

      const res = await request(app).post(routeAllUrl()).set("Cookie", cookie).send();

      expect(res.body.fallbackReason).toBe("untrustworthy");
      expect(res.body.fallbackDetail.kind).toBe("anchors");
      // The first fallback's offsets are ~27 km — past both the 25 km snap
      // bound and the 20 km wrong-region threshold, so the auto-fetch fires.
      // The LATER leg's hundreds-of-km offsets must not be what decided it:
      // the ensure call carries the FIRST leg's points.
      expect(res.body.fallbackDetail.headOffKm).toBeGreaterThan(25);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        points: [
          [OSLO.lat, OSLO.lon],
          [KRISTIANSAND.lat, KRISTIANSAND.lon],
        ],
      });
    });
  });
});
