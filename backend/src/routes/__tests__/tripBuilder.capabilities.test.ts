jest.mock("../../services/tripBuilder/capabilities", () => ({ builderCapabilities: jest.fn() }));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { builderCapabilities } from "../../services/tripBuilder/capabilities";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

const mockCapabilities = builderCapabilities as jest.Mock;
const CAPABILITIES = {
  immich: {
    configured: true,
    source: "user",
    inspect: { ok: true, missingScopes: [] },
    album: { canCreate: null, reason: "unverified" },
  },
  roadtrips: true,
  routing: { available: false, canProbe: false },
  home: { known: false, confirmed: false },
};

describe("GET /api/v1/trip-builder/capabilities", () => {
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-route-caps" } });
    const user = await prisma.user.create({
      data: { username: "tb-route-caps", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tb-route-caps" } });
    await prisma.$disconnect();
  });

  it("answers the capabilities as the bare resource", async () => {
    mockCapabilities.mockResolvedValue(CAPABILITIES);
    const res = await request(app).get("/api/v1/trip-builder/capabilities").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(CAPABILITIES);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("asks for a sign-in", async () => {
    const res = await request(app).get("/api/v1/trip-builder/capabilities");
    expect(res.status).toBe(401);
  });

  it("passes a failure on as an error, not a half answer", async () => {
    mockCapabilities.mockRejectedValue(new Error("database down"));
    const res = await request(app).get("/api/v1/trip-builder/capabilities").set("Cookie", cookie);
    expect(res.status).toBe(500);
  });
});
