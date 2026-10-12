import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../lib/api/roadtrips", () => ({ roadtripsApi: { list: vi.fn() } }));
vi.mock("../../../lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { roadtripsApi } from "../../../lib/api/roadtrips";
import { logger } from "../../../lib/logger";
import { useTripRoadtrips } from "../useTripRoadtrips";
import type { RoadtripSummary } from "../../../types/roadtrip";

/** The list endpoint's row, with the fields the chain reads. Synthetic fixture. */
function summary(over: Partial<RoadtripSummary>): RoadtripSummary {
  return {
    id: "r",
    kind: "roadtrip",
    tripId: null,
    tripName: null,
    name: "R",
    mode: "road",
    color: null,
    vehicle: "campervan",
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: "2031-05-02T00:00:00.000Z",
    endDate: "2031-05-08T00:00:00.000Z",
    distanceKm: 100,
    drivenKm: 90,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 3,
    cityNames: ["Dunholme"],
    driveCount: 2,
    stayNights: 1,
    freeNights: 1,
    nights: 2,
    nightsKnown: true,
    placesSlept: 2,
    trackCount: 0,
    tourCount: 0,
    countries: ["NO"],
    points: [
      [10, 53],
      [6, 62],
    ],
    path: [
      [10, 53],
      [6, 62],
    ],
    ...over,
  };
}

const MINE = summary({ id: "r1", tripId: "j1", name: "Coast run" });
const OTHER = summary({ id: "r2", tripId: "j2", name: "Mountain run" });
const DETACHED = summary({ id: "r3", tripId: null, name: "Detached run" });

describe("useTripRoadtrips", () => {
  beforeEach(() => {
    vi.mocked(roadtripsApi.list).mockReset().mockResolvedValue([MINE, OTHER, DETACHED]);
    vi.mocked(logger.warn).mockClear();
  });

  it("keeps only the journey's own roadtrips, dates and all", async () => {
    const { result } = renderHook(() => useTripRoadtrips("j1", true));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    // A landed read is settled: only now may the chain say "no trips".
    expect(result.current.settled).toBe(true);
    expect(result.current.rows[0].id).toBe("r1");
    // The span and the km a chain node heads with travel with the row.
    expect(result.current.rows[0].startDate).toBe("2031-05-02T00:00:00.000Z");
    expect(result.current.rows[0].drivenKm).toBe(90);
  });

  it("reports the read unsettled while the list is still in flight", async () => {
    let land: (rows: RoadtripSummary[]) => void = () => undefined;
    vi.mocked(roadtripsApi.list).mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      })
    );
    const { result } = renderHook(() => useTripRoadtrips("j1", true));
    await waitFor(() => expect(roadtripsApi.list).toHaveBeenCalled());
    // Nothing has landed, so nothing may read as an empty journey yet.
    expect(result.current).toEqual({ rows: [], settled: false });

    land([OTHER, MINE]);
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.rows.map((r) => r.id)).toEqual(["r1"]);
  });

  it("asks for nothing while the roadtrip domain is off", async () => {
    const { result } = renderHook(() => useTripRoadtrips("j1", false));
    await waitFor(() => expect(roadtripsApi.list).not.toHaveBeenCalled());
    // No read was asked for, so nothing has settled; the chain stays silent.
    expect(result.current).toEqual({ rows: [], settled: false });
  });

  it("stays empty and unsettled when the list cannot be read, and never throws", async () => {
    vi.mocked(roadtripsApi.list).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useTripRoadtrips("j1", true));
    await waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        "Loading a trip's roadtrips failed",
        expect.any(Error)
      )
    );
    // A failed read is not a settled one: the chain must not claim the journey
    // holds no trips, nor send the reader to re-sync over a dead request.
    expect(result.current).toEqual({ rows: [], settled: false });
  });
});
