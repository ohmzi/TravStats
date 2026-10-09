import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * A dashboard card is a way IN, never a way into editing (owner, 2026-10-09):
 * a flight line's action opens the READ-ONLY logbook flight page — not the edit
 * modal it used to open — and a roadtrip line answers with the same card the
 * roadtrips tab mounts, whose action links to the roadtrip's own page.
 *
 * Pinned on the "Alle" tab because that is where both lines are drawn: the
 * flight line is a map layer, the roadtrip line an extra layer this tab builds.
 */
const { mapProps } = vi.hoisted(() => ({ mapProps: [] as Record<string, unknown>[] }));

vi.mock("../../../MapContainer3D", () => ({
  default: (props: Record<string, unknown>) => {
    mapProps.push(props);
    return <div data-testid="map" />;
  },
}));

// Tours sit behind the roadtrips beta key; this suite is about what happens
// once they are visible.
vi.mock("../../../../hooks/useToursVisible", () => ({
  useToursVisible: () => true,
  useToursAccess: () => "allowed",
}));

const mockUseDashboardTours = vi.hoisted(() => vi.fn());
vi.mock("../../../../hooks/useDashboardTours", () => ({
  useDashboardTours: (...args: unknown[]) => mockUseDashboardTours(...args),
}));

const mockUseBetaFeatures = vi.hoisted(() => vi.fn());
vi.mock("../../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => mockUseBetaFeatures(),
  useBetaFeatureAccess: (key: string) => {
    const { betaFeaturesEnabled, isFeatureVisible } = mockUseBetaFeatures();
    if (betaFeaturesEnabled === null) return "pending";
    return isFeatureVisible(key) ? "allowed" : "denied";
  },
}));

const mockUseDashboardRoute = vi.hoisted(() => vi.fn());
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => mockUseDashboardRoute(),
}));

vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));

vi.mock("../../../../hooks/useFlightLookup", () => ({
  useFlightLookup: () => ({ lookup: () => null, lookupMany: () => [] }),
}));

vi.mock("../../../../lib/api/flights", () => ({
  flightsApi: { getAllGeoJSON: vi.fn().mockResolvedValue({ features: [] }) },
}));
vi.mock("../../../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../../lib/api/places", () => ({ listPlaces: () => Promise.resolve([]) }));
vi.mock("../../../../lib/api/placeLists", () => ({ listPlaceLists: () => Promise.resolve([]) }));
vi.mock("../../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

const roadtripGet = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/api/roadtrips", () => ({ roadtripsApi: { get: roadtripGet } }));

import { AllTab } from "../AllTab";

const READY_NO_TOURS = {
  tours: [],
  toursLoading: false,
  toursLoadError: false,
  geometries: [],
  reload: vi.fn(),
};

const ROADTRIP = {
  id: "rt-1",
  tripId: "trip-1",
  tripName: "Norway",
  name: "Nordkap",
  kind: "roadtrip",
  mode: "road",
  distanceKm: 420,
  stopCount: 4,
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-05T00:00:00.000Z",
};

const GEOMETRY = {
  routeId: "rt-1",
  name: "Nordkap",
  isRoadtrip: true,
  geometry: {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [8.0, 58.15],
            [8.1, 58.3],
          ],
        },
        properties: {
          legId: "leg-1",
          source: "straight" as const,
          mode: "road" as const,
          confidence: "low",
          distanceKm: 12,
        },
      },
    ],
  },
};

beforeEach(() => {
  mapProps.length = 0;
  mockUseDashboardTours.mockReset();
  mockUseBetaFeatures.mockReset();
  mockUseDashboardRoute.mockReset();
  roadtripGet.mockReset();
  mockUseDashboardRoute.mockReturnValue({
    tab: "all",
    mode: "overview",
    setTab: () => {},
    setMode: () => {},
  });
  mockUseBetaFeatures.mockReturnValue({
    betaFeaturesEnabled: true,
    isFeatureVisible: (key: string) => key === "tourRoutes",
  });
  mockUseDashboardTours.mockReturnValue(READY_NO_TOURS);
  roadtripGet.mockResolvedValue({
    roadtrip: { name: "Nordkap", drivenKm: 100, stopCount: 2 },
    nights: { nights: 1 },
    countries: ["NO"],
  });
});

