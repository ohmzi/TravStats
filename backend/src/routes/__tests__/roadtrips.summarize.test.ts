import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * POST /roadtrips/:id/summarize (spec 2026-10-12 §6) — the journey's route one
 * level down. The provider is mocked at its transport seam (`llmProbe` and
 * `llmGenerate`), so the whole route runs — auth, ownership, the brief, the
 * stored row — with no Ollama anywhere.
 *
 * Synthetic fixtures only (public repository): Fernhollow, Dunmere.
 */
jest.mock("../../services/llm/llmProvider", () => ({
  ...jest.requireActual("../../services/llm/llmProvider"),
  llmProbe: jest.fn(async () => ({ reachable: true, models: ["fake-model"] })),
  llmGenerate: jest.fn(async () => "Zwei Seen, ein Pass und drei Nächte am Wasser."),
}));

const USERS = ["summarize-roadtripper", "summarize-stranger"];
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("POST /roadtrips/:id/summarize", () => {
  let userId: string;
  let cookie: string;
  let strangerCookie: string;
  let roadtripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const owner = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    const stranger = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    userId = owner.id;
    cookie = `auth_token=${generateToken(owner.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;

    const route = await prisma.tripRoute.create({
      data: { userId, name: "Fernhollow loop", mode: "road", kind: "roadtrip" },
      select: { id: true },
    });
    roadtripId = route.id;
    await prisma.tripStop.createMany({
      data: [
        {
          routeId: roadtripId,
          routeOrderIdx: 0,
          title: "Fernhollow",
          lat: 61.1,
          lon: 8.5,
          startDate: d("2031-05-02"),
          endDate: d("2031-05-04"),
          overnight: true,
        },
        {
          routeId: roadtripId,
          routeOrderIdx: 1,
          title: "Dunmere",
          lat: 61.4,
          lon: 9.1,
          startDate: d("2031-05-04"),
          endDate: d("2031-05-05"),
          overnight: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("writes the roadtrip's summary, stores it and reports where it landed", async () => {
    const res = await request(app)
      .post(`/api/v1/roadtrips/${roadtripId}/summarize`)
      .set("Cookie", cookie)
      .send({ language: "de" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      summary: "Zwei Seen, ein Pass und drei Nächte am Wasser.",
      language: "de",
      summarySource: "llm",
    });
    expect(typeof res.body.model).toBe("string");
    expect(Number.isFinite(Date.parse(res.body.summaryGeneratedAt))).toBe(true);

    const stored = await prisma.tripRoute.findUniqueOrThrow({ where: { id: roadtripId } });
    expect(stored.summary).toBe(res.body.summary);
    expect(stored.summarySource).toBe("llm");
    expect(stored.summaryGeneratedAt).not.toBeNull();

    // The page's own read carries what the route wrote (the detail's summary
    // trio), so Regenerate needs no second mapping.
    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    expect(detail.body).toMatchObject({ summary: res.body.summary, summarySource: "llm" });
  });

  it("refuses a roadtrip someone else owns, and a tour's id", async () => {
    const other = await request(app)
      .post(`/api/v1/roadtrips/${roadtripId}/summarize`)
      .set("Cookie", strangerCookie)
      .send({ language: "de" });
    expect(other.status).toBe(404);

    const tour = await prisma.tripRoute.create({
      data: { userId, name: "Day walk", mode: "foot", kind: "tour" },
      select: { id: true },
    });
    const asRoadtrip = await request(app)
      .post(`/api/v1/roadtrips/${tour.id}/summarize`)
      .set("Cookie", cookie)
      .send({ language: "de" });
    expect(asRoadtrip.status).toBe(404);
  });

  it("refuses a language the model cannot be asked in", async () => {
    const res = await request(app)
      .post(`/api/v1/roadtrips/${roadtripId}/summarize`)
      .set("Cookie", cookie)
      .send({ language: "fr" });
    expect(res.status).toBe(400);
  });
});
