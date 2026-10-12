jest.mock("../albumWrite", () => ({
  ...jest.requireActual("../albumWrite"),
  preflightAlbum: jest.fn(),
  writeTripAlbum: jest.fn(),
}));
jest.mock("../albumResync", () => ({
  ...jest.requireActual("../albumResync"),
  resyncTripAlbum: jest.fn(),
}));
jest.mock("../stopoverAlbum", () => ({
  ...jest.requireActual("../stopoverAlbum"),
  writePitstopAlbum: jest.fn(),
}));
jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(),
}));

import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { setClockForTests } from "../../../shared/time/clock";
import { hashPassword } from "../../../utils/password";
import * as replaceModule from "../../roadtrip/replaceStations";
import { resolveRouteProvider } from "../../tour/routing/resolveProvider";
import { resyncTripAlbum } from "../albumResync";
import { preflightAlbum, writeTripAlbum } from "../albumWrite";
import { runCommitJob } from "../commit";
import { beginCommit, clearDraftsForTests, getDraft, putDraft } from "../draftStore";
import { writePitstopAlbum } from "../stopoverAlbum";
import type { ExistingCommitPlan, StoredExisting } from "../existingTypes";
import {
  AREA_KEY,
  COMMIT_KEY,
  CREATED_AT,
  DRAFT_ID,
  JOURNEY_ID,
  OTHER_COMMIT_KEY,
  PITSTOP_ALBUM,
  fixtureDraft,
  fixturePlan,
  fixtureStopoverPlan,
  fixtureStoredPitstop,
  fixtureStoredStopover,
} from "./commitFixtures";
import { addStation, FX } from "./existingDb";

const mockPreflight = preflightAlbum as jest.Mock;
const mockWriteAlbum = writeTripAlbum as jest.Mock;
const mockResync = resyncTripAlbum as jest.Mock;
const mockPitstopAlbum = writePitstopAlbum as jest.Mock;
const mockProvider = resolveRouteProvider as jest.Mock;
const ALBUM = {
  status: "linked",
  immichAlbumId: "album-1",
  albumName: "Northvale loop",
  reused: false,
  added: 2,
  alreadyIn: 0,
  refused: 0,
};