function renderAllTab(): void {
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<AllTab />} />
        <Route path="/flights/:id" element={<div data-testid="flight-page" />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The one tour path layer this tab draws, with the props deck.gl would call. */
function tourLayer():
  | {
      props: {
        data: Array<Record<string, unknown>>;
        onClick: (info: { object: unknown; coordinate?: number[] }) => void;
      };
    }
  | undefined {
  const layers = mapProps[mapProps.length - 1]?.extraLayers as
    | Array<{ id: string; props: { data: Array<Record<string, unknown>>; onClick?: unknown } }>
    | undefined;
  const layer = layers?.find((l) => l.id === "dashboard-tour-paths");
  return layer as never;
}

/** The pinned datum the tab last handed down — the map draws the card itself. */
function pinnedProp(): {
  kind?: string;
  data?: Record<string, unknown>;
  anchorLngLat?: number[];
} | null {
  return mapProps[mapProps.length - 1]?.pinned as never;
}

describe("AllTab: the dashboard line cards open the read-only thing", () => {
  it("opens the flight's logbook page from the card's action, not the edit modal", async () => {
    renderAllTab();
    await waitFor(() => expect(mapProps.length).toBeGreaterThan(0));

    const onFlightOpen = mapProps[mapProps.length - 1].onFlightOpen as (flightId: string) => void;
    act(() => onFlightOpen("f1"));

    expect(await screen.findByTestId("flight-page")).toBeInTheDocument();
  });

  it("answers a roadtrip line with the roadtrip card, anchored on the tap", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [ROADTRIP],
      geometries: [GEOMETRY],
    });

    renderAllTab();
    await waitFor(() => expect(tourLayer()).toBeDefined());

    const layer = tourLayer()!;
    act(() => layer.props.onClick({ object: layer.props.data[0], coordinate: [8.05, 58.2] }));

    // The card is drawn by the MAP — it owns the anchor projection — so the
    // tab's half is the pinned datum it hands down: the roadtrip's own page,
    // the tap point as the anchor (not a corner), and the honest count of one.
    await waitFor(() => expect(pinnedProp()?.kind).toBe("roadtrip"));
    expect(pinnedProp()?.data).toMatchObject({ routeId: "rt-1", name: "Nordkap", count: 1 });
    expect(pinnedProp()?.anchorLngLat).toEqual([8.05, 58.2]);
  });

  it("holds ONE pinned slot, so a flight open replaces an open roadtrip card", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [ROADTRIP],
      geometries: [GEOMETRY],
    });

    renderAllTab();
    await waitFor(() => expect(tourLayer()).toBeDefined());

    // A roadtrip pick writes the slot…
    await act(async () => {
      const layer = tourLayer()!;
      layer.props.onClick({ object: layer.props.data[0], coordinate: [8, 58] });
    });
    await waitFor(() => expect(pinnedProp()?.kind).toBe("roadtrip"));

    // …and the SAME setter a flight click uses replaces it. That setter is what
    // the real DeckGLMap's arc click and its selection-store effect call, so the
    // two kinds cannot both be open (owner, 2026-10-09; bug 4b).
    const onPinnedChange = mapProps[mapProps.length - 1].onPinnedChange as (next: unknown) => void;
    await act(async () => {
      onPinnedChange({
        kind: "arc",
        anchorLngLat: [10, 50],
        data: { departure: {}, arrival: {}, flightIds: ["f1"], count: 1, color: [240, 169, 71] },
      });
    });

    await waitFor(() => expect(pinnedProp()?.kind).toBe("arc"));
  });

  it("leaves a day-tour leg inert — only a roadtrip answers with a card", async () => {
    mockUseDashboardTours.mockReturnValue({
      ...READY_NO_TOURS,
      tours: [{ ...ROADTRIP, kind: "tour" }],
      geometries: [{ ...GEOMETRY, isRoadtrip: false }],
    });

    renderAllTab();
    await waitFor(() => expect(tourLayer()).toBeDefined());

    const layer = tourLayer()!;
    act(() => layer.props.onClick({ object: layer.props.data[0], coordinate: [8, 58] }));

    expect(pinnedProp()).toBeNull();
  });
});
