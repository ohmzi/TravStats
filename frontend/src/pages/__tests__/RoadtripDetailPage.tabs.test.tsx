import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import RoadtripDetailPage from "../RoadtripDetailPage";
import { roadtripsApi } from "../../lib/api/roadtrips";
import type { RoadtripDetail } from "../../types/roadtrip";

/**
 * The trip page's shared tab set (spec 2026-10-12 §3): Overview · Timeline ·
 * Map · Gallery · Logistics, driven by the same `?tab=` mechanism the journey
 * page uses. The panels' own contents belong to the map and timeline tasks;
 * this suite pins the shell — which tab a URL opens, what a click writes back,
 * and that the station arrival clears its own parameter and the tab it arrived
 * over, because the editor it opens lives on the Overview.
 */
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Roadtrips/RoadtripMapPanel", () => ({
  default: () => <div data-testid="full-map" />,
}));
vi.mock("../../components/Roadtrips/RoadtripTimelineTab", () => ({
  default: () => <div data-testid="day-timeline" />,
}));
vi.mock("../../components/Roadtrips/StationEditor", () => ({
  default: ({ start }: { start: string }) => <div data-testid="editor">{start}</div>,
}));
// The summary card asks the parser capabilities and writes through the trip's
// own route; it has its own suite, and its PLACE on this page is pinned by
// RoadtripDetailPage.test.tsx. Here it is a stub, so nothing reaches out.
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
  trip: {
    id: "trip-1",
    name: "Sommerreise",
    immichAlbums: [
      {
        id: "al-1",
        albumName: "Sommerreise",
        immichAlbumId: "im-1",
        assetCount: 40,
        thumbnailAssetId: null,
        mode: "link",
        sortIdx: 0,
        lastSyncedAt: null,
      },
    ],
  },
  startDate: at("2026-09-18"),
  endDate: at("2026-09-28"),
  nights: { stayNights: 8, freeNights: 2, nights: 10, nightsKnown: false, placesSlept: 6 },
  stations: [],
  legs: [],
  tours: [],
  routingAvailable: true,
  expenses: [],
  costs: { total: {}, byStation: [], byLeg: [], unpinned: {} },
};

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/roadtrips/:id" element={<RoadtripDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("the trip page's tab set", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00.000Z")); // an instant, not the host's noon
    vi.mocked(roadtripsApi.get).mockResolvedValue(DETAIL);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("draws the five shared tabs and opens the one the URL names", async () => {
    renderAt("/roadtrips/rt?tab=map");
    await screen.findByText("Fjorde 2026");

    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByRole("tab", { name: "trips:detail.tabs.map" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByTestId("full-map")).toBeInTheDocument();
  });

  it("writes the chosen tab into the URL", async () => {
    render(
      <MemoryRouter initialEntries={["/roadtrips/rt"]}>
        <Routes>
          <Route
            path="/roadtrips/:id"
            element={
              <>
                <RoadtripDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByText("Fjorde 2026");

    fireEvent.click(screen.getByRole("tab", { name: "trips:detail.tabs.logistics" }));

    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe("?tab=logistics"));
  });

  it("falls back to the overview on a tab that does not exist", async () => {
    renderAt("/roadtrips/rt?tab=nonsense");
    await screen.findByText("Fjorde 2026");

    expect(screen.getByRole("tab", { name: "trips:detail.tabs.overview" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // The overview's sticky aside draws the same panel the Map tab does.
    expect(screen.getByTestId("full-map")).toBeInTheDocument();
  });

  it("clears its own parameter and the tab when the station arrival opens the editor", async () => {
    render(
      <MemoryRouter initialEntries={["/roadtrips/rt?station=neu&tab=timeline"]}>
        <Routes>
          <Route
            path="/roadtrips/:id"
            element={
              <>
                <RoadtripDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByText("Fjorde 2026");

    // The editor lives on the Overview: both the station parameter and the tab
    // it arrived over go, and the reader lands on the editor.
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("draws no tab strip while the editor is open, and the overview under it", async () => {
    renderAt("/roadtrips/rt?station=neu");
    await screen.findByTestId("editor");

    // The ruled condition (`editing || tab === "overview"`): the editor is
    // never left behind a tab switch, and the strip is not offered while it
    // is up.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("roadtrips:stations.title")).toBeInTheDocument();
  });
});
