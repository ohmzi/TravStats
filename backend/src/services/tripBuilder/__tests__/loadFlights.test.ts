import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockFindMany = jest.fn<(args: unknown) => Promise<unknown[]>>();
const mockGetCachedAirports =
  jest.fn<(codes: string[]) => Promise<Map<string, { timezone: string | null }>>>();

jest.mock("../../../db", () => ({ prisma: { flight: { findMany: mockFindMany } } }));
jest.mock("../../airportCache", () => ({ getCachedAirports: mockGetCachedAirports }));

import { FLIGHT_ANCHOR_SELECT, loadFlights } from "../loadFlights";
import { flightRow, WINDOW } from "./flightRows";

describe("loadFlights", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockGetCachedAirports.mockReset();
    mockFindMany.mockResolvedValue([]);
    mockGetCachedAirports.mockResolvedValue(new Map());
  });

  it("asks for the user's flights that are not cancelled and leave within two days of the window", async () => {
    await loadFlights("user-1", WINDOW, null);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: { not: "cancelled" },
        departureTime: {
          gte: new Date("2031-04-30T00:00:00.000Z"),
          lt: new Date("2031-05-12T00:00:00.000Z"),
        },
      },
      select: FLIGHT_ANCHOR_SELECT,
      orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    });
  });

  it("answers no anchors when the user has no flights near the window", async () => {
    await expect(loadFlights("user-1", WINDOW, null)).resolves.toEqual([]);
  });

  it("reads the zone of a row stored without one from the airport catalogue", async () => {
    mockFindMany.mockResolvedValue([flightRow({ depTimezone: null })]);
    mockGetCachedAirports.mockResolvedValue(new Map([["NVL", { timezone: "Pacific/Auckland" }]]));
    const [anchor] = await loadFlights("user-1", WINDOW, null);
    expect(mockGetCachedAirports).toHaveBeenCalledWith(["NVL", "PCR"]);
    expect(anchor.depZone).toBe("Pacific/Auckland");
    expect(anchor.depClock).toBe("08:30");
  });

  it("locks the flights already on the trip being re-synced", async () => {
    mockFindMany.mockResolvedValue([
      flightRow({ id: "fl-1", tripId: "trip-a", trip: { id: "trip-a", name: "Northvale loop" } }),
      flightRow({ id: "fl-2" }),
    ]);
    const anchors = await loadFlights("user-1", WINDOW, "trip-a");
    expect(anchors.map((a) => [a.id, a.locked, a.defaultAssign])).toEqual([
      ["fl-1", true, true],
      ["fl-2", false, true],
    ]);
  });
});
