jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

import { prisma } from "../../../db";
import { stationsSchema } from "../../../schemas/roadtrip";
import { hashPassword } from "../../../utils/password";
import { loadVisibleDomains } from "../../domainVisibility";
import { insertRoadtrip } from "../../roadtrip/createRoadtrip";
import { replaceStationsInTx } from "../../roadtrip/replaceStations";
import { roadtripStationsForTrip } from "../tripRoadtripStations";

/**
 * The stations a trip's timeline lists (photo trip builder, spec 2026-10-09
 * §E). Synthetic places only: the repository is public.
 */
const mockVisible = loadVisibleDomains as jest.Mock;
const USERNAMES = ["trip-stations-owner", "trip-stations-stranger"];

const NORTHVALE = { title: "Northvale", lat: -45.05, lon: 168.7 };
const PORT_CARROW = { title: "Port Carrow", lat: -44.7, lon: 169.15 };
const KELMORE = { title: "Kelmore", lat: -44.4, lon: 168.9 };

const free = (place: typeof NORTHVALE, startDate: string, endDate: string) => ({
  ...place,
  startDate,
  endDate,
  night: { kind: "free" },
});

describe("roadtripStationsForTrip", () => {
  let ownerId: string;
  let strangerId: string;
  let tripId: string;
  let strangerTripId: string;

  /** A roadtrip written the way the builder and the editor write one. */
  async function roadtrip(
    userId: string,
    onTrip: string | null,
    name: string,
    stations: unknown[]
  ): Promise<string> {
    const parsed = stationsSchema.parse({ stations });
    return prisma.$transaction(async (tx) => {
      const row = await insertRoadtrip(tx, userId, { tripId: onTrip, name, mode: "road" });
      await replaceStationsInTx(tx, userId, row.id, parsed.stations);
      return row.id;
    });
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
    const passwordHash = await hashPassword("password123");
    ownerId = (await prisma.user.create({ data: { username: USERNAMES[0], passwordHash } })).id;
    strangerId = (await prisma.user.create({ data: { username: USERNAMES[1], passwordHash } })).id;
    tripId = (await prisma.trip.create({ data: { userId: ownerId, name: "Northvale loop" } })).id;
    strangerTripId = (await prisma.trip.create({ data: { userId: strangerId, name: "Other" } })).id;

    const loop = await roadtrip(ownerId, tripId, "Northvale loop", [
      free(NORTHVALE, "2031-05-02", "2031-05-04"),
      { title: "", lat: -44.9, lon: 168.9, night: { kind: "via" } },
      { ...PORT_CARROW, startDate: "2031-05-04", endDate: "2031-05-04", night: { kind: "pass" } },
    ]);
    await roadtrip(ownerId, tripId, "Westshire leg", [free(KELMORE, "2031-05-04", "2031-05-05")]);
    await roadtrip(ownerId, null, "On no trip", [free(KELMORE, "2031-06-01", "2031-06-02")]);
    await roadtrip(strangerId, strangerTripId, "Not yours", [
      free(NORTHVALE, "2031-05-02", "2031-05-03"),
    ]);
    // A station adopted onto the trip's own timeline keeps its trip id: it is a `trip.stops` row.
    await prisma.tripStop.create({
      data: {
        tripId,
        routeId: loop,
        routeOrderIdx: 9,
        title: "Adopted stop",
        lat: -45.0,
        lon: 168.8,
        overnight: true,
        startDate: new Date("2031-05-03T00:00:00Z"),
      },
    });
  });

  beforeEach(() => mockVisible.mockResolvedValue(["flight", "roadtrip"]));

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
    await prisma.$disconnect();
  });

  it("lists the stations of the trip's roadtrips, roadtrip by roadtrip", async () => {
    const stations = await roadtripStationsForTrip(ownerId, tripId);

    expect(stations.map((s) => [s.routeName, s.title, s.routeOrderIdx])).toEqual([
      ["Northvale loop", "Northvale", 0],
      ["Northvale loop", "Port Carrow", 2],
      ["Westshire leg", "Kelmore", 0],
    ]);
  });

  it("says each station's state and its own nights", async () => {
    const stations = await roadtripStationsForTrip(ownerId, tripId);

    expect(stations.map((s) => [s.state, s.nights])).toEqual([
      ["free", 2],
      ["pass", 0],
      ["free", 1],
    ]);
  });

  it("carries the days of each station as `times`, and the columns beside them", async () => {
    const [northvale] = await roadtripStationsForTrip(ownerId, tripId);

    expect(northvale.times.start?.precision).toBe("day");
    expect(northvale.times.start?.local.slice(0, 10)).toBe("2031-05-02");
    expect(northvale.times.end?.local.slice(0, 10)).toBe("2031-05-04");
    expect(northvale.startUtc).toBeInstanceOf(Date);
    expect(typeof northvale.stopZone).toBe("string");
  });

  it("leaves out route corrections, adopted stops and roadtrips on no trip", async () => {
    const titles = (await roadtripStationsForTrip(ownerId, tripId)).map((s) => s.title);

    expect(titles).not.toContain("");
    expect(titles).not.toContain("Adopted stop");
    expect(titles).toHaveLength(3);
  });

  it("answers nothing for a trip that is not the caller's", async () => {
    expect(await roadtripStationsForTrip(ownerId, strangerTripId)).toEqual([]);
    expect(await roadtripStationsForTrip(strangerId, tripId)).toEqual([]);
  });

  it("answers nothing while roadtrips are off", async () => {
    mockVisible.mockResolvedValue(["flight"]);

    expect(await roadtripStationsForTrip(ownerId, tripId)).toEqual([]);
  });
});
