import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The trip's own start and end day (owner 2026-10-13): the editor's Dates
 * section writes them through the kind-agnostic route PATCH, and the list and
 * detail report them as the trip's span — per side, with the stations still
 * answering the sides nobody set. A trip nobody dated is byte-identical to
 * what it always was.
 *
 * Synthetic fixtures only (public repository): invented places, 2031+.
 */

const USERS = ["tripdays-editor", "tripdays-stranger"];
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const DEPART = "2031-06-02";
const RETURN = "2031-06-06";

describe("a trip's own dates", () => {
  let cookie: string;
  let strangerCookie: string;
  let userId: string;
  let tripId: string;
  let routeId: string;

  /** Two dated stations: the derived span 06-02 → 06-06. */
  async function makeRoute(name: string, withTrip: boolean): Promise<string> {
    const route = await prisma.tripRoute.create({
      data: {
        userId,
        tripId: withTrip ? tripId : null,
        name,
        mode: "road",
        kind: "roadtrip",
        vehicle: "car",
      },
    });
    await prisma.tripStop.createMany({
      data: [
        {
          routeId: route.id,
          routeOrderIdx: 0,
          title: "Fernhollow",
          lat: 61.1,
          lon: 8.5,
          startDate: d(DEPART),
          endDate: d("2031-06-03"),
          overnight: true,
        },
        {
          routeId: route.id,
          routeOrderIdx: 1,
          title: "Dunmere",
          lat: 61.5,
          lon: 9.1,
          startDate: d(RETURN),
          endDate: d(RETURN),
          overnight: true,
        },
      ],
    });
    return route.id;
  }

  const spanOfRoute = async (id: string) => {
    const res = await request(app).get(`/api/v1/roadtrips/${id}`).set("Cookie", cookie);
    return { status: res.status, startDate: res.body.startDate, endDate: res.body.endDate };
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const s = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    strangerCookie = `auth_token=${generateToken(s.id)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Fernhollow days" } })).id;
    routeId = await makeRoute("Fernhollow loop", true);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("reports the stations' span while no day is stored — nothing changes for an undated trip", async () => {
    expect(await spanOfRoute(routeId)).toEqual({
      status: 200,
      startDate: `${DEPART}T00:00:00.000Z`,
      endDate: `${RETURN}T00:00:00.000Z`,
    });
  });

  it("stores both days through the kind-agnostic PATCH, and the detail and list report them", async () => {
    const res = await request(app)
      .patch(`/api/v1/tours/${routeId}`)
      .set("Cookie", cookie)
      .send({ startDay: "2031-06-01", endDay: "2031-06-09" });
    expect(res.status).toBe(200);
    expect(res.body.route).toMatchObject({ startDay: "2031-06-01", endDay: "2031-06-09" });

    const stored = await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId } });
    expect(stored.startDay?.toISOString()).toBe("2031-06-01T00:00:00.000Z");
    expect(stored.endDay?.toISOString()).toBe("2031-06-09T00:00:00.000Z");

    // The ONE span rule: the stored days win on the detail…
    expect(await spanOfRoute(routeId)).toEqual({
      status: 200,
      startDate: "2031-06-01T00:00:00.000Z",
      endDate: "2031-06-09T00:00:00.000Z",
    });
    // …and on the list the chain, the band and the scoped window read.
    const list = await request(app).get("/api/v1/roadtrips").set("Cookie", cookie);
    const row = list.body.roadtrips.find((r: { id: string }) => r.id === routeId);
    expect(row).toMatchObject({
      startDate: "2031-06-01T00:00:00.000Z",
      endDate: "2031-06-09T00:00:00.000Z",
    });
  });

  it("writes through the trip-scoped path too, not only /tours/:id", async () => {
    const res = await request(app)
      .patch(`/api/v1/trips/${tripId}/routes/${routeId}`)
      .set("Cookie", cookie)
      .send({ endDay: "2031-06-10" });
    expect(res.status).toBe(200);
    expect(res.body.route.endDay).toBe("2031-06-10");
  });

  it("clears one side back to the stations and keeps the other stored", async () => {
    const res = await request(app)
      .patch(`/api/v1/tours/${routeId}`)
      .set("Cookie", cookie)
      .send({ startDay: null });
    expect(res.status).toBe(200);
    expect(res.body.route).toMatchObject({ startDay: null, endDay: "2031-06-10" });

    expect(await spanOfRoute(routeId)).toEqual({
      status: 200,
      startDate: `${DEPART}T00:00:00.000Z`,
      endDate: "2031-06-10T00:00:00.000Z",
    });
  });

  it("refuses the span the PATCH would leave behind, not only the days it carries", async () => {
    // A stored start alone leaves the end's move judged against it: sending
    // only an earlier end must be refused (SRV-TRIP-DATE-001's rule, one
    // level down), never stored.
    const withStart = await request(app)
      .patch(`/api/v1/tours/${routeId}`)
      .set("Cookie", cookie)
      .send({ startDay: "2031-06-01" });
    expect(withStart.status).toBe(200);

    const res = await request(app)
      .patch(`/api/v1/tours/${routeId}`)
      .set("Cookie", cookie)
      .send({ endDay: "2031-05-20" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("endDate must not precede startDate");
    // Nothing was stored: the refused end is not on the row.
    const stored = await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId } });
    expect(stored.endDay?.toISOString()).toBe("2031-06-10T00:00:00.000Z");
    // A same-day span is a day trip, and is accepted (as on the journey).
    const sameDay = await request(app)
      .patch(`/api/v1/tours/${routeId}`)
      .set("Cookie", cookie)
      .send({ endDay: "2031-06-01" });
    expect(sameDay.status).toBe(200);
    expect(sameDay.body.route).toMatchObject({ startDay: "2031-06-01", endDay: "2031-06-01" });
  });

  it("is ownership-guarded, and a stranger reads nothing", async () => {
    const patch = await request(app)
      .patch(`/api/v1/tours/${routeId}`)
      .set("Cookie", strangerCookie)
      .send({ startDay: "2031-07-01" });
    expect(patch.status).toBe(404);
    expect(
      (await request(app).get(`/api/v1/roadtrips/${routeId}`).set("Cookie", strangerCookie)).status
    ).toBe(404);
    const stored = await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId } });
    expect(stored.startDay?.toISOString()).toBe("2031-06-01T00:00:00.000Z");
  });

  it("refuses days on a day tour — its own day is its tourDate", async () => {
    const tour = await prisma.tripRoute.create({
      data: { userId, name: "Ridge walk", mode: "foot", kind: "tour", activity: "hike" },
    });
    const res = await request(app)
      .patch(`/api/v1/tours/${tour.id}`)
      .set("Cookie", cookie)
      .send({ startDay: "2031-06-01", endDay: "2031-06-02" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Only a roadtrip carries its own dates");
    await prisma.tripRoute.delete({ where: { id: tour.id } });
  });
});
