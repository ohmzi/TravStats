jest.mock("../../services/tripBuilder/commit", () => ({ runCommitJob: jest.fn() }));
jest.mock("../../services/domainVisibility", () => ({
  ...jest.requireActual("../../services/domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { loadVisibleDomains } from "../../services/domainVisibility";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { runCommitJob } from "../../services/tripBuilder/commit";
import {
  clearDraftsForTests,
  finishCommit,
  getDraft,
  putDraft,
} from "../../services/tripBuilder/draftStore";
import type { CommitResult } from "../../services/tripBuilder/types";
import { setClockForTests } from "../../shared/time/clock";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";
import {
  COMMIT_KEY,
  CREATED_AT,
  DRAFT_ID,
  K_SB,
  OTHER_COMMIT_KEY,
  fixtureBody,
  fixtureDraft,
} from "../../services/tripBuilder/__tests__/commitFixtures";

const mockRun = runCommitJob as jest.Mock;
const mockDomains = loadVisibleDomains as jest.Mock;
const TRIP = "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01";
const RESULT: CommitResult = {
  tripId: TRIP,
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

describe("POST /api/v1/trip-builder/drafts/:id/commit", () => {
  let userId: string;
  let cookie: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-route-commit" } });
    const user = await prisma.user.create({
      data: { username: "tb-route-commit", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
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

  beforeEach(() => {
    jest.clearAllMocks();
    clearJobs();
    clearDraftsForTests();
    setClockForTests(new Date(CREATED_AT + 30 * 60_000));
    mockDomains.mockResolvedValue(["flight", "roadtrip"]);
    mockRun.mockResolvedValue({ status: "committed", ...RESULT });
    putDraft(fixtureDraft(userId, [flightId]));
  });

  afterEach(() => setClockForTests(null));

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-route-commit" } });
    await prisma.$disconnect();
  });

  const post = (body: unknown, id = DRAFT_ID) =>
    request(app)
      .post(`/api/v1/trip-builder/drafts/${id}/commit`)
      .set("Cookie", cookie)
      .send(body as object);
  const valid = () => fixtureBody([flightId]);

  it("starts the commit job, marks the draft committing and hands the job the validated plan", async () => {
    const res = await post(valid());
    expect(res.status).toBe(202);
    expect(getDraft(userId, DRAFT_ID)).toMatchObject({
      status: "committing",
      commitKey: COMMIT_KEY,
      commitJobId: res.body.jobId,
    });

    await settleAllJobs();
    const [draft, plan] = mockRun.mock.calls[0];
    expect(draft.id).toBe(DRAFT_ID);
    expect(plan).toMatchObject({ userId, flightIds: [flightId], unknownNights: 0 });
    expect(plan.roadtrips).toHaveLength(1);
    const job = (await request(app).get(`/api/v1/jobs/${res.body.jobId}`).set("Cookie", cookie))
      .body.data;
    expect(job).toMatchObject({
      kind: "tripBuilder.commit",
      status: "succeeded",
      result: { status: "committed", tripId: TRIP },
    });
  });

  it("answers the same key with the job already running, and another key with 409 COMMIT_IN_PROGRESS", async () => {
    mockRun.mockReturnValue(new Promise(() => undefined));
    const first = await post(valid());
    const again = await post(valid());
    expect(again.status).toBe(202);
    expect(again.body.jobId).toBe(first.body.jobId);
    expect(mockRun).toHaveBeenCalledTimes(1);

    const other = await post({ ...valid(), commitKey: OTHER_COMMIT_KEY });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe("COMMIT_IN_PROGRESS");
  });

  it("answers 409 ALREADY_COMMITTED with the trip once phase B is done, for any key", async () => {
    await post(valid());
    await settleAllJobs();
    finishCommit(DRAFT_ID, RESULT);

    for (const commitKey of [COMMIT_KEY, OTHER_COMMIT_KEY]) {
      const res = await post({ ...valid(), commitKey });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "ALREADY_COMMITTED", tripId: TRIP });
    }
  });

  it("answers 404 DRAFT_EXPIRED for an unknown draft", async () => {
    const res = await post(valid(), "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("DRAFT_EXPIRED");
  });

  it("answers 400 VALIDATION_FAILED for a malformed body, before the draft is touched", async () => {
    const res = await post({ ...valid(), flightIds: "all" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(getDraft(userId, DRAFT_ID)?.status).toBe("ready");
  });

  it("answers 409 WINDOW_CHANGED and leaves the draft ready", async () => {
    const res = await post({
      ...valid(),
      window: { startDay: "2031-05-02", endDay: "2031-05-06" },
    });
    expect([res.status, res.body.code]).toEqual([409, "WINDOW_CHANGED"]);
    expect(getDraft(userId, DRAFT_ID)?.status).toBe("ready");
  });

  it("answers 400 DRAFT_MISMATCH for a flight the draft never offered", async () => {
    const res = await post({ ...valid(), flightIds: ["ff0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b"] });
    expect([res.status, res.body.code, res.body.field]).toEqual([
      400,
      "DRAFT_MISMATCH",
      "flightIds",
    ]);
  });

  it("answers 400 NIGHT_PLAN_INVALID with the first reason", async () => {
    const body = valid();
    body.nights["2031-05-03"] = K_SB;
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "NIGHT_PLAN_INVALID",
      reason: "nightNotAdjacent",
      stationKey: K_SB,
      day: "2031-05-03",
    });
  });

  it("answers 409 ROADTRIPS_HIDDEN while roadtrips are hidden", async () => {
    mockDomains.mockResolvedValue(["flight"]);
    const res = await post(valid());
    expect([res.status, res.body.code]).toEqual([409, "ROADTRIPS_HIDDEN"]);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
