import { prisma } from "../../db";
import { TRIP_BRIEF_INCLUDE, briefFromTrip } from "../tripSummaryService";

/**
 * The journey's AI summary covers the trip's EFFECTIVE span (owner 2026-10-13):
 * the days the journey's own pages show — the stored days where the trip has
 * them, its flights' days otherwise. A flight-only journey used to hand the
 * model `startDate: null` and `nights: null` while its flights carried the
 * dates, so the summary could not tell the trip's length.
 *
 * Synthetic fixtures only (public repository).
 */
const USER = "summary-journey-span";

describe("the journey brief's span", () => {
  let userId: string;

  const read = (id: string) =>
    prisma.trip.findFirstOrThrow({ where: { id }, include: TRIP_BRIEF_INCLUDE });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    const user = await prisma.user.create({ data: { username: USER, passwordHash: "x" } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  it("reads a flight-only journey's span off its first departure and last arrival", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "NYC 2020" } });
    await prisma.flight.createMany({
      data: [
        {
          userId,
          tripId: trip.id,
          depIata: "JFK",
          arrIata: "FRA",
          depLat: 40.6413,
          depLon: -73.7781,
          arrLat: 50.0379,
          arrLon: 8.5622,
          // 23:30 on the 20th in New York — the journey starts that evening.
          departureTime: new Date("2020-11-21T04:30:00Z"),
          depTimezone: "America/New_York",
          arrTimezone: "Europe/Berlin",
          arrivalTime: new Date("2020-11-21T12:00:00Z"),
          status: "flown",
        },
        {
          userId,
          tripId: trip.id,
          depIata: "FRA",
          arrIata: "JFK",
          depLat: 50.0379,
          depLon: 8.5622,
          arrLat: 40.6413,
          arrLon: -73.7781,
          departureTime: new Date("2020-11-26T17:40:00Z"),
          depTimezone: "Europe/Berlin",
          arrTimezone: "America/New_York",
          arrivalTime: new Date("2020-11-28T23:30:00Z"),
          status: "flown",
        },
      ],
    });

    const brief = briefFromTrip(await read(trip.id));
    expect(brief.startDate).toBe("2020-11-20");
    expect(brief.endDate).toBe("2020-11-28");
    expect(brief.nights).toBe(8);
    // Still a fallback, not a write: the row keeps its empty days.
    const row = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(row.startDay).toBeNull();
    expect(row.endDay).toBeNull();
  });

  it("keeps the stored days when the trip has them", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Japan 2027",
        startDate: new Date("2027-04-01T00:00:00Z"),
        endDate: new Date("2027-04-12T00:00:00Z"),
        startDay: new Date("2027-04-01T00:00:00Z"),
        endDay: new Date("2027-04-12T00:00:00Z"),
      },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        depIata: "FRA",
        arrIata: "HND",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 35.5494,
        arrLon: 139.7798,
        departureTime: new Date("2027-04-01T08:00:00Z"),
        depTimezone: "Europe/Berlin",
        arrTimezone: "Asia/Tokyo",
        arrivalTime: new Date("2027-04-02T06:00:00Z"),
        status: "flown",
      },
    });

    const brief = briefFromTrip(await read(trip.id));
    expect(brief.startDate).toBe("2027-04-01");
    expect(brief.endDate).toBe("2027-04-12");
    expect(brief.nights).toBe(11);
  });

  it("still abstains when the trip has neither dates nor entries", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Someday" } });
    const brief = briefFromTrip(await read(trip.id));
    expect(brief.startDate).toBeNull();
    expect(brief.endDate).toBeNull();
    expect(brief.nights).toBeNull();
  });
});
