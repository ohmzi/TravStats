jest.mock("../../services/tripBuilder/buildDraft", () => ({
  ...jest.requireActual("../../services/tripBuilder/buildDraft"),
  buildTripDraft: jest.fn(),
}));
jest.mock("../../services/immich/immichResolver", () => ({
  ...jest.requireActual("../../services/immich/immichResolver"),
  getImmichConnection: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { buildTripDraft } from "../../services/tripBuilder/buildDraft";
import { clearDraftsForTests, getDraft } from "../../services/tripBuilder/draftStore";
import type { StoredDraft } from "../../services/tripBuilder/types";
import { setClockForTests } from "../../shared/time/clock";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";
import { fixtureDraft } from "../../services/tripBuilder/__tests__/commitFixtures";

const mockBuild = buildTripDraft as jest.Mock;
const mockConnection = getImmichConnection as jest.Mock;
const BODY = {
  name: "Northvale loop",
  startDay: "2031-05-02",
  endDay: "2031-05-09",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

describe("POST /api/v1/trip-builder/scan", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-route-scan" } });
    const user = await prisma.user.create({
      data: { username: "tb-route-scan", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearJobs();
    clearDraftsForTests();
    setClockForTests("2031-05-20T08:30:00Z");
    mockConnection.mockResolvedValue({
      baseUrl: "http://immich.test",
      apiKey: "key",
      source: "user",
    });
  });

  afterEach(() => setClockForTests(null));

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-route-scan" } });
    await prisma.$disconnect();
  });

  const post = (body: unknown) =>
    request(app)
      .post("/api/v1/trip-builder/scan")
      .set("Cookie", cookie)
      .send(body as object);
  const job = async (jobId: string) =>
    (await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie)).body.data;

  it("answers 409 notConfigured when the user has no Immich connection", async () => {
    mockConnection.mockResolvedValue(null);
    const res = await post(BODY);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "notConfigured" });
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("refuses a malformed body before any work starts", async () => {
    const res = await post({ ...BODY, inspect: false, createAlbum: false });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("answers 404 for a target trip that is not the caller's", async () => {
    const res = await post({
      ...BODY,
      target: { kind: "existing", tripId: "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01" },
    });
    expect(res.status).toBe(404);
  });

  it("starts a job that reports its step, then stores the draft and answers its id", async () => {
    let release!: (draft: StoredDraft) => void;
    mockBuild.mockImplementation(
      async (_user: string, _input: unknown, report: (phase: string) => void) => {
        report("flights");
        return new Promise<StoredDraft>((resolve) => {
          release = resolve;
        });
      }
    );

    const res = await post(BODY);
    expect(res.status).toBe(202);
    const { jobId } = res.body;
    expect(await job(jobId)).toMatchObject({
      kind: "tripBuilder.scan",
      status: "running",
      progress: { done: 3, total: 7 },
    });
    expect(mockBuild.mock.calls[0][0]).toBe(userId);
    expect(mockBuild.mock.calls[0][1]).toEqual(BODY);

    const draft = fixtureDraft(userId);
    release(draft);
    await settleAllJobs();
    expect(await job(jobId)).toMatchObject({ status: "succeeded", result: { draftId: draft.id } });
    expect(getDraft(userId, draft.id)).not.toBeNull();
  });

  it("fails the job with the builder's own error code", async () => {
    mockBuild.mockRejectedValue(new AppError("immich_unreachable", 502));
    const res = await post(BODY);
    await settleAllJobs();
    expect(await job(res.body.jobId)).toMatchObject({
      status: "failed",
      error: { code: "immich_unreachable", status: 502 },
    });
  });
});
