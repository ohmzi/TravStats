import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A flight-only journey's span, served (owner 2026-10-13): "in flight trips the
 * start and end date of trips should be based on first and last flight".
 *
 * Verified live: `NYC 2020` had `startDay`/`endDay` NULL and no roadtrips, so
 * the Dates cell, the timeline and the edit form had no dates while its flights
 * carried them. The detail and the list now serve the effective span — the
 * stored days where the trip has them, its entries' days otherwise — so every
 * consumer (the band, the cards, the Immich scan's window, the edit form's
 * prefill) reads ONE answer. Nothing is backfilled: the DB row stays as it was.
 */
const USER = "tripjourneyspan";

describe("a journey's effective span on the trip endpoints", () => {
  let userId: string;
  let cookie: string;
  let tripId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.trip.deleteMany({ where: { user: { username: USER } } });
    await prisma.flight.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    tripId = (await prisma.trip.create({ data: { userId, name: "NYC 2020" } })).id;
    // Two legs, each stored with the zone it was written in: a 23:30 New York
    // departure is the evening of the 20th, an 18:40 Berlin arrival the 28th.
    await prisma.flight.create({
      data: {
        userId,
        tripId,
        depIata: "JFK",
        arrIata: "FRA",
        depLat: 40.6413,
        depLon: -73.7781,
        arrLat: 50.0379,
        arrLon: 8.5622,
        departureTime: new Date("2020-11-21T04:30:00Z"),
        depTimezone: "America/New_York",
        arrTimezone: "Europe/Berlin",
        arrivalTime: new Date("2020-11-21T12:00:00Z"),
        status: "flown",
      },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId,
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 40.6413,
        arrLon: -73.7781,
        departureTime: new Date("2020-11-28T17:40:00Z"),
        depTimezone: "Europe/Berlin",
        arrTimezone: "America/New_York",
        arrivalTime: new Date("2020-11-28T23:30:00Z"),
        status: "flown",
      },
    });
  });

  it("serves the flights' days on the detail when the trip has none stored", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    // 04:30Z on the 21st is 23:30 on the 20th in New York — the journey starts
    // that evening, not on the UTC day.
    expect(res.body.trip.times.start).toEqual({
      date: "2020-11-20",
      zone: "America/New_York",
      precision: "day",
    });
    expect(res.body.trip.times.end.date).toBe("2020-11-28");
    expect(res.body.trip.startDate?.slice(0, 10)).toBe("2020-11-20");
    expect(res.body.trip.endDate?.slice(0, 10)).toBe("2020-11-28");

    // Nothing was written: the row keeps its empty days.
    const row = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(row.startDay).toBeNull();
    expect(row.endDay).toBeNull();
    expect(row.startDate).toBeNull();
    expect(row.endDate).toBeNull();
  });

  it("serves the same span on the list the cards read", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const listed = res.body.trips.find((t: { id: string }) => t.id === tripId);
    expect(listed.startDate?.slice(0, 10)).toBe("2020-11-20");
    expect(listed.endDate?.slice(0, 10)).toBe("2020-11-28");
    expect(listed.times.start.date).toBe("2020-11-20");
    expect(listed.times.end.date).toBe("2020-11-28");
  });

  it("lets a stored day win its own side, the flights answering the other", async () => {
    await prisma.trip.update({
      where: { id: tripId },
      data: { startDay: new Date("2020-11-19T00:00:00Z"), startZone: null },
    });
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    expect(res.body.trip.times.start).toEqual({
      date: "2020-11-19",
      zone: null,
      precision: "day",
    });
    expect(res.body.trip.times.end.date).toBe("2020-11-28");
  });

  it("abstains — null as before — when the trip has no stored days and no entries", async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.trip.startDate).toBeNull();
    expect(res.body.trip.endDate).toBeNull();
    expect(res.body.trip.times).toEqual({ start: null, end: null });
  });
});
