import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoadtripDetailPage from "../RoadtripDetailPage";
import { roadtripsApi } from "../../lib/api/roadtrips";
import type { RoadtripDetail } from "../../types/roadtrip";

vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Trips/TripMap", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../components/Roadtrips/StationEditor", () => ({
  default: ({ start }: { start: string }) => <div data-testid="editor">{start}</div>,
}));
// The gallery fetches its album through Immich; its own suite owns that, and
// this one owns that the tab hands it the loaded detail (network guard,
// forgejo#110).
vi.mock("../../components/Roadtrips/RoadtripGallery", () => ({
  default: ({ detail }: { detail: RoadtripDetail }) => (
    <div data-testid="roadtrip-gallery">{detail.roadtrip.name}</div>
  ),
}));
// The logistics tab's sections each carry their own suite; here the tab is a
// stub, so the page suite owns only that the tab is reachable and that the
// sections left the overview.
vi.mock("../../components/Roadtrips/RoadtripLogisticsTab", () => ({
  default: ({ detail }: { detail: RoadtripDetail }) => (
    <div data-testid="roadtrip-logistics">{detail.roadtrip.name}</div>
  ),
}));
// The summary card writes through the trip's own route and has its own suite;
// here it is a stub, so this file owns its PLACE and the detached-trip gate.
vi.mock("../../components/Roadtrips/RoadtripSummaryPanel", () => ({
  default: () => <div data-testid="roadtrip-summary" />,
}));
vi.mock("../../lib/api/roadtrips", () => ({ roadtripsApi: { get: vi.fn() } }));
vi.mock("../../lib/api/tours", () => ({
  toursApi: {
    geometry: vi.fn(async () => ({ type: "FeatureCollection", features: [] })),
    removeStandalone: vi.fn(),
  },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "day" in o ? `${k}:${String(o.day)}` : k),
    i18n: { language: "de" },
  }),
}));

const at = (d: string) => `${d}T00:00:00.000Z`;

const DETAIL: RoadtripDetail = {
  roadtrip: {
    id: "rt",
    name: "Fjorde 2026",
    vehicle: "campervan",
    vehicleName: "Bulli Fritz",
    distanceKm: 1542,
    drivenKm: 1370,
    startOdometerKm: 84210,
    endOdometerKm: null,
  } as never,
  countries: ["DE", "DK", "NO"],
  summary: null,
  summarySource: null,
  summaryGeneratedAt: null,
  trip: null,
  startDate: at("2026-09-18"),
  endDate: at("2026-09-28"),
  nights: { stayNights: 8, freeNights: 2, nights: 10, nightsKnown: false, placesSlept: 6 },
  stations: [],
  legs: [],
  tours: [],
  routingAvailable: true,
  expenses: [],
  costs: {
    total: {},
    totalBase: { currency: "EUR", amount: 0, unconverted: {} },
    byStation: [],
    byLeg: [],
    unpinned: {},
  },
};

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/roadtrips/:id" element={<RoadtripDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * The trip page through the shared shell (spec 2026-10-12 §2): the name, the
 * figures band and the editor's arrival. The tab set itself is pinned by
 * `RoadtripDetailPage.tabs.test.tsx`; the head's furniture (the phase pill,
 * the head's own actions) and the footer delete were ruled away with the
 * template, so the cases that pinned them went with them.
 */
describe("RoadtripDetailPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00.000Z")); // an instant, not the host's noon
    vi.mocked(roadtripsApi.get).mockResolvedValue(DETAIL);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const FILED: RoadtripDetail = {
    ...DETAIL,
    trip: { id: "t1", name: "Eastport loop", immichAlbums: [] },
  };

  it("heads the page with its name and its figures", async () => {
    renderAt("/roadtrips/rt");
    expect(await screen.findByText("Fjorde 2026")).toBeInTheDocument();
    expect(screen.getByText("1.370 km")).toBeInTheDocument();
    // DAYS remains; the NIGHTS cell is gone (owner, 2026-10-08) because it
    // restated the same stretch of time as Days. 18.–28.09 is eleven days.
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.queryByText("roadtrips:detail.figNights")).not.toBeInTheDocument();
  });

  it("arrives from “Heutige Nacht eintragen” with the editor open on tonight", async () => {
    renderAt("/roadtrips/rt?station=heute");
    expect(await screen.findByTestId("editor")).toHaveTextContent("today");
  });

  it("keeps the editor's exit chrome off the overview — no status line, no Done", async () => {
    renderAt("/roadtrips/rt");
    await screen.findByText("Fjorde 2026");
    // The autosave status and the Done button rode the head's action slot
    // until the template (spec §2.1); they are the editor's way out, so a
    // page that is not being edited must not draw them above the stations.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("roadtrips:detail.done")).not.toBeInTheDocument();
  });

  it("shows the autosave status and Done while the editor is open", async () => {
    renderAt("/roadtrips/rt?station=neu");
    await screen.findByTestId("editor");
    expect(screen.getByRole("status")).toHaveTextContent("roadtrips:editor.status.saved");
    expect(screen.getByText("roadtrips:detail.done")).toBeInTheDocument();
  });

  it("opens the trip's gallery through ?tab=gallery with the loaded detail", async () => {
    vi.mocked(roadtripsApi.get).mockResolvedValue({
      ...DETAIL,
      trip: { id: "t1", name: "Eastport loop", immichAlbums: [] },
    });
    renderAt("/roadtrips/rt?tab=gallery");
    expect(await screen.findByTestId("roadtrip-gallery")).toHaveTextContent("Fjorde 2026");
  });

  it("says so when a detached trip has no journey to carry an album", async () => {
    renderAt("/roadtrips/rt?tab=gallery");
    expect(await screen.findByText("roadtrips:detail.noAlbum")).toBeInTheDocument();
    expect(screen.queryByTestId("roadtrip-gallery")).not.toBeInTheDocument();
  });

  it("opens the trip's logistics through ?tab=logistics", async () => {
    renderAt("/roadtrips/rt?tab=logistics");
    expect(await screen.findByTestId("roadtrip-logistics")).toHaveTextContent("Fjorde 2026");
  });

  it("keeps the day tours and the costs off the overview — the Logistics tab owns them now", async () => {
    renderAt("/roadtrips/rt");
    await screen.findByText("Fjorde 2026");
    expect(screen.queryByText("roadtrips:detail.toursTitle")).not.toBeInTheDocument();
    expect(screen.queryByText("roadtrips:costs.title")).not.toBeInTheDocument();
  });

  it("reads the trip's own summary below the map (template spec §1, §6)", async () => {
    vi.mocked(roadtripsApi.get).mockResolvedValue(FILED);
    renderAt("/roadtrips/rt");
    const map = await screen.findByTestId("map");
    const summary = screen.getByTestId("roadtrip-summary");
    expect(map.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no summary section on a detached trip (template spec §8)", async () => {
    renderAt("/roadtrips/rt");
    await screen.findByText("Fjorde 2026");
    expect(screen.queryByTestId("roadtrip-summary")).not.toBeInTheDocument();
  });
});
