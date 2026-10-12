import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Trip } from "../../types";
import type { RoadtripSummary } from "../../types/roadtrip";

/**
 * The journey's sixth tab (spec 2026-10-12 §3): **Trips**, replacing the
 * Tours tab and carrying the roadtrips section the overview used to list as
 * cards. It keeps the gate the Tours tab carried — `isEnabled("roadtrip")`
 * folds in the beta key — and no badge the beta registry does not back.
 */
const getByIdMock = vi.fn();
const roadtripsListMock = vi.fn();

const domains = vi.hoisted(() => ({ roadtrip: true }));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: [],
    isEnabled: (key: string) => (key === "roadtrip" ? domains.roadtrip : true),
  }),
}));
vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../lib/api", () => ({
  tripsApi: { getById: (...args: unknown[]) => getByIdMock(...args) },
}));
vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/api/tours", () => ({
  toursApi: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../lib/api/roadtrips", () => ({
  roadtripsApi: { list: (...args: unknown[]) => roadtripsListMock(...args) },
}));
// The cards carry a deck.gl route sketch and jsdom has no ResizeObserver.
vi.mock("../../components/map/CardMap", () => ({ default: () => <div data-testid="card-map" /> }));
// The fallback case lands on the overview, whose map has its own suite and
// would only mount a canvas jsdom has no WebGL for here.
vi.mock("../../components/Trips/TripMapWithTours", () => ({
  default: () => <div data-testid="map" />,
}));
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import TripDetailPage from "../TripDetailPage";

function makeTrip(): Trip {
  return {
    id: "trip-1",
    userId: "user-1",
    name: "Tabprobe",
    description: null,
    color: "#818cf8",
    createdAt: "2024-05-01T00:00:00.000Z",
    updatedAt: "2024-05-01T00:00:00.000Z",
    startDate: "2024-05-13T00:00:00.000Z",
    endDate: "2024-05-15T00:00:00.000Z",
    status: "completed",
    category: null,
    tags: [],
    companions: [],
    notes: null,
    summary: null,
    originLabel: null,
    destinationLabel: null,
    coverImageUrl: null,
    icon: null,
    countries: [],
    flights: [],
    cruises: [],
    stops: [],
    journalEntries: [],
    photos: [],
    lodgingStays: [],
    bookings: [],
  } as unknown as Trip;
}

function roadtrip(over: Partial<RoadtripSummary>): RoadtripSummary {
  return {
    id: "r",
    kind: "roadtrip",
    tripId: "trip-1",
    tripName: null,
    name: "R",
    mode: "road",
    color: null,
    vehicle: "campervan",
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: "2024-05-14T00:00:00.000Z",
    endDate: "2024-05-15T00:00:00.000Z",
    distanceKm: 100,
    drivenKm: 90,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 3,
    cityNames: ["Bergen", "Oslo"],
    driveCount: 2,
    stayNights: 1,
    freeNights: 1,
    nights: 2,
    nightsKnown: true,
    placesSlept: 2,
    trackCount: 0,
    tourCount: 0,
    countries: ["NO"],
    points: [],
    path: [],
    ...over,
  };
}

function renderAt(entry: string): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/trips/:id" element={<TripDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("the journey's Trips tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    domains.roadtrip = true;
    getByIdMock.mockResolvedValue(makeTrip());
    roadtripsListMock.mockResolvedValue([roadtrip({ id: "a", name: "Anreise" })]);
  });

  it("offers Trips where Tours was, drawing the journey's roadtrips as cards", async () => {
    renderAt("/trips/trip-1?tab=trips");

    const tab = await screen.findByRole("tab", { name: "trips:detail.tabs.trips" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "trips:detail.tabs.tours" })).toBeNull();
    const card = await screen.findByText("Anreise");
    expect(card.closest("a")).toHaveAttribute("href", "/roadtrips/a");
  });

  it("draws no Beta pill — a badge only the beta registry may back", async () => {
    renderAt("/trips/trip-1?tab=trips");

    await screen.findByRole("tab", { name: "trips:detail.tabs.trips" });
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("hides the tab, and falls back to the overview, while the roadtrips domain is off", async () => {
    domains.roadtrip = false;
    renderAt("/trips/trip-1?tab=trips");

    expect(await screen.findByRole("tab", { name: "trips:detail.tabs.overview" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.queryByRole("tab", { name: "trips:detail.tabs.trips" })).toBeNull();
    expect(roadtripsListMock).not.toHaveBeenCalled();
  });
});
