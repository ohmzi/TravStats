jest.mock("../../services/domainVisibility", () => ({
  ...jest.requireActual("../../services/domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { stationsSchema } from "../../schemas/roadtrip";
import { loadVisibleDomains } from "../../services/domainVisibility";
import { insertRoadtrip } from "../../services/roadtrip/createRoadtrip";
import { replaceStationsInTx } from "../../services/roadtrip/replaceStations";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * `GET /trips/:id` lists the stations of the trip's roadtrips as
 * `roadtripStations` (photo trip builder, spec 2026-10-09 §E), beside the
 * `stops` they are not part of. Synthetic places only.
 */
const mockVisible = loadVisibleDomains as jest.Mock;
const USERNAME = "trips-roadtrip-stations";

describe("GET /trips/:id roadtripStations", () => {
  let cookie: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
    tripId = (await prisma.trip.create({ data: { userId: user.id, name: "Northvale loop" } })).id;
    const stations = stationsSchema.parse({
      stations: [
        {
          title: "Northvale",
          lat: -45.05,
          lon: 168.7,
          startDate: "2031-05-02",
          endDate: "2031-05-04",
          night: { kind: "free" },
        },
        {
          title: "Port Carrow",
          lat: -44.7,
          lon: 169.15,
          startDate: "2031-05-04",
          endDate: "2031-05-04",
          night: { kind: "pass" },
        },
      ],
    }).stations;
    await prisma.$transaction(async (tx) => {
      const row = await insertRoadtrip(tx, user.id, {
        tripId,
        name: "Northvale loop",
        mode: "road",
      });
      await replaceStationsInTx(tx, user.id, row.id, stations);
    });
  });

  beforeEach(() => mockVisible.mockResolvedValue(["flight", "roadtrip"]));

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it("lists the stations beside the trip, not among its stops", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.trip.stops).toEqual([]);
    expect(
      res.body.trip.roadtripStations.map((s: { title: string; state: string; nights: number }) => [
        s.title,
        s.state,
        s.nights,
      ])
    ).toEqual([
      ["Northvale", "free", 2],
      ["Port Carrow", "pass", 0],
    ]);
  });

  it("sends the stations' `times` like every other timeline row", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);

    expect(res.body.trip.roadtripStations[0].times.start.precision).toBe("day");
  });

  it("sends an empty list while roadtrips are off", async () => {
    mockVisible.mockResolvedValue(["flight"]);

    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.trip.roadtripStations).toEqual([]);
  });
});