describe("runCommitJob", () => {
  let userId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-job" } });
    userId = (
      await prisma.user.create({
        data: { username: "tb-job", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    clearDraftsForTests();
    setClockForTests("2031-12-01T00:00:00Z");
    mockProvider.mockResolvedValue(null);
    mockPreflight.mockResolvedValue({ ok: true, client: {}, immichUserId: "immich-user" });
    mockWriteAlbum.mockResolvedValue(ALBUM);
    mockResync.mockResolvedValue({ ...ALBUM, reused: true, removed: 0 });
    mockPitstopAlbum.mockResolvedValue({ status: "linked", added: 2, alreadyIn: 0 });
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          flightNumber: "ZZ101",
          depLat: -44.72,
          depLon: 169.17,
          arrLat: -38.02,
          arrLon: 177.01,
        },
      })
    ).id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    setClockForTests(null);
    await prisma.photoJourney.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  /** Puts the draft in the store and begins the commit, as the route does. */
  function begin(albumCreate: boolean, extra: Partial<ReturnType<typeof fixturePlan>> = {}) {
    const draft = fixtureDraft(userId, [flightId], { createdAt: CREATED_AT });
    setClockForTests(new Date(CREATED_AT + 60_000));
    putDraft(draft);
    beginCommit(userId, DRAFT_ID, COMMIT_KEY);
    const plan = {
      ...fixturePlan(userId, [flightId]),
      album: { create: albumCreate, name: "Northvale loop" },
      ...extra,
    };
    return { draft, plan };
  }

  it("writes the trip, links the album and answers one committed result", async () => {
    const { draft, plan } = begin(true);

    const result = await runCommitJob(draft, { ...plan, unknownNights: 2 });

    expect(result).toMatchObject({
      status: "committed",
      created: true,
      flightsAssigned: 1,
      unknownNights: 2,
      album: ALBUM,
      routing: { routed: 0, straight: 1, ferry: 1, providerAvailable: false },
    });
    if (result.status !== "committed") throw new Error("unreachable");
    expect(await prisma.trip.count({ where: { id: result.tripId } })).toBe(1);
    expect(mockPreflight).toHaveBeenCalledWith(userId, draft.immichUserId);
    expect(mockWriteAlbum).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: result.tripId,
        albumName: "Northvale loop",
        description: "TravStats trip · 2031-05-02 – 2031-05-05",
        assetIds: ["photo-a", "photo-b"],
        immichUserId: "immich-user",
      })
    );
    expect(getDraft(userId, DRAFT_ID)?.status).toBe("committed");
  });

  it("skips Immich entirely when no album was asked for", async () => {
    const { draft, plan } = begin(false);
    const result = await runCommitJob(draft, plan);
    expect(result).toMatchObject({
      status: "committed",
      album: { status: "skipped", skipReason: "notRequested" },
    });
    expect(mockPreflight).not.toHaveBeenCalled();
    expect(mockWriteAlbum).not.toHaveBeenCalled();
  });

  it("is blocked before any write when the preflight says so, and the draft can be committed again", async () => {
    mockPreflight.mockResolvedValue({
      ok: false,
      blocked: { status: "blocked", reason: "missingScopes", missingScopes: ["album.create"] },
    });
    const { draft, plan } = begin(true);

    const result = await runCommitJob(draft, plan);

    expect(result).toEqual({
      status: "blocked",
      reason: "missingScopes",
      missingScopes: ["album.create"],
    });
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: flightId } })).tripId).toBeNull();
    expect(getDraft(userId, DRAFT_ID)?.status).toBe("ready");
    expect(beginCommit(userId, DRAFT_ID, OTHER_COMMIT_KEY)).toEqual({ kind: "start" });
  });

  it("fails with COMMIT_FAILED when phase B rolls back, and returns the draft to ready", async () => {
    jest
      .spyOn(replaceModule, "replaceStationsInTx")
      .mockRejectedValueOnce(new Error("station write failed"));
    const { draft, plan } = begin(false);

    await expect(runCommitJob(draft, plan)).rejects.toMatchObject({
      statusCode: 500,
      code: "COMMIT_FAILED",
    });

    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
    expect(getDraft(userId, DRAFT_ID)?.status).toBe("ready");
  });

  it("keeps a TRIP_CHANGED code from phase B instead of the generic COMMIT_FAILED", async () => {
    // The write's in-transaction guard refuses a plan the trip moved past. The
    // page offers a new scan on that code, so the job must not flatten it into
    // the generic failure.
    jest
      .spyOn(replaceModule, "replaceStationsInTx")
      .mockRejectedValueOnce(
        new AppError("The trip changed since the scan — scan again", 409, "TRIP_CHANGED")
      );
    const { draft, plan } = begin(false);

    await expect(runCommitJob(draft, plan)).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_CHANGED",
    });

    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
    expect(getDraft(userId, DRAFT_ID)?.status).toBe("ready");
  });

  it("keeps the trip committed when the album step throws, and refuses a second commit", async () => {
    mockWriteAlbum.mockRejectedValue(new Error("immich exploded"));
    const { draft, plan } = begin(true);

    const result = await runCommitJob(draft, plan);

    expect(result).toMatchObject({
      status: "committed",
      album: { status: "failed", error: { kind: "internal" } },
    });
    if (result.status !== "committed") throw new Error("unreachable");
    expect(getDraft(userId, DRAFT_ID)?.status).toBe("committed");
    expect(beginCommit(userId, DRAFT_ID, OTHER_COMMIT_KEY)).toMatchObject({
      kind: "committed",
      result: { tripId: result.tripId },
    });
    expect(await prisma.trip.count({ where: { userId } })).toBe(1);
  });

  it("keeps the trip committed when routing fails, reporting the legs as unrouted", async () => {
    mockProvider.mockRejectedValue(new Error("routing down"));
    const { draft, plan } = begin(false);

    const result = await runCommitJob(draft, plan);

    expect(result).toMatchObject({
      status: "committed",
      routing: { routed: 0, straight: 1, ferry: 1, providerAvailable: false },
    });
    expect(getDraft(userId, DRAFT_ID)?.status).toBe("committed");
  });

  it("recomputes the status of the trip a flight was moved off", async () => {
    const old = await prisma.trip.create({
      data: {
        userId,
        name: "Old trip",
        status: "planned",
        startDate: new Date("2031-05-02T00:00:00.000Z"),
        endDate: new Date("2031-05-05T00:00:00.000Z"),
      },
    });
    await prisma.flight.update({ where: { id: flightId }, data: { tripId: old.id } });
    const { draft, plan } = begin(false);

    const result = await runCommitJob(draft, plan);

    expect(result).toMatchObject({ flightsMovedFrom: [{ tripId: old.id, name: "Old trip" }] });
    // Pinned at 2031-12-01, a trip that ended in May is completed, not planned.
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "completed"
    );
  });

  it("accepts the ticked photo-journey findings of the window", async () => {
    await prisma.photoJourney.create({
      data: {
        id: JOURNEY_ID,
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
        fingerprint: "fp-job",
      },
    });
    const { draft, plan } = begin(false, { photoJourneyIds: [JOURNEY_ID] });

    const result = await runCommitJob(draft, plan);

    expect(result).toMatchObject({ status: "committed", photoJourneysResolved: 1 });
    expect(
      (await prisma.photoJourney.findUniqueOrThrow({ where: { id: JOURNEY_ID } })).status
    ).toBe("accepted");
  });

  it("gives each toggled stopover its own album, reusing the preflight the trip's album took", async () => {
    const { draft, plan } = begin(true, { stopovers: [fixtureStopoverPlan()] });

    const result = await runCommitJob(draft, plan);

    expect(result).toMatchObject({
      status: "committed",
      stopoverAlbums: [
        {
          key: fixtureStopoverPlan().key,
          name: "Northvale loop · Port Carrow",
          album: { status: "linked", added: 2, alreadyIn: 0 },
        },
      ],
    });
    if (result.status !== "committed") throw new Error("the commit did not write");
    expect(mockPreflight).toHaveBeenCalledTimes(1);
    expect(mockPitstopAlbum).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        tripId: result.tripId,
        tripName: "Northvale loop",
        name: "Northvale loop · Port Carrow",
        day: "2031-05-03",
        assetIds: ["photo-a", "photo-b"],
        immichUserId: "immich-user",
      })
    );
  });

  it("makes a stopover album's blocked preflight its own line, and still commits the trip", async () => {
    const { draft, plan } = begin(false, { stopovers: [fixtureStopoverPlan()] });
    mockPreflight.mockResolvedValue({
      ok: false,
      blocked: { status: "blocked", reason: "missingScopes", missingScopes: ["album.create"] },
    });

    const result = await runCommitJob(draft, plan);

    expect(result).toMatchObject({
      status: "committed",
      album: { status: "skipped", skipReason: "notRequested" },
      stopoverAlbums: [
        {
          name: "Northvale loop · Port Carrow",
          album: { status: "blocked", error: { kind: "auth", missingScope: "album.create" } },
        },
      ],
    });
    expect(mockPitstopAlbum).not.toHaveBeenCalled();
  });

  it("gives a pitstop area its own album, from the area's own photo set", async () => {
    const base = fixturePlan(userId, [flightId]);
    const { draft, plan } = begin(false, {
      roadtrips: [
        {
          ...base.roadtrips[0],
          album: { name: PITSTOP_ALBUM, assetIds: ["photo-a", "photo-b"] },
        },
      ],
    });

    const result = await runCommitJob({ ...draft, pitstops: [fixtureStoredPitstop()] }, plan);

    expect(result).toMatchObject({
      status: "committed",
      pitstopAlbums: [
        {
          key: AREA_KEY,
          name: PITSTOP_ALBUM,
          album: { status: "linked", added: 2, alreadyIn: 0 },
        },
      ],
    });
    if (result.status !== "committed") throw new Error("the commit did not write");
    expect(mockPitstopAlbum).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        tripId: result.tripId,
        tripName: "Northvale loop",
        name: PITSTOP_ALBUM,
        day: "2031-05-02",
        assetIds: ["photo-a", "photo-b"],
        immichUserId: "immich-user",
      })
    );
  });

  it("makes a pitstop album's blocked preflight its own line, and still commits the trip", async () => {
    const base = fixturePlan(userId, [flightId]);
    const { draft, plan } = begin(false, {
      roadtrips: [
        {
          ...base.roadtrips[0],
          album: { name: PITSTOP_ALBUM, assetIds: ["photo-a", "photo-b"] },
        },
      ],
    });
    mockPreflight.mockResolvedValue({
      ok: false,
      blocked: { status: "blocked", reason: "missingScopes", missingScopes: ["album.create"] },
    });

    const result = await runCommitJob({ ...draft, pitstops: [fixtureStoredPitstop()] }, plan);

    expect(result).toMatchObject({
      status: "committed",
      album: { status: "skipped", skipReason: "notRequested" },
      pitstopAlbums: [
        {
          key: AREA_KEY,
          name: PITSTOP_ALBUM,
          album: { status: "blocked", error: { kind: "auth", missingScope: "album.create" } },
        },
      ],
    });
    expect(mockPitstopAlbum).not.toHaveBeenCalled();
  });

  describe("phase D for an existing trip", () => {
    /** A re-sync commit of the fixture plan into a stored trip, as the review page would send it. */
    async function beginExisting(removeOutside: boolean, scanned: StoredExisting["album"]) {
      const trip = await prisma.trip.create({
        data: { userId, name: "Northvale loop", countries: ["NZ"] },
      });
      const { draft, plan } = begin(true, {
        target: {
          kind: "existing",
          tripId: trip.id,
          tripName: "Northvale loop",
          applyWindow: false,
          countries: ["NZ"],
        },
        existing: {
          tripId: trip.id,
          // The trip this fixture makes holds no timeline stops for a re-sync.
          offeredStopIds: [],
          roadtrips: [],
          stopovers: [],
          stopUpdates: [],
          stopRemoveIds: [],
          stopsDiff: { updated: 0, unchanged: 0, added: 0, removed: 0, kept: 0 },
          album: { removeOutside },
        },
      });
      const existing: StoredExisting = {
        tripId: trip.id,
        roadtrips: new Map(),
        stopovers: new Map(),
        stops: { matchedIds: new Set(), notSeenIds: new Set() },
        album: scanned,
      };
      return { trip, plan, draft: { ...draft, existing } };
    }

    it("writes a matched stopover's city album from the plan's existing entry, add-only", async () => {
      // The re-sync split a matched stopover into `plan.existing.stopovers`
      // (spec §6): its roadtrip is written nowhere, but phase D still adds the
      // scan's pictures to its own album — never a removal.
      const { trip, draft, plan } = await beginExisting(false, null);
      const route = await prisma.tripRoute.create({
        data: {
          userId,
          tripId: trip.id,
          name: "Northvale loop · Port Carrow",
          mode: "road",
          kind: "roadtrip",
          vehicle: "car",
        },
        select: { id: true },
      });
      const stationIds = [
        await addStation(route.id, 0, {
          title: "ZPC airport",
          at: FX.portCarrow,
          startDay: "2031-05-03",
          endDay: "2031-05-03",
        }),
        await addStation(route.id, 1, {
          title: "Port Carrow",
          at: FX.portCarrow,
          startDay: "2031-05-03",
          endDay: "2031-05-03",
        }),
      ];
      const matched: ExistingCommitPlan = {
        tripId: trip.id,
        offeredStopIds: [],
        roadtrips: [],
        stopovers: [
          {
            key: fixtureStopoverPlan().key,
            roadtripId: route.id,
            name: "Northvale loop · Port Carrow",
            offeredIds: stationIds,
            album: { name: "Northvale loop · Port Carrow", assetIds: ["photo-a", "photo-b"] },
          },
        ],
        stopUpdates: [],
        stopRemoveIds: [],
        stopsDiff: { updated: 0, unchanged: 0, added: 0, removed: 0, kept: 0 },
        album: { removeOutside: false },
      };

      const result = await runCommitJob(
        { ...draft, stopovers: [fixtureStoredStopover()] },
        { ...plan, stopovers: [], existing: matched }
      );

      expect(result).toMatchObject({
        status: "committed",
        stopoverAlbums: [
          {
            key: fixtureStopoverPlan().key,
            name: "Northvale loop · Port Carrow",
            album: { status: "linked", added: 2, alreadyIn: 0 },
          },
        ],
      });
      expect(mockPitstopAlbum).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId: trip.id,
          name: "Northvale loop · Port Carrow",
          // The draft's own stopover carries the day the album stands for.
          day: "2031-05-03",
          assetIds: ["photo-a", "photo-b"],
        })
      );
    });

    it("writes a matched pitstop area's album from the plan's existing entry, add-only", async () => {
      // Spec 2026-10-11 pitstops §5: the roadtrip is the area's §K diff's
      // business — here a no-op — but the album still takes the scan's photos.
      const { trip, draft, plan } = await beginExisting(false, null);
      const route = await prisma.tripRoute.create({
        data: {
          userId,
          tripId: trip.id,
          name: PITSTOP_ALBUM,
          mode: "road",
          kind: "roadtrip",
          vehicle: "car",
        },
        select: { id: true },
      });
      const matched: ExistingCommitPlan = {
        tripId: trip.id,
        offeredStopIds: [],
        roadtrips: [
          {
            areaKey: AREA_KEY,
            roadtripId: route.id,
            name: PITSTOP_ALBUM,
            expectedName: PITSTOP_ALBUM,
            rename: false,
            stations: [],
            offeredIds: [],
            legModes: [],
            resetLegs: [],
            noop: true,
            diff: { updated: 0, unchanged: 0, added: 0, removed: 0, kept: 0 },
            album: { name: PITSTOP_ALBUM, assetIds: ["photo-a", "photo-b"] },
          },
        ],
        stopovers: [],
        stopUpdates: [],
        stopRemoveIds: [],
        stopsDiff: { updated: 0, unchanged: 0, added: 0, removed: 0, kept: 0 },
        album: { removeOutside: false },
      };

      const result = await runCommitJob(
        { ...draft, pitstops: [fixtureStoredPitstop()] },
        { ...plan, roadtrips: [], existing: matched }
      );

      expect(result).toMatchObject({
        status: "committed",
        pitstopAlbums: [
          {
            key: AREA_KEY,
            name: PITSTOP_ALBUM,
            album: { status: "linked", added: 2, alreadyIn: 0 },
          },
        ],
      });
      expect(mockPitstopAlbum).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId: trip.id,
          name: PITSTOP_ALBUM,
          // The stored record carries the day the album stands for.
          day: "2031-05-02",
          assetIds: ["photo-a", "photo-b"],
        })
      );
    });

    it("re-syncs the trip's album with the ids the scan computed instead of writing a new one", async () => {
      const { trip, draft, plan } = await beginExisting(true, {
        immichAlbumId: "album-1",
        outsideIds: ["o1", "o2"],
      });

      const result = await runCommitJob(draft, plan);

      expect(mockResync).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          tripId: trip.id,
          tripName: "Northvale loop",
          albumName: "Northvale loop",
          window: { startDay: "2031-05-02", endDay: "2031-05-05" },
          assetIds: ["photo-a", "photo-b"],
          outsideIds: ["o1", "o2"],
          scanAlbumId: "album-1",
          removeOutside: true,
          immichUserId: "immich-user",
        })
      );
      expect(mockWriteAlbum).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: "committed",
        created: false,
        album: { status: "linked", reused: true, removed: 0 },
      });
    });

    it("asks for no removal unless the plan carries the switch, and none when the scan saw no album", async () => {
      const { draft, plan } = await beginExisting(false, null);

      await runCommitJob(draft, plan);

      expect(mockResync).toHaveBeenCalledWith(
        expect.objectContaining({ outsideIds: [], scanAlbumId: null, removeOutside: false })
      );
    });

    it("updates the trip's own album, by name and add-only, for a route-scoped plan", async () => {
      // Owner request 2026-10-12: the trip-side Re-sync adds the trip's photos
      // to the album linked under the trip's STORED name — never the journey's
      // album — and removes nothing.
      const { trip, draft, plan } = await beginExisting(false, null);
      const scoped = {
        ...plan,
        target: {
          kind: "existing" as const,
          tripId: trip.id,
          tripName: "Northvale loop",
          routeId: "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
          applyWindow: false,
          countries: ["NZ"],
        },
        roadtrips: [],
        existing: { ...(plan.existing as ExistingCommitPlan), scoped: true, roadtrips: [] },
      };

      const result = await runCommitJob(draft, scoped);

      expect(result).toMatchObject({ status: "committed" });
      expect(mockResync).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId: trip.id,
          albumName: "Northvale loop",
          named: true,
          outsideIds: [],
          removeOutside: false,
        })
      );
      expect(mockWriteAlbum).not.toHaveBeenCalled();
      expect(mockPitstopAlbum).not.toHaveBeenCalled();
    });

    it("keeps the trip committed when the re-sync throws", async () => {
      mockResync.mockRejectedValue(new Error("immich exploded"));
      const { draft, plan } = await beginExisting(false, null);

      const result = await runCommitJob(draft, plan);

      expect(result).toMatchObject({
        status: "committed",
        album: { status: "failed", error: { kind: "internal" } },
      });
    });
  });
});
