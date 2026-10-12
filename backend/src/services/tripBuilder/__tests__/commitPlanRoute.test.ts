/**
 * The route-scoped commit (owner request 2026-10-12): a trip-side re-sync writes
 * the one roadtrip and its album alone. Pinned here: the plan's shape (nothing
 * of the journey moves), the cross-row guard, the staleness semantics the
 * journey-wide flow has, and a write that leaves the other roadtrip, the track
 * rows and every journey field byte-identical.
 */
jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));

import { prisma } from "../../../db";
import type { CommitBody } from "../../../schemas/tripBuilder";
import { loadVisibleDomains } from "../../domainVisibility";
import { writeCommit } from "../commit";
import { prepareCommit } from "../commitPlan";
import { annotateDraftForExisting } from "../existingDraft";
import { loadExistingState } from "../existingState";
import type { StoredDraft } from "../types";
import {
  addStation,
  createExistingFixture,
  dropFixtureUser,
  FX,
  type ExistingFixture,
} from "./existingDb";
import { area, derivedStations, draft } from "./existingDraftFixture";

const mockDomains = loadVisibleDomains as jest.Mock;

// Synthetic fixtures only (public repository): invented places, shifted years.
const USER = "m7k-route-scope";
const AREA = "2031-05-02#1";
const COMMIT_KEY = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
/** A second roadtrip of the journey, at an invented bay the photos never visit. */
const BAY = { lat: -44.2, lon: 169.95 };
/** The place a third route is built at, to prove the cross-row guard. */
const CAMP = { lat: -45.45, lon: 169.1 };

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a route-scoped commit", () => {
  let fx: ExistingFixture;
  let otherRouteId: string;

  beforeAll(async () => {
    fx = await createExistingFixture(USER);
    const other = await prisma.tripRoute.create({
      data: {
        userId: fx.userId,
        tripId: fx.tripId,
        name: "Selby Bay stay",
        mode: "road",
        kind: "roadtrip",
        vehicle: "car",
        orderIdx: 1,
      },
    });
    otherRouteId = other.id;
    await addStation(otherRouteId, 0, {
      title: "Selby Bay",
      at: BAY,
      startDay: "2031-05-15",
      endDay: "2031-05-17",
    });
    await addStation(otherRouteId, 1, {
      title: "Selby Bay Dunes",
      at: { lat: -44.15, lon: 170.05 },
      startDay: "2031-05-17",
      endDay: "2031-05-18",
    });
  });
  afterAll(async () => {
    await dropFixtureUser(USER);
  });

  /** The stored draft a trip-side scan would leave: one area, annotated against the target route. */
  async function scopedDraft(listedFlights: readonly string[] = []): Promise<StoredDraft> {
    const state = await loadExistingState(fx.userId, fx.tripId);
    const withAlbum = draft(fx.tripId, [area()], {
      album: {
        name: "Northvale loop",
        existing: null,
        assetCount: 9,
        images: 9,
        videos: 0,
        allowed: true,
        missingScopes: [],
      },
    });
    const { dto, existing } = annotateDraftForExisting(withAlbum, state, new Map(), {
      tripId: fx.tripId,
      routeId: fx.roadtripId,
    });
    return {
      id: dto.id,
      ownerId: fx.userId,
      createdAt: 0,
      touchedAt: 0,
      status: "ready",
      input: {
        name: "Northvale loop",
        startDay: "2031-05-02",
        endDay: "2031-05-09",
        inspect: true,
        createAlbum: true,
        target: { kind: "existing", tripId: fx.tripId, routeId: fx.roadtripId },
      },
      immichUserId: "immich-user-1",
      connSource: "user",
      dto,
      previewAssetIds: [],
      albumAssetIds: [],
      // The scan listed the journey's own flight, and whatever the test adds.
      flightIds: new Set<string>([fx.flightId, ...listedFlights]),
      stationIndex: new Map(
        derivedStations().map((s) => [
          s.key,
          { areaKey: AREA, firstDay: s.firstDay, lastDay: s.lastDay },
        ])
      ),
      stopovers: [],
      pitstops: [],
      existing,
    };
  }

  /** The body the review sends for that draft: the body's stations as the draft showed them. */
  function body(over: Partial<CommitBody> = {}): CommitBody {
    const stations = derivedStations();
    const ids = [fx.station.a, fx.station.b, undefined, fx.station.s];
    return {
      commitKey: COMMIT_KEY,
      window: { startDay: "2031-05-02", endDay: "2031-05-09" },
      target: {
        kind: "existing",
        tripId: fx.tripId,
        routeId: fx.roadtripId,
        applyWindow: false,
      },
      flightIds: [],
      nights: { "2031-05-02": stations[0].key, "2031-05-03": stations[0].key },
      areas: [
        {
          key: AREA,
          as: "roadtrip",
          name: "Northvale loop",
          vehicle: "car",
          homeStart: false,
          homeEnd: false,
          stations: stations.map((s, i) => ({
            key: s.key,
            title: s.title,
            lat: s.lat,
            lon: s.lon,
            kind: s.kind,
            firstDay: s.firstDay,
            lastDay: s.lastDay,
            notes: s.notes,
            ...(ids[i] === undefined ? {} : { existingId: ids[i] }),
          })),
          legModes: stations.slice(1).map(() => "road" as const),
          album: false,
          roadtripId: fx.roadtripId,
          keepNotSeen: [fx.station.c],
          removeNotSeen: [],
        },
      ],
      stopovers: [],
      photoJourneyIds: [],
      stops: { keep: [fx.stop.museum, fx.stop.harbour], remove: [] },
      album: { create: true, name: "Northvale loop" },
      ...over,
    };
  }

  beforeEach(() => {
    mockDomains.mockResolvedValue(["roadtrip"]);
  });

  const planFor = async (over: Partial<CommitBody> = {}) =>
    prepareCommit(fx.userId, await scopedDraft(), body(over));

  it("plans a write of the one roadtrip and drops everything that would touch the journey", async () => {
    const onOtherTrip = await prisma.flight.create({
      data: {
        userId: fx.userId,
        flightNumber: "ZZ202",
        depIata: "ZZC",
        arrIata: "ZZD",
        depLat: -41.3,
        depLon: 174.8,
        arrLat: -45.0,
        arrLon: 168.7,
      },
    });
    const plan = await prepareCommit(
      fx.userId,
      await scopedDraft([onOtherTrip.id]),
      body({ flightIds: [fx.flightId, onOtherTrip.id] })
    );

    expect(plan.target).toMatchObject({
      kind: "existing",
      routeId: fx.roadtripId,
      applyWindow: false,
    });
    expect(plan.existing?.scoped).toBe(true);
    expect(plan.roadtrips).toEqual([]);
    expect(plan.stops).toEqual([]);
    expect(plan.stopovers).toEqual([]);
    expect(plan.existing?.stopovers).toEqual([]);
    expect(plan.existing?.stopUpdates).toEqual([]);
    expect(plan.existing?.stopRemoveIds).toEqual([]);
    expect(plan.existing?.roadtrips).toHaveLength(1);
    expect(plan.existing?.roadtrips[0]).toMatchObject({
      roadtripId: fx.roadtripId,
      name: "Northvale loop",
      rename: false,
    });
    // Only the flight already on the journey survives: assigning it is a no-op,
    // and the other one would have moved a row this commit must not touch.
    expect(plan.flightIds).toEqual([fx.flightId]);
    expect(plan.photoJourneyIds).toEqual([]);
  });

  it("refuses a body that names another route than the one scanned", async () => {
    await expect(
      planFor({ target: { ...body().target, routeId: otherRouteId } })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "DRAFT_MISMATCH",
    });
  });

  it("refuses when the scanned stops also stand on another stored roadtrip (never writes across rows)", async () => {
    const camp = await prisma.tripRoute.create({
      data: {
        userId: fx.userId,
        tripId: fx.tripId,
        name: "Southbridge camp",
        mode: "road",
        kind: "roadtrip",
        vehicle: "car",
        orderIdx: 2,
      },
    });
    await addStation(camp.id, 0, {
      title: "Southbridge",
      at: CAMP,
      startDay: "2031-05-05",
      endDay: "2031-05-06",
    });
    try {
      await expect(planFor()).rejects.toMatchObject({
        statusCode: 409,
        code: "ROUTE_SCOPE_CONFLICT",
      });
    } finally {
      // The other tests of this file share the fixture: the camp row goes.
      await prisma.tripStop.deleteMany({ where: { routeId: camp.id } });
      await prisma.tripRoute.delete({ where: { id: camp.id } });
    }
  });

  it("refuses a route renamed since the scan, like the journey-wide flow", async () => {
    const draftForPlan = await scopedDraft();
    await prisma.tripRoute.update({
      where: { id: fx.roadtripId },
      data: { name: "Northvale loop renamed" },
    });
    try {
      await expect(prepareCommit(fx.userId, draftForPlan, body())).rejects.toMatchObject({
        statusCode: 409,
        code: "TRIP_CHANGED",
      });
    } finally {
      await prisma.tripRoute.update({
        where: { id: fx.roadtripId },
        data: { name: "Northvale loop" },
      });
    }
  });

  it("writes that roadtrip alone: the other row and every journey field stay byte-identical", async () => {
    const plan = await planFor();
    const before = {
      trip: await prisma.trip.findUniqueOrThrow({ where: { id: fx.tripId } }),
      otherRoute: await prisma.tripRoute.findUniqueOrThrow({ where: { id: otherRouteId } }),
      otherStations: await prisma.tripStop.findMany({
        where: { routeId: otherRouteId },
        orderBy: { routeOrderIdx: "asc" },
      }),
      timelineStops: await prisma.tripStop.findMany({
        where: { tripId: fx.tripId, routeId: null },
        orderBy: { orderIdx: "asc" },
      }),
      albums: await prisma.tripImmichAlbum.findMany({ where: { tripId: fx.tripId } }),
    };

    const written = await writeCommit(plan);

    // The target roadtrip DID update (Southbridge is new; its diff says so).
    expect(written.roadtrips).toHaveLength(1);
    expect(written.roadtrips[0]).toMatchObject({ id: fx.roadtripId, stations: 5 });
    expect(written.roadtrips[0].diff).toMatchObject({ added: 1, kept: 1 });
    expect(written.stopsDiff).toBeUndefined();

    const strip = <T extends Record<string, unknown>>(row: T): Record<string, unknown> =>
      Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));

    const tripRow = await prisma.trip.findUniqueOrThrow({ where: { id: fx.tripId } });
    expect(strip(tripRow)).toEqual(strip(before.trip));
    const otherRoute = await prisma.tripRoute.findUniqueOrThrow({ where: { id: otherRouteId } });
    expect(strip(otherRoute)).toEqual(strip(before.otherRoute));
    const otherStations = await prisma.tripStop.findMany({
      where: { routeId: otherRouteId },
      orderBy: { routeOrderIdx: "asc" },
    });
    expect(otherStations.map(strip)).toEqual(before.otherStations.map(strip));
    const timelineStops = await prisma.tripStop.findMany({
      where: { tripId: fx.tripId, routeId: null },
      orderBy: { orderIdx: "asc" },
    });
    expect(timelineStops.map(strip)).toEqual(before.timelineStops.map(strip));
    const albums = await prisma.tripImmichAlbum.findMany({ where: { tripId: fx.tripId } });
    expect(albums.map(strip)).toEqual(before.albums.map(strip));
  });
});
