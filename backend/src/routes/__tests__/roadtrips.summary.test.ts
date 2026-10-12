import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The roadtrip's summary on the wire (spec 2026-10-12 §6): the detail's own
 * DTO carries `summary`, `summarySource` and `summaryGeneratedAt` — the
 * journey's trio one level down, read straight off the `trip_routes` row.
 * Writing them is the regenerate route's task; here they are stored and read.
 *
 * Synthetic fixtures only (public repository).
 */
const USERS = ["summary-roadtripper", "summary-stranger"];
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("a roadtrip's summary on the wire", () => {
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
    cookie = `auth_token=${generateToken(owner.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
    const route = await prisma.tripRoute.create({
      data: { userId: owner.id, name: "Northvale loop", mode: "road", kind: "roadtrip" },
      select: { id: true },
    });
    roadtripId = route.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  const detail = (cookieValue = cookie) =>
    request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookieValue);

  it("reports the trio empty on a roadtrip no model has written about", async () => {
    const res = await detail();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      summary: null,
      summarySource: null,
      summaryGeneratedAt: null,
    });
  });

  it("carries the stored text, who wrote it and when", async () => {
    const writtenAt = d("2031-06-02");
    await prisma.tripRoute.update({
      where: { id: roadtripId },
      data: {
        summary: "Zwei Nächte am See, ein Nachmittag über dem Pass.",
        summarySource: "llm",
        summaryGeneratedAt: writtenAt,
      },
    });
    const res = await detail();
    expect(res.body.summary).toBe("Zwei Nächte am See, ein Nachmittag über dem Pass.");
    expect(res.body.summarySource).toBe("llm");
    expect(Date.parse(res.body.summaryGeneratedAt)).toBe(writtenAt.getTime());
  });

  it("keeps one account's summary out of another's detail", async () => {
    const res = await detail(strangerCookie);
    expect(res.status).toBe(404);
  });
});
