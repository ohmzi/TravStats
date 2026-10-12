import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../lib/api/roadtrips", () => ({ roadtripsApi: { list: vi.fn() } }));

import { roadtripsApi } from "../../../lib/api/roadtrips";
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
  });

  it("keeps only the journey's own roadtrips, dates and all", async () => {
    const { result } = renderHook(() => useTripRoadtrips("j1", true));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe("r1");
    // The span and the km a chain node heads with travel with the row.
    expect(result.current[0].startDate).toBe("2031-05-02T00:00:00.000Z");
    expect(result.current[0].drivenKm).toBe(90);
  });

  it("asks for nothing while the roadtrip domain is off", async () => {
    const { result } = renderHook(() => useTripRoadtrips("j1", false));
    await waitFor(() => expect(result.current).toEqual([]));
    expect(roadtripsApi.list).not.toHaveBeenCalled();
  });

  it("stays empty when the list cannot be read, and never throws", async () => {
    vi.mocked(roadtripsApi.list).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useTripRoadtrips("j1", true));
    await waitFor(() => expect(roadtripsApi.list).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
