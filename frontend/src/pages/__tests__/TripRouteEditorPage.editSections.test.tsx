import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import type { RoadtripDetail } from "../../types/roadtrip";
import type { TourRoute } from "../../types/tour";

/**
 * The trip's edit page (spec 2026-10-12 §4): the route & recordings editor
 * gains a Re-sync from Immich section for a trip filed on a journey and the
 * existing roadtrip delete section. Synthetic fixtures (public repository).
 */

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/Trips/TripMap", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../components/Trips/StravaImportDialog", () => ({
  default: () => null,
  useStravaConnected: () => false,
}));
vi.mock("../../components/Trips/TourRecordingSummary", () => ({ default: () => null }));
vi.mock("../../hooks/useTourTracks", () => ({
  useTourTracks: () => ({
    tracks: [],
    tracksLoading: false,
    tracksLoadError: false,
    loadTracks: vi.fn(),
    tracksWithGeometry: [],
    tracksKnown: true,
    trackUploading: false,
    uploadTrack: vi.fn(),
    trackPulling: false,
    pullDawarichTrack: vi.fn(),
    deleteTrack: vi.fn(),
    dawarichAvailable: false,
  }),
}));
vi.mock("../../hooks/useTourTrackCoverage", () => ({
  useTourTrackCoverage: () => ({ coveringTrackByLegId: new Map(), known: true }),
}));
// The journey the twin shape loads: only its id matters here.
vi.mock("../../lib/api", () => ({
  tripsApi: {
    getById: vi.fn().mockResolvedValue({ id: "j1", name: "Northvale loop", stops: [] }),
  },
}));
vi.mock("../../lib/api/tours", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api/tours")>();
  return {
    ...original,
    toursApi: {
      ...original.toursApi,
      get: vi.fn(),
      geometry: vi.fn(),
      removeStandalone: vi.fn(),
    },
  };
});
// The Dates section's prefill: the editor asks the roadtrip detail for the
// span the trip already shows (`spanOf`), never the journey's or the list's.
vi.mock("../../lib/api/roadtrips", () => ({
  roadtripsApi: { get: vi.fn() },
}));

import TripRouteEditorPage from "../TripRouteEditorPage";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { toursApi } from "../../lib/api/tours";

const ROUTE = {
  id: "r1",
  tripId: null,
  name: "Fjorde 2031",
  mode: "road",
  orderIdx: 0,
  color: null,
  notes: null,
  startOdometerKm: null,
  endOdometerKm: null,
  stopCount: 0,
  legCount: 0,
  distanceKm: 0,
  drivenKm: 0,
  kind: "roadtrip",
  activity: null,
  vehicle: "campervan",
  vehicleName: null,
  anchorStopId: null,
  kindAssignedAutomatically: false,
} as TourRoute;

/** The span the roadtrip detail serves — deliberately NOT the route's stored days,
 *  so the prefill tests tell "stored wins" and "the span answers" apart. */
const DETAIL = {
  startDate: "2031-05-01T00:00:00.000Z",
  endDate: "2031-05-09T00:00:00.000Z",
} as RoadtripDetail;

function Where(): JSX.Element {
  const location = useLocation();
  return <span data-testid="where">{location.pathname}</span>;
}

