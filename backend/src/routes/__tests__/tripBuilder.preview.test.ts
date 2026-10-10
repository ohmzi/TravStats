jest.mock("../../services/immich/immichResolver", () => ({
  ...jest.requireActual("../../services/immich/immichResolver"),
  getImmichConnection: jest.fn(),
}));
jest.mock("../../services/immich/immichClient", () => ({
  ...jest.requireActual("../../services/immich/immichClient"),
  createImmichClient: jest.fn(() => ({ marker: "client" })),
}));
jest.mock("../../services/immich/assetStream", () => ({
  streamAsset: jest.fn(),
  sendPlaceholder: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { sendPlaceholder, streamAsset } from "../../services/immich/assetStream";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { ImmichError } from "../../services/immich/types";
import { clearDraftsForTests, putDraft } from "../../services/tripBuilder/draftStore";
import { setClockForTests } from "../../shared/time/clock";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";
import {
  CREATED_AT,
  DRAFT_ID,
  fixtureDraft,
} from "../../services/tripBuilder/__tests__/commitFixtures";

const mockStream = streamAsset as jest.Mock;
const mockPlaceholder = sendPlaceholder as jest.Mock;
const mockConnection = getImmichConnection as jest.Mock;

describe("GET /api/v1/trip-builder/drafts/:id/preview/:index/file", () => {
  let userId: string;
  let cookie: string;
  let strangerCookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tb-route-prev", "tb-route-prev-2"] } },
    });
    const make = async (username: string) =>
      prisma.user.create({ data: { username, passwordHash: await hashPassword("password123") } });
    const user = await make("tb-route-prev");
    const stranger = await make("tb-route-prev-2");
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearDraftsForTests();
    setClockForTests(new Date(CREATED_AT + 30 * 60_000));
    putDraft(fixtureDraft(userId));
    mockConnection.mockResolvedValue({
      baseUrl: "http://immich.test",
      apiKey: "key",
      source: "user",
    });
    mockStream.mockImplementation(
      async (res: { setHeader: (k: string, v: string) => void; end: (b: Buffer) => void }) => {
        res.setHeader("Content-Type", "image/webp");
        res.end(Buffer.from("image"));
      }
    );
    mockPlaceholder.mockImplementation(
      (res: { status: (s: number) => { end: () => void } }, status: number) =>
        res.status(status).end()
    );
  });

  afterEach(() => setClockForTests(null));

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tb-route-prev", "tb-route-prev-2"] } },
    });
    await prisma.$disconnect();
  });

  const url = (index: string | number, query = "") =>
    `/api/v1/trip-builder/drafts/${DRAFT_ID}/preview/${index}/file${query}`;

  it("streams the asset the draft holds at that index, never one the request names", async () => {
    const res = await request(app).get(url(1, "?size=preview")).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(mockStream.mock.calls[0].slice(2)).toEqual(["photo-b", "preview", '"photo-b-preview"']);
  });

  it("serves thumbnails by default", async () => {
    await request(app).get(url(0)).set("Cookie", cookie);
    expect(mockStream.mock.calls[0].slice(2, 4)).toEqual(["photo-a", "thumbnail"]);
  });

  it("answers 304 when the browser already has it, without touching Immich", async () => {
    const res = await request(app)
      .get(url(0))
      .set("Cookie", cookie)
      .set("If-None-Match", '"photo-a-thumbnail"');
    expect(res.status).toBe(304);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("refuses an index outside 0 to 399, a non-integer and an original", async () => {
    for (const bad of ["400", "-1", "x", "1.5"]) {
      expect((await request(app).get(url(bad)).set("Cookie", cookie)).status).toBe(400);
    }
    expect((await request(app).get(url(0, "?size=original")).set("Cookie", cookie)).status).toBe(
      400
    );
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("answers 404 for an index past the stored list", async () => {
    const res = await request(app).get(url(2)).set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("answers 404 DRAFT_EXPIRED for a stranger's draft", async () => {
    const res = await request(app).get(url(0)).set("Cookie", strangerCookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("DRAFT_EXPIRED");
  });

  it("answers 409 notConfigured when the connection is gone", async () => {
    mockConnection.mockResolvedValue(null);
    const res = await request(app).get(url(0)).set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "notConfigured" });
  });

  it("paints the placeholder when Immich fails, as the other proxies do", async () => {
    mockStream.mockRejectedValue(new ImmichError("unreachable", "down"));
    await request(app).get(url(0)).set("Cookie", cookie);
    expect(mockPlaceholder.mock.calls[0][1]).toBe(502);

    mockPlaceholder.mockClear();
    mockStream.mockRejectedValue(new ImmichError("notFound", "gone"));
    await request(app).get(url(0)).set("Cookie", cookie);
    expect(mockPlaceholder.mock.calls[0][1]).toBe(404);
  });
});
