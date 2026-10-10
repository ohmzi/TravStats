import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  beginCommit,
  clearDraftsForTests,
  getDraft,
  putDraft,
} from "../../services/tripBuilder/draftStore";
import { setClockForTests } from "../../shared/time/clock";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";
import {
  COMMIT_KEY,
  CREATED_AT,
  DRAFT_ID,
  fixtureDraft,
} from "../../services/tripBuilder/__tests__/commitFixtures";

describe("GET and DELETE /api/v1/trip-builder/drafts/:id", () => {
  let userId: string;
  let cookie: string;
  let strangerCookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tb-route-drafts", "tb-route-drafts-2"] } },
    });
    const make = async (username: string) =>
      prisma.user.create({ data: { username, passwordHash: await hashPassword("password123") } });
    const user = await make("tb-route-drafts");
    const stranger = await make("tb-route-drafts-2");
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
  });

  beforeEach(() => {
    clearDraftsForTests();
    setClockForTests(new Date(CREATED_AT + 30 * 60_000));
    putDraft(fixtureDraft(userId));
  });

  afterEach(() => setClockForTests(null));

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tb-route-drafts", "tb-route-drafts-2"] } },
    });
    await prisma.$disconnect();
  });

  const get = (id: string, c = cookie) =>
    request(app).get(`/api/v1/trip-builder/drafts/${id}`).set("Cookie", c);

  it("answers the draft with its expiry recomputed from the last read", async () => {
    const res = await get(DRAFT_ID);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(DRAFT_ID);
    expect(res.body.areas).toHaveLength(1);
    // Read at 08:30 → idle deadline 10:30, before the six-hour deadline at 14:00.
    expect(res.body.expiresAt).toBe("2031-05-20T10:30:00.000Z");
  });

  it("never carries an Immich asset id", async () => {
    const res = await get(DRAFT_ID);
    expect(JSON.stringify(res.body)).not.toContain("photo-a");
  });

  it("answers 404 DRAFT_EXPIRED for a stranger's draft exactly as for an unknown id", async () => {
    const foreign = await get(DRAFT_ID, strangerCookie);
    const unknown = await get("5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a");
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
    expect(foreign.body.code).toBe("DRAFT_EXPIRED");
  });

  it("answers 404 DRAFT_EXPIRED once the draft has been idle for two hours", async () => {
    setClockForTests(new Date(CREATED_AT + 3 * 3_600_000));
    const res = await get(DRAFT_ID);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("DRAFT_EXPIRED");
  });

  it("refuses an id that is not a uuid", async () => {
    expect((await get("not-a-uuid")).status).toBe(400);
  });

  it("discards the caller's draft with 204, and a stranger's not at all", async () => {
    const stranger = await request(app)
      .delete(`/api/v1/trip-builder/drafts/${DRAFT_ID}`)
      .set("Cookie", strangerCookie);
    expect(stranger.status).toBe(204);
    expect(getDraft(userId, DRAFT_ID)).not.toBeNull();

    const own = await request(app)
      .delete(`/api/v1/trip-builder/drafts/${DRAFT_ID}`)
      .set("Cookie", cookie);
    expect(own.status).toBe(204);
    expect(getDraft(userId, DRAFT_ID)).toBeNull();
  });

  it("leaves a draft that is committing alone", async () => {
    beginCommit(userId, DRAFT_ID, COMMIT_KEY);
    await request(app).delete(`/api/v1/trip-builder/drafts/${DRAFT_ID}`).set("Cookie", cookie);
    expect(getDraft(userId, DRAFT_ID)?.status).toBe("committing");
  });
});