function renderAt(path: string, entry: string): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={path} element={<TripRouteEditorPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const conflict = (): Error =>
  Object.assign(new Error("conflict"), {
    isAxiosError: true,
    response: { status: 409, data: { code: "SECTION_HAS_EXPENSES", expenseCount: 2 } },
  });

describe("TripRouteEditorPage — the trip's edit page sections", () => {
  beforeEach(() => {
    vi.mocked(toursApi.get).mockReset().mockResolvedValue({
      route: ROUTE,
      stops: [],
      legs: [],
      routingAvailable: false,
    });
    vi.mocked(toursApi.geometry)
      .mockReset()
      .mockResolvedValue({ type: "FeatureCollection", features: [] });
    vi.mocked(toursApi.removeStandalone).mockReset().mockResolvedValue(undefined);
    vi.mocked(roadtripsApi.get).mockReset().mockResolvedValue(DETAIL);
  });

  it("carries the Re-sync from Immich section for a trip filed on a journey", async () => {
    renderAt("/trips/:id/route/:routeId", "/trips/j1/route/r1");

    // The trip's own Re-sync (owner request 2026-10-12): it scans and updates
    // THIS trip, so it lands on the trip's own resync page, not the journey's.
    const link = await screen.findByRole("link", { name: "tripBuilder:resync.action" });
    expect(link).toHaveAttribute("href", "/roadtrips/r1/resync");
  });

  it("offers no re-sync on a detached trip — there is no journey to scan", async () => {
    renderAt("/tours/:routeId", "/tours/r1");

    expect(await screen.findByRole("heading", { name: "Fjorde 2031" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "tripBuilder:resync.action" })
    ).not.toBeInTheDocument();
  });

  it("reads the journey off the route at the trip's own edit path", async () => {
    vi.mocked(toursApi.get).mockResolvedValue({
      route: { ...ROUTE, tripId: "j1" },
      stops: [],
      legs: [],
      routingAvailable: false,
    });
    renderAt("/roadtrips/:routeId/edit", "/roadtrips/r1/edit");

    // The trip's own Re-sync (owner request 2026-10-12): it scans and updates
    // THIS trip, so it lands on the trip's own resync page, not the journey's.
    const link = await screen.findByRole("link", { name: "tripBuilder:resync.action" });
    expect(link).toHaveAttribute("href", "/roadtrips/r1/resync");
  });

  it("gives a roadtrip the Dates section, prefilled from the route's own days", async () => {
    vi.mocked(toursApi.get).mockResolvedValue({
      route: { ...ROUTE, startDay: "2031-06-01", endDay: "2031-06-09" },
      stops: [],
      legs: [],
      routingAvailable: false,
    });
    renderAt("/tours/:routeId", "/tours/r1");

    expect(
      await screen.findByRole("heading", { name: "roadtrips:dates.heading" })
    ).toBeInTheDocument();
    // Stored days win over the detail's span (`DETAIL` says May).
    expect(screen.getByLabelText("trips:modal.startDateLabel")).toHaveValue("2031-06-01");
    expect(screen.getByLabelText("trips:modal.endDateLabel")).toHaveValue("2031-06-09");
  });

  it("prefills a trip with no stored days from the span it already shows", async () => {
    renderAt("/roadtrips/:routeId/edit", "/roadtrips/r1/edit");

    expect(
      await screen.findByRole("heading", { name: "roadtrips:dates.heading" })
    ).toBeInTheDocument();
    expect(roadtripsApi.get).toHaveBeenCalledWith("r1");
    expect(screen.getByLabelText("trips:modal.startDateLabel")).toHaveValue("2031-05-01");
    expect(screen.getByLabelText("trips:modal.endDateLabel")).toHaveValue("2031-05-09");
  });

  it("leaves a day tour's editor without either section", async () => {
    vi.mocked(toursApi.get).mockResolvedValue({
      route: { ...ROUTE, kind: "tour", vehicle: null, activity: "hike" } as TourRoute,
      stops: [],
      legs: [],
      routingAvailable: false,
    });
    renderAt("/tours/:routeId", "/tours/r1");

    expect(await screen.findByRole("heading", { name: "Fjorde 2031" })).toBeInTheDocument();
    expect(screen.queryByText("tripBuilder:edit.deleteHeading")).not.toBeInTheDocument();
    expect(screen.queryByText("roadtrips:dates.heading")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "tripBuilder:resync.action" })
    ).not.toBeInTheDocument();
  });

  it("deletes the trip only after the confirm, and asks again about its costs", async () => {
    vi.mocked(toursApi.removeStandalone)
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce(undefined);
    renderAt("/roadtrips/:routeId/edit", "/roadtrips/r1/edit");

    fireEvent.click(await screen.findByText("roadtrips:delete"));
    expect(await screen.findByText("roadtrips:deleteConfirm.title")).toBeInTheDocument();
    expect(toursApi.removeStandalone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("roadtrips:deleteConfirm.confirm"));
    await waitFor(() =>
      expect(toursApi.removeStandalone).toHaveBeenCalledWith("r1", { deleteExpenses: false })
    );

    fireEvent.click(await screen.findByText("roadtrips:deleteWithCosts.confirm"));
    await waitFor(() => expect(toursApi.removeStandalone).toHaveBeenCalledTimes(2));
    expect(vi.mocked(toursApi.removeStandalone).mock.calls).toEqual([
      ["r1", { deleteExpenses: false }],
      ["r1", { deleteExpenses: true }],
    ]);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/roadtrips$/));
  });
});
