/**
 * The route-scoped commit (owner request 2026-10-12): a trip-side re-sync writes
 * the one roadtrip and its album alone. Pinned here: the plan's shape (nothing
 * of the journey moves), the cross-row guard, the staleness semantics the
 * journey-wide flow has, and a whole-job run that leaves every journey field,
 * the other roadtrip and its stations and legs, the track rows and the album
 * links byte-identical — the journey's DERIVED status alone excepted, the one
 * field phase C's `recomputeTripStatus` may write (finding NEW-2).
 */
jest.mock("../../domainVisibility", () => ({ loadVisibleDomains: jest.fn() }));
// Phase D's album write is mocked like `commit.job.test.ts` does: the pin runs
// the whole job (phase B, the recompute of phase C, the album step's call) but
// the album service's own DB writes are its own suites' business.
jest.mock("../albumWrite", () => ({
  ...jest.requireActual("../albumWrite"),
  preflightAlbum: jest.fn(),
  writeTripAlbum: jest.fn(),
}));
jest.mock("../albumResync", () => ({
  ...jest.requireActual("../albumResync"),
  resyncTripAlbum: jest.fn(),
}));
jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(),
}));

import { prisma } from "../../../db";
import type { CommitBody } from "../../../schemas/tripBuilder";
import { setClockForTests } from "../../../shared/time/clock";
import { loadVisibleDomains } from "../../domainVisibility";
import { resolveRouteProvider } from "../../tour/routing/resolveProvider";
import { resyncTripAlbum } from "../albumResync";
import { preflightAlbum, writeTripAlbum } from "../albumWrite";
import { runCommitJob, writeCommit } from "../commit";
import { prepareCommit } from "../commitPlan";
import { annotateDraftForExisting } from "../existingDraft";
import { loadExistingState } from "../existingState";
import type { StoredDraft } from "../types";
import {
  addRoutedLeg,
  addStation,
  createExistingFixture,
  dropFixtureUser,
  FX,
  type ExistingFixture,
} from "./existingDb";
import { area, derivedStations, draft, K } from "./existingDraftFixture";

