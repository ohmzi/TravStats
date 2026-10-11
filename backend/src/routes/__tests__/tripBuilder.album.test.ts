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
import type { CommitResult } from "../../services/tripBuilder/types";
import {
  fixtureDraft,
  fixtureStoredStopover,
  IMMICH_USER,
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

  beforeEach(() => {
    jest.clearAllMocks();
    clearJobs();
    clearDraftsForTests();
    mockRetry.mockResolvedValue(OUTCOME);
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

  it("retries the stopover's own album when the name names one of the draft's stopovers", async () => {
    committedStopoverDraft();
    mockStopoverRetry.mockResolvedValue(OUTCOME);

    expect((await post(tripId, { name: "Port Carrow 2031 Road Trip" })).status).toBe(202);
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

  it("keeps the trip's own album for a name no stopover of the draft carries", async () => {
    committedStopoverDraft();

    await post(tripId, { name: "Northvale photos" });
    await settleAllJobs();

    expect(mockRetry).toHaveBeenCalledWith(userId, tripId, "Northvale photos", false);
    expect(mockStopoverRetry).not.toHaveBeenCalled();
  });

  it("answers a second press for the same stopover with the running job (one album job at a time)", async () => {
    committedStopoverDraft();
    mockStopoverRetry.mockReturnValue(new Promise(() => undefined));

    const first = await post(tripId, { name: "Port Carrow 2031 Road Trip" });
    const again = await post(tripId, { name: "Port Carrow 2031 Road Trip" });

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
