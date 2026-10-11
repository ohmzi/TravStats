jest.mock("../../services/tripBuilder/albumWrite", () => ({
  ...jest.requireActual("../../services/tripBuilder/albumWrite"),
  retryTripAlbum: jest.fn(),
}));
jest.mock("../../services/tripBuilder/stopoverAlbum", () => ({
  ...jest.requireActual("../../services/tripBuilder/stopoverAlbum"),
  retryStopoverAlbum: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { retryTripAlbum } from "../../services/tripBuilder/albumWrite";
import { clearDraftsForTests, putDraft } from "../../services/tripBuilder/draftStore";
import { retryStopoverAlbum } from "../../services/tripBuilder/stopoverAlbum";
import type { CommitResult, StoredStopover } from "../../services/tripBuilder/types";
import {
  fixtureDraft,
  fixtureStoredStopover,
  IMMICH_USER,
  STOPOVER_KEY,
} from "../../services/tripBuilder/__tests__/commitFixtures";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

const mockRetry = retryTripAlbum as jest.Mock;
const mockStopoverRetry = retryStopoverAlbum as jest.Mock;
const OUTCOME = {
  status: "linked",
  immichAlbumId: "album-1",
  albumName: "Northvale loop",
  reused: true,
  added: 0,
  alreadyIn: 2,
  refused: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearJobs();
  clearDraftsForTests();
  mockRetry.mockResolvedValue(OUTCOME);
});

describe("POST /api/v1/trip-builder/trips/:tripId/album", () => {
  let userId: string;
  let cookie: string;
  let tripId: string;
  let otherTripId: string;
  let foreignTripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tb-route-album", "tb-route-album-2"] } },
    });
    const make = async (username: string) =>
      prisma.user.create({ data: { username, passwordHash: await hashPassword("password123") } });
    const user = await make("tb-route-album");
    const stranger = await make("tb-route-album-2");
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Northvale loop" } })).id;
    otherTripId = (await prisma.trip.create({ data: { userId, name: "Port Carrow weekend" } })).id;
    foreignTripId = (await prisma.trip.create({ data: { userId: stranger.id, name: "Theirs" } }))
      .id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tb-route-album", "tb-route-album-2"] } },
    });
    await prisma.$disconnect();
  });

  const post = (id: string, body: unknown = {}) =>
    request(app)
      .post(`/api/v1/trip-builder/trips/${id}/album`)
      .set("Cookie", cookie)
      .send(body as object);

  /** A committed draft of `tripId` whose scan offered one stopover. */
  const committedStopoverDraft = (): void => {
    const result: CommitResult = {
      tripId,
      created: true,
      roadtrips: [],
      stopIds: [],
      flightsAssigned: 0,
      flightsMovedFrom: [],
      routing: { routed: 0, straight: 0, ferry: 0, providerAvailable: false },
      photoJourneysResolved: 0,
      unknownNights: 0,
      album: { status: "skipped", skipReason: "notRequested" },
    };
    putDraft(
      fixtureDraft(userId, [], {
        stopovers: [fixtureStoredStopover()],
        status: "committed",
        result,
      })
    );
  };

  it("retries the stopover's own album when the key names one of the draft's stopovers", async () => {
    committedStopoverDraft();
    mockStopoverRetry.mockResolvedValue(OUTCOME);

    expect((await post(tripId, { stopoverKey: STOPOVER_KEY })).status).toBe(202);
    await settleAllJobs();

    expect(mockStopoverRetry).toHaveBeenCalledWith({
      userId,
      tripId,
      tripName: "Northvale loop",
      stopover: fixtureStoredStopover(),
      expectedImmichUserId: IMMICH_USER,
    });
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it("keeps the trip's own album when only a name is posted", async () => {
    committedStopoverDraft();

    await post(tripId, { name: "Northvale photos" });
    await settleAllJobs();

    expect(mockRetry).toHaveBeenCalledWith(userId, tripId, "Northvale photos", false);
    expect(mockStopoverRetry).not.toHaveBeenCalled();
  });

  it("answers a second press for the same stopover with the running job (one album job at a time)", async () => {
    committedStopoverDraft();
    mockStopoverRetry.mockReturnValue(new Promise(() => undefined));

    const first = await post(tripId, { stopoverKey: STOPOVER_KEY });
    const again = await post(tripId, { stopoverKey: STOPOVER_KEY });

    expect(again.status).toBe(202);
    expect(again.body.jobId).toBe(first.body.jobId);
    expect(mockStopoverRetry).toHaveBeenCalledTimes(1);
  });

  it("starts an album job whose result is the outcome", async () => {
    const res = await post(tripId, { name: "Northvale photos" });
    expect(res.status).toBe(202);
    await settleAllJobs();
    expect(mockRetry).toHaveBeenCalledWith(userId, tripId, "Northvale photos", false);
    const job = (await request(app).get(`/api/v1/jobs/${res.body.jobId}`).set("Cookie", cookie))
      .body.data;
    expect(job).toMatchObject({ kind: "tripBuilder.album", status: "succeeded", result: OUTCOME });
  });

  it("takes no body at all", async () => {
    expect((await post(tripId)).status).toBe(202);
    await settleAllJobs();
    expect(mockRetry).toHaveBeenCalledWith(userId, tripId, undefined, false);
  });

  it("carries the review's removal choice to the retry", async () => {
    expect((await post(tripId, { removeOutside: true })).status).toBe(202);
    await settleAllJobs();
    expect(mockRetry).toHaveBeenCalledWith(userId, tripId, undefined, true);
  });

  it("answers 404 for a trip that is not the caller's, before any job starts", async () => {
    const res = await post(foreignTripId);
    expect(res.status).toBe(404);
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it("refuses a body with a field it does not know, an empty name and an id that is no uuid", async () => {
    expect((await post(tripId, { name: "x", extra: 1 })).status).toBe(400);
    expect((await post(tripId, { name: "" })).status).toBe(400);
    expect((await post(tripId, { removeOutside: "yes" })).status).toBe(400);
    expect((await post("not-a-uuid")).status).toBe(400);
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it("answers a second press while a retry runs with the running job and starts nothing", async () => {
    mockRetry.mockReturnValue(new Promise(() => undefined));
    const first = await post(tripId);
    const again = await post(tripId, { name: "Another name" });
    expect(again.status).toBe(202);
    expect(again.body.jobId).toBe(first.body.jobId);
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(mockRetry).toHaveBeenCalledWith(userId, tripId, undefined, false);
  });

  it("collapses two presses made in the same instant into one job", async () => {
    mockRetry.mockReturnValue(new Promise(() => undefined));
    const [a, b] = await Promise.all([post(tripId), post(tripId)]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.body.jobId).toBe(b.body.jobId);
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it("starts a new job once the running one has settled", async () => {
    const first = await post(tripId);
    await settleAllJobs();
    const second = await post(tripId);
    await settleAllJobs();
    expect(second.status).toBe(202);
    expect(second.body.jobId).not.toBe(first.body.jobId);
    expect(mockRetry).toHaveBeenCalledTimes(2);
  });

  it("lets another trip's retry run while one is running", async () => {
    mockRetry.mockReturnValue(new Promise(() => undefined));
    const first = await post(tripId);
    const other = await post(otherTripId);
    expect(other.body.jobId).not.toBe(first.body.jobId);
    expect(mockRetry).toHaveBeenCalledTimes(2);
  });
});

/**
 * The refusal half of the same route: a stopover key resolves only against
 * the committed draft that wrote the trip, and a key nothing resolves is
 * refused. Once that record is gone — a restart, the sweep past its TTL, or a
 * later commit that offered no stopovers, all reachable while the success
 * panel is still open — the old inference from the posted name silently
 * re-synced (or created) an album that was not the stopover's, with the panel
 * showing that outcome as its repair (final review, findings S2-1/S2-2). Its
 * own caller keeps this block off the first caller's rate-limit budget.
 */
describe("POST /api/v1/trip-builder/trips/:tripId/album — a stopover key nothing resolves", () => {
  let ownerId: string;
  let ownerCookie: string;
  let ownerTripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-route-album-3" } });
    const owner = await prisma.user.create({
      data: { username: "tb-route-album-3", passwordHash: await hashPassword("password123") },
    });
    ownerId = owner.id;
    ownerCookie = `auth_token=${generateToken(owner.id)}`;
    ownerTripId = (
      await prisma.trip.create({ data: { userId: ownerId, name: "Selby Bay weekend" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-route-album-3" } });
    await prisma.$disconnect();
  });

  const refused = (body: unknown) =>
    request(app)
      .post(`/api/v1/trip-builder/trips/${ownerTripId}/album`)
      .set("Cookie", ownerCookie)
      .send(body as object);

  /** A committed draft of this caller's trip; `stopovers` only when given. */
  const committedDraft = (stopovers?: StoredStopover[]): void => {
    const result: CommitResult = {
      tripId: ownerTripId,
      created: true,
      roadtrips: [],
      stopIds: [],
      flightsAssigned: 0,
      flightsMovedFrom: [],
      routing: { routed: 0, straight: 0, ferry: 0, providerAvailable: false },
      photoJourneysResolved: 0,
      unknownNights: 0,
      album: { status: "skipped", skipReason: "notRequested" },
    };
    putDraft(
      fixtureDraft(ownerId, [], {
        ...(stopovers ? { stopovers } : {}),
        status: "committed",
        result,
      })
    );
  };

  it("answers 409 STOPOVER_EXPIRED once the committed draft is gone, and touches no album", async () => {
    // The draft is in memory only: a restart empties it and its 2h/6h TTL
    // sweeps it. The old fallback then re-synced the trip's album (or made
    // one under the city album's posted name) with no error shown.
    committedDraft([fixtureStoredStopover()]);
    clearDraftsForTests();

    const res = await refused({ stopoverKey: STOPOVER_KEY });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "STOPOVER_EXPIRED" });
    expect(mockRetry).not.toHaveBeenCalled();
    expect(mockStopoverRetry).not.toHaveBeenCalled();
  });

  it("answers 409 when the newest committed draft offered no stopovers", async () => {
    committedDraft();

    const res = await refused({ stopoverKey: STOPOVER_KEY });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "STOPOVER_EXPIRED" });
    expect(mockRetry).not.toHaveBeenCalled();
    expect(mockStopoverRetry).not.toHaveBeenCalled();
  });

  it("refuses a key that is no stopover key at all", async () => {
    expect((await refused({ stopoverKey: "not-a-key" })).status).toBe(400);
    expect(mockRetry).not.toHaveBeenCalled();
    expect(mockStopoverRetry).not.toHaveBeenCalled();
  });

  it("never reads a posted name as a stopover", async () => {
    // The key is the only thing that names a stopover (finding S2-2): the
    // trip's album name may coincide with a stopover's title, and a bare
    // name must stay the trip's own album.
    committedDraft([fixtureStoredStopover()]);

    await refused({ name: "Port Carrow 2031 Road Trip" });
    await settleAllJobs();

    expect(mockRetry).toHaveBeenCalledWith(
      ownerId,
      ownerTripId,
      "Port Carrow 2031 Road Trip",
      false
    );
    expect(mockStopoverRetry).not.toHaveBeenCalled();
  });
});