const mockDomains = loadVisibleDomains as jest.Mock;
const mockPreflight = preflightAlbum as jest.Mock;
const mockWriteAlbum = writeTripAlbum as jest.Mock;
const mockResync = resyncTripAlbum as jest.Mock;
const mockProvider = resolveRouteProvider as jest.Mock;

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
    const bay = await addStation(otherRouteId, 0, {
      title: "Selby Bay",
      at: BAY,
      startDay: "2031-05-15",
      endDay: "2031-05-17",
    });
    const dunes = await addStation(otherRouteId, 1, {
      title: "Selby Bay Dunes",
      at: { lat: -44.15, lon: 170.05 },
      startDay: "2031-05-17",
      endDay: "2031-05-18",
    });
    // Its own routed leg: the pin proves another trip's legs stay put too.
    await addRoutedLeg(otherRouteId, bay, dunes, 12.3);
  });
  afterAll(async () => {
    await dropFixtureUser(USER);
  });

  /** A throwaway roadtrip of the journey, one station, added and removed around one call. */
  async function withDecoyRoute<T>(
    name: string,
    station: { title: string; at: { lat: number; lon: number }; startDay: string; endDay: string },
    run: (decoy: { routeId: string; stationId: string }) => Promise<T>
  ): Promise<T> {
    const route = await prisma.tripRoute.create({
      data: {
        userId: fx.userId,
        tripId: fx.tripId,
        name,
        mode: "road",
        kind: "roadtrip",
        vehicle: "car",
        orderIdx: 2,
      },
    });
    try {
      const stationId = await addStation(route.id, 0, station);
      return await run({ routeId: route.id, stationId });
    } finally {
      await prisma.tripStop.deleteMany({ where: { routeId: route.id } });
      await prisma.tripRoute.delete({ where: { id: route.id } });
    }
  }

  /** The stored draft a trip-side scan would leave: one area, annotated against the target route. */
  async function scopedDraft(
    listedFlights: readonly string[] = [],
    albumAssetIds: string[] = []
  ): Promise<StoredDraft> {
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
      albumAssetIds,
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

  /**
   * The body the review sends for a scoped draft: its area's stations and legs
   * as the draft shows them, and the draft's own night answers — a left-out
   * stop's answer is unknown again there, so the night plan still validates.
   */
  function draftBody(draft: StoredDraft): CommitBody {
    const base = body();
    const area = draft.dto.areas[0];
    return {
      ...base,
      nights: Object.fromEntries(
        Object.entries(draft.dto.nights).map(([day, entry]) => [day, entry.assign])
      ),
      areas: [
        {
          ...base.areas[0],
          legModes: area.legs.map((leg) => leg.mode),
          stations: area.stations.map((s) => ({
            key: s.key,
            title: s.title,
            lat: s.lat,
            lon: s.lon,
            kind: s.kind,
            firstDay: s.firstDay,
            lastDay: s.lastDay,
            notes: s.notes,
            ...(s.existingId === undefined ? {} : { existingId: s.existingId }),
          })),
        },
      ],
    };
  }

  const strip = <T extends Record<string, unknown>>(row: T): Record<string, unknown> =>
    Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));

  beforeEach(() => {
    jest.clearAllMocks();
    mockDomains.mockResolvedValue(["roadtrip"]);
    // The whole job's Immich ends: the preflight says yes, the scoped album
    // re-sync is the mock (its own write is `commit.job.test.ts`'s pin), and
    // routing answers "no provider", so the pin touches no network and no
    // album row.
    mockPreflight.mockResolvedValue({ ok: true, client: {}, immichUserId: "immich-user-1" });
    mockResync.mockResolvedValue({
      status: "linked",
      immichAlbumId: "album-1",
      albumName: "Northvale loop",
      reused: true,
      added: 0,
      alreadyIn: 0,
      refused: 0,
      removed: 0,
    });
    mockProvider.mockResolvedValue(null);
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
    // Defense in depth (the scan leaves such a stop out, below): this body is
    // built from the fixture, not from the annotated draft, so it still NAMES
    // the cross-trip stop — exactly what a body that re-added one would do —
    // and what reaches the write plan is what the guard judges.
    await withDecoyRoute(
      "Southbridge camp",
      { title: "Southbridge", at: CAMP, startDay: "2031-05-05", endDay: "2031-05-06" },
      async () => {
        await expect(planFor()).rejects.toMatchObject({
          statusCode: 409,
          code: "ROUTE_SCOPE_CONFLICT",
        });
      }
    );
  });

  it("leaves a stop that stands on another trip out of the write, and re-syncs the rest", async () => {
    // The owner's shape (2026-10-12, the live refusal): the scoped window's
    // last day also picks up photos of ANOTHER trip's stop — the 11-30 arrival
    // — whose coordinates reconcile to that trip's stored station on
    // overlapping days. The scan leaves the stop out and the review shows it;
    // the commit writes the rest and the other trip is never touched.
    await withDecoyRoute(
      "Southbridge camp",
      { title: "Camp Nine", at: CAMP, startDay: "2031-05-05", endDay: "2031-05-06" },
      async (decoy) => {
        const draftForPlan = await scopedDraft([], ["nv-1", "sb-1"]);
        const [area] = draftForPlan.dto.areas;
        // What the review reads: the stop is out of the route, with its reason.
        expect(area.stations.map((s) => s.title)).toEqual([
          "Northvale",
          "Port Carrow",
          // The stored title wins on a matched station (`keptTitle`).
          "Tarnside Lodge",
        ]);
        expect(area.leftOut).toEqual([
          {
            key: K.southbridge,
            title: "Southbridge",
            firstDay: "2031-05-05",
            lastDay: "2031-05-06",
            routeId: decoy.routeId,
            routeName: "Southbridge camp",
          },
        ]);
        // The night it held is unknown again, so the night plan still validates
        // and the review can submit.
        expect(draftForPlan.dto.nights["2031-05-05"]?.assign).toBe("unknown");

        const before = {
          row: await prisma.tripRoute.findUniqueOrThrow({ where: { id: decoy.routeId } }),
          stations: await prisma.tripStop.findMany({
            where: { routeId: decoy.routeId },
            orderBy: { routeOrderIdx: "asc" },
          }),
          legs: await prisma.tripRouteLeg.findMany({
            where: { routeId: decoy.routeId },
            orderBy: { id: "asc" },
          }),
        };

        const plan = await prepareCommit(fx.userId, draftForPlan, draftBody(draftForPlan));
        const written = await runCommitJob(draftForPlan, plan);
        if (written.status !== "committed") throw new Error("the commit did not write");

        // The rest of the trip IS written; the left-out stop is not.
        const titles = (
          await prisma.tripStop.findMany({
            where: { routeId: fx.roadtripId },
            orderBy: { routeOrderIdx: "asc" },
          })
        ).map((station) => station.title);
        expect(titles).toEqual(
          expect.arrayContaining(["Northvale", "Port Carrow", "Tarnside Lodge"])
        );
        expect(titles).not.toContain("Southbridge");
        expect(written.roadtrips).toHaveLength(1);
        expect(written.roadtrips[0]).toMatchObject({ id: fx.roadtripId });

        // The other trip — the stop's real owner — is byte-identical: row,
        // stations and legs alike, nothing moved, nothing deleted.
        expect(
          strip(await prisma.tripRoute.findUniqueOrThrow({ where: { id: decoy.routeId } }))
        ).toEqual(strip(before.row));
        expect(
          (
            await prisma.tripStop.findMany({
              where: { routeId: decoy.routeId },
              orderBy: { routeOrderIdx: "asc" },
            })
          ).map(strip)
        ).toEqual(before.stations.map(strip));
        expect(
          (
            await prisma.tripRouteLeg.findMany({
              where: { routeId: decoy.routeId },
              orderBy: { id: "asc" },
            })
          ).map(strip)
        ).toEqual(before.legs.map(strip));

        // The album step is the WINDOW's, not the stops': the skipped stop's
        // photo is still in the list the trip's own album receives, add-only —
        // the skip changes nothing about the album's membership.
        expect(mockResync).toHaveBeenCalledTimes(1);
        expect(mockResync).toHaveBeenCalledWith(
          expect.objectContaining({
            tripId: fx.tripId,
            named: true,
            removeOutside: false,
            assetIds: ["nv-1", "sb-1"],
          })
        );
        expect(mockWriteAlbum).not.toHaveBeenCalled();
        expect(await prisma.tripImmichAlbum.count({ where: { tripId: fx.tripId } })).toBe(1);
      }
    );
  });

  it("syncs when another trip of the journey repeats a city's title on other dates", async () => {
    // The owner's journeys split into trips that repeat hub cities (finding
    // NEW-1): a "Northvale" stand on a June trip of the same journey is the
    // same place on other days, not a write across rows. The trip syncs and
    // only its own row changes; the other trip's row and station are
    // byte-identical.
    await withDecoyRoute(
      "Northvale again",
      { title: "Northvale", at: FX.northvale, startDay: "2031-06-01", endDay: "2031-06-02" },
      async (decoy) => {
        const plan = await planFor();
        expect(plan.existing?.roadtrips.map((w) => w.roadtripId)).toEqual([fx.roadtripId]);
        const before = {
          row: await prisma.tripRoute.findUniqueOrThrow({ where: { id: decoy.routeId } }),
          station: await prisma.tripStop.findUniqueOrThrow({ where: { id: decoy.stationId } }),
        };

        const written = await writeCommit(plan);

        expect(written.roadtrips).toHaveLength(1);
        expect(written.roadtrips[0]).toMatchObject({ id: fx.roadtripId, stations: 5 });
        expect(await prisma.tripRoute.findUniqueOrThrow({ where: { id: decoy.routeId } })).toEqual(
          before.row
        );
        expect(await prisma.tripStop.findUniqueOrThrow({ where: { id: decoy.stationId } })).toEqual(
          before.station
        );
      }
    );
  });

  it("refuses when the other trip's station only touches the scanned days at one day", async () => {
    // The boundary of `daysOverlap`: a stored span ENDING on the derived
    // span's first day shares that day, so it still stands on this write. The
    // body (fixture-built) names the stop the scan left out; the guard reads
    // what the write plan carries.
    await withDecoyRoute(
      "Northvale touch",
      { title: "Northvale", at: FX.northvale, startDay: "2031-05-01", endDay: "2031-05-02" },
      async () => {
        await expect(planFor()).rejects.toMatchObject({
          statusCode: 409,
          code: "ROUTE_SCOPE_CONFLICT",
        });
      }
    );
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

  it("runs the whole commit: the journey's derived status is the one field that moves", async () => {
    const draftForPlan = await scopedDraft();
    const plan = await prepareCommit(fx.userId, draftForPlan, body());
    const before = {
      trip: await prisma.trip.findUniqueOrThrow({ where: { id: fx.tripId } }),
      otherRoute: await prisma.tripRoute.findUniqueOrThrow({ where: { id: otherRouteId } }),
      otherStations: await prisma.tripStop.findMany({
        where: { routeId: otherRouteId },
        orderBy: { routeOrderIdx: "asc" },
      }),
      otherLegs: await prisma.tripRouteLeg.findMany({
        where: { routeId: otherRouteId },
        orderBy: { id: "asc" },
      }),
      timelineStops: await prisma.tripStop.findMany({
        where: { tripId: fx.tripId, routeId: null },
        orderBy: { orderIdx: "asc" },
      }),
      flight: await prisma.flight.findUniqueOrThrow({ where: { id: fx.flightId } }),
      albums: await prisma.tripImmichAlbum.findMany({ where: { tripId: fx.tripId } }),
    };

    // Mid-trip, so phase C's `recomputeTripStatus` really writes: the trip's
    // held days derive `in_progress` where the stored row says `planned`.
    setClockForTests("2031-05-05T00:00:00Z");
    const written = await runCommitJob(draftForPlan, plan).finally(() => setClockForTests(null));

    if (written.status !== "committed") throw new Error("the commit did not write");
    // The target roadtrip DID update (Southbridge is new; its diff says so).
    expect(written.roadtrips).toHaveLength(1);
    expect(written.roadtrips[0]).toMatchObject({ id: fx.roadtripId, stations: 5 });
    expect(written.roadtrips[0].diff).toMatchObject({ added: 1, kept: 1 });
    expect(written.stops).toBeUndefined();
    // Phase D ran for the scoped target — the trip's own album, by name,
    // add-only — through the mock, so the whole job really is the path here,
    // and no new album was written.
    expect(mockResync).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: fx.tripId, named: true, removeOutside: false })
    );
    expect(mockWriteAlbum).not.toHaveBeenCalled();

    // The ONE documented exception (finding NEW-2): phase C's recompute writes
    // the journey's DERIVED status when the trip's held days derive another one
    // — here `planned` → `in_progress` (the clock is pinned mid-trip) — and the
    // `updatedAt` of that same row write moves with it. The derived status is a
    // reflection of the trip's own rows, not a journey edit. Every other field
    // of the journey row — name, colour, dates, zones, countries, the summary
    // trio, tags, companions, notes, description, category — is byte-identical,
    // as are the other roadtrip (row, stations, legs), the track rows, the
    // flight and the album links.
    const tripRow = await prisma.trip.findUniqueOrThrow({ where: { id: fx.tripId } });
    const { status, updatedAt, ...tripRest } = tripRow;
    const { status: beforeStatus, updatedAt: beforeUpdatedAt, ...beforeTripRest } = before.trip;
    expect(strip(tripRest)).toEqual(strip(beforeTripRest));
    expect(beforeStatus).toBe("planned");
    expect(status).toBe("in_progress");
    expect(updatedAt).not.toEqual(beforeUpdatedAt);

    const otherRoute = await prisma.tripRoute.findUniqueOrThrow({ where: { id: otherRouteId } });
    expect(strip(otherRoute)).toEqual(strip(before.otherRoute));
    const otherStations = await prisma.tripStop.findMany({
      where: { routeId: otherRouteId },
      orderBy: { routeOrderIdx: "asc" },
    });
    expect(otherStations.map(strip)).toEqual(before.otherStations.map(strip));
    const otherLegs = await prisma.tripRouteLeg.findMany({
      where: { routeId: otherRouteId },
      orderBy: { id: "asc" },
    });
    expect(otherLegs.map(strip)).toEqual(before.otherLegs.map(strip));
    const timelineStops = await prisma.tripStop.findMany({
      where: { tripId: fx.tripId, routeId: null },
      orderBy: { orderIdx: "asc" },
    });
    expect(timelineStops.map(strip)).toEqual(before.timelineStops.map(strip));
    expect(strip(await prisma.flight.findUniqueOrThrow({ where: { id: fx.flightId } }))).toEqual(
      strip(before.flight)
    );
    const albums = await prisma.tripImmichAlbum.findMany({ where: { tripId: fx.tripId } });
    expect(albums.map(strip)).toEqual(before.albums.map(strip));
  });
});
