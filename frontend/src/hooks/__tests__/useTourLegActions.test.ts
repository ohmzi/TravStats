import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { TourLeg, TourRoute } from "../../types/tour";
import { useToastStore } from "../../store/toastStore";

/**
 * 2026-10-13, the owner's Muscat roadtrip: "0 legs routed, 7 left as
 * straight lines ... The routing provider's answer did not fit the two
 * places and was discarded." The count was right and the reason was true —
 * but without the numbers it read as the app being fussy about a good
 * answer, when in fact the provider's line sat ~9,500 km from every stop
 * (a road graph with no data for Oman). Both routing toasts must carry the
 * numbers the server refused the answer with. Real German copy, because the
 * global test mock would return keys and hide a forgotten interpolation.
 */
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: () => germanUseTranslationNs() };
});
vi.mock("../../lib/api/tours", () => ({
  toursApi: {
    routeLeg: vi.fn(),
    routeAll: vi.fn(),
    setLeg: vi.fn(),
  },
}));

import { toursApi } from "../../lib/api/tours";
import { useTourLegActions } from "../useTourLegActions";

const ROUTE: TourRoute = {
  id: "route",
  tripId: "trip",
  name: "Karachi 2025 · Muscat",
  mode: "road",
  orderIdx: 0,
  color: null,
  notes: null,
  startOdometerKm: null,
  endOdometerKm: null,
  stopCount: 8,
  legCount: 7,
  distanceKm: 608,
  drivenKm: 608,
  kind: "roadtrip",
  activity: null,
  vehicle: "car",
  vehicleName: null,
  anchorStopId: null,
  kindAssignedAutomatically: false,
};

const LEG: TourLeg = {
  id: "leg-1",
  fromStopId: "a",
  toStopId: "b",
  distanceKm: 30.3,
  source: "straight",
  mode: "road",
  confidence: "low",
  waypoints: null,
  drivingMinutes: null,
};

const OPTIONS = {
  tripId: "trip",
  routeId: "route",
  load: vi.fn(async (): Promise<void> => undefined),
  mountedRef: { current: true },
  trackCoverageByLegId: new Map<string, string>(),
};

describe("useTourLegActions — a routing outcome names its numbers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
  });

  it("the whole-route toast says how far the provider's line sat from the stops", async () => {
    vi.mocked(toursApi.routeAll).mockResolvedValue({
      route: ROUTE,
      legs: [LEG],
      routedCount: 0,
      fallbackCount: 7,
      skippedCount: 0,
      fallbackReason: "untrustworthy",
      fallbackDetail: { kind: "anchors", headOffKm: 9533, tailOffKm: 9551 },
    });

    const { result } = renderHook(() => useTourLegActions(OPTIONS));
    // One act around the fire-and-forget batch: it routes, reloads, toasts
    // and clears its in-flight flag before this settles.
    await act(async () => {
      result.current.routeAll();
    });

    expect(useToastStore.getState().toasts).toHaveLength(1);
    const message = useToastStore.getState().toasts[0].message;
    expect(message).toContain("0 Etappen berechnet, 7 als Luftlinie belassen, 0 übersprungen.");
    expect(message).toContain(
      "Die Linie beginnt 9.533 km vom ersten Ort entfernt und endet 9.551 km vom zweiten."
    );
  });

  it("the per-leg toast carries the same numbers", async () => {
    vi.mocked(toursApi.routeLeg).mockResolvedValue({
      leg: LEG,
      fallbackReason: "untrustworthy",
      fallbackDetail: { kind: "anchors", headOffKm: 9533, tailOffKm: 9551 },
    });

    const { result } = renderHook(() => useTourLegActions(OPTIONS));
    await act(async () => {
      result.current.route(LEG);
    });

    expect(useToastStore.getState().toasts).toHaveLength(1);
    const message = useToastStore.getState().toasts[0].message;
    expect(message).toContain(
      "Die Linie beginnt 9.533 km vom ersten Ort entfernt und endet 9.551 km vom zweiten."
    );
  });
});
