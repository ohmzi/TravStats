import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import TripRouteEditorPage from "../TripRouteEditorPage";
import { toursApi } from "../../lib/api/tours";
import { useTourTrackCoverage } from "../../hooks/useTourTrackCoverage";
import { useToastStore } from "../../store/toastStore";
import type { TourLeg, TourRoute } from "../../types/tour";

/**
 * Owner request 2026-10-12 (their screenshot of the Legs section): "when
 * editing a trip, allow user to correct some misunderstanding like its not
 * ferry it was roadtrip or viseversa". The row's mode control writes through
 * `toursApi.setLeg` with the leg's source and geometry preserved, so a
 * corrected mode never costs the line.
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
  useStravaStatus: () => ({ configured: true, connected: false, athleteId: null }),
}));
vi.mock("../../components/Trips/TourRecordingSummary", () => ({ default: () => null }));
vi.mock("../../components/Trips/PlannedProfileCard", () => ({ default: () => null }));
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
// Which track covers which leg is the server's answer; this suite pins what
// the editor WRITES, so each test hands the hook the map it needs.
vi.mock("../../hooks/useTourTrackCoverage", () => ({
  useTourTrackCoverage: vi.fn(() => ({ coveringTrackByLegId: new Map(), known: true })),
}));
vi.mock("../../lib/api/tours", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api/tours")>();
  return {
    ...original,
    toursApi: { ...original.toursApi, get: vi.fn(), geometry: vi.fn(), setLeg: vi.fn() },
  };
});

const ROUTE: TourRoute = {
  id: "r1",
  tripId: null,
  name: "Fjordloop",
  mode: "road",
  orderIdx: 0,
  color: null,
  notes: null,
  startOdometerKm: null,
  endOdometerKm: null,
  stopCount: 2,
  legCount: 1,
  distanceKm: 28,
  drivenKm: 28,
  kind: "tour",
  activity: "other",
  vehicle: null,
  vehicleName: null,
  anchorStopId: null,
  kindAssignedAutomatically: false,
};

const STOPS = [
  { id: "a", tripId: null, title: "Westmere", lat: 58.1, lon: 6.2, routeOrderIdx: 0, notes: null },
  { id: "b", tripId: null, title: "Eastmere", lat: 58.2, lon: 6.4, routeOrderIdx: 1, notes: null },
];

function makeLeg(overrides: Partial<TourLeg>): TourLeg {
  return {
    id: "leg-1",
    fromStopId: "a",
    toStopId: "b",
    distanceKm: 28,
    source: "straight",
    mode: "ferry",
    confidence: "low",
    waypoints: null,
    drivingMinutes: null,
    ...overrides,
  };
}

function mockSection(leg: TourLeg, routingAvailable = false): void {
  vi.mocked(toursApi.get).mockResolvedValue({
    route: ROUTE,
    stops: STOPS as never,
    legs: [leg],
    routingAvailable,
  });
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/tours/r1"]}>
      <Routes>
        <Route path="/tours/:routeId" element={<TripRouteEditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function modeSelect(): HTMLElement {
  return screen.getByRole("combobox", { name: "trips:tours.modeLabel" });
}

async function changeMode(mode: string): Promise<void> {
  fireEvent.change(await screen.findByRole("combobox", { name: "trips:tours.modeLabel" }), {
    target: { value: mode },
  });
  // The handler's write, reload and in-flight-flag clearing all resolve
  // through microtasks; one macrotask inside `act` drains them here rather
  // than after the assertions (the global setup fails a test on any act
  // warning) — the same flush FlightReviewModal's suite uses.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

/**
 * The mode control disables while the write is in flight and re-enables in
 * the handler's `finally`, after the reload — awaiting that also pins the
 * settled DOM before the assertions.
 */
async function settleWrite(): Promise<void> {
  await waitFor(() => expect(modeSelect()).not.toBeDisabled());
}

describe("TripRouteEditorPage — correcting a leg's mode", () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
    // Call history and implementations are per-test: a leftover
    // `mockResolvedValueOnce` queue from the previous case would answer for
    // this one.
    vi.mocked(toursApi.get).mockReset();
    vi.mocked(toursApi.geometry).mockReset();
    vi.mocked(toursApi.setLeg).mockReset();
    vi.mocked(useTourTrackCoverage).mockReset();
    vi.mocked(toursApi.geometry).mockResolvedValue({ type: "FeatureCollection", features: [] });
    vi.mocked(useTourTrackCoverage).mockReturnValue({
      coveringTrackByLegId: new Map(),
      known: true,
    });
  });

  it("PUTs a straight leg's new mode with its source, then re-reads the section", async () => {
    mockSection(makeLeg({ source: "straight", mode: "ferry" }));
    renderPage();

    await changeMode("road");
    // Settle BEFORE asserting: the control re-enables only in the handler's
    // `finally`, after the reload, so this waits for the whole write.
    await settleWrite();

    expect(toursApi.setLeg).toHaveBeenCalledWith(undefined, "r1", "a", "b", {
      source: "straight",
      mode: "road",
    });
    expect(toursApi.get).toHaveBeenCalledTimes(2);
  });

  it("re-sends a drawn leg's waypoints so the correction keeps its line", async () => {
    const waypoints: Array<[number, number]> = [
      [6.2, 58.1],
      [6.3, 58.15],
      [6.4, 58.2],
    ];
    mockSection(makeLeg({ source: "drawn", mode: "road", waypoints }));
    renderPage();

    await changeMode("ferry");
    await settleWrite();

    expect(toursApi.setLeg).toHaveBeenCalledWith(undefined, "r1", "a", "b", {
      source: "drawn",
      mode: "ferry",
      waypoints,
    });
  });

  it("re-adopts a track leg from its covering track, keeping the geometry exact", async () => {
    vi.mocked(useTourTrackCoverage).mockReturnValue({
      coveringTrackByLegId: new Map([["leg-1", "track-9"]]),
      known: true,
    });
    mockSection(
      makeLeg({
        source: "track",
        mode: "road",
        waypoints: [
          [6.2, 58.1],
          [6.4, 58.2],
        ],
      })
    );
    renderPage();

    await changeMode("ferry");
    await settleWrite();

    expect(toursApi.setLeg).toHaveBeenCalledWith(undefined, "r1", "a", "b", {
      source: "track",
      mode: "ferry",
      trackId: "track-9",
    });
  });

  // A track leg whose coverage no longer resolves has NO write that keeps its
  // line (the override endpoint's `track` branch needs a `trackId`). The mode
  // stays as it is and the failure is said out loud, rather than silently
  // flattening the recorded line to a chord.
  it("refuses a track leg with no covering track instead of dropping its line", async () => {
    mockSection(
      makeLeg({
        source: "track",
        mode: "road",
        waypoints: [
          [6.2, 58.1],
          [6.4, 58.2],
        ],
      })
    );
    renderPage();

    await changeMode("ferry");

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
        "trips:tours.legError"
      )
    );
    expect(toursApi.setLeg).not.toHaveBeenCalled();
    // The row still reads as it did: the mode control shows the stored mode.
    expect(modeSelect()).toHaveValue("road");
  });

  it("toasts the refusal and leaves the row as it was when the write fails", async () => {
    mockSection(makeLeg({ source: "straight", mode: "ferry" }));
    vi.mocked(toursApi.setLeg).mockRejectedValue({
      response: { status: 409, data: { error: "This track covers a different day" } },
    });
    renderPage();

    await changeMode("road");
    await settleWrite();

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
      "This track covers a different day"
    );
    // No reload happened, and the control still shows the stored mode.
    expect(toursApi.get).toHaveBeenCalledTimes(1);
    expect(modeSelect()).toHaveValue("ferry");
  });

  // The row's other options already follow `leg.mode` (`isRoutableLegMode`
  // gates "routed"); the correction must land in the reload that carries it.
  it("re-reads the section so the row's other options follow the new mode", async () => {
    vi.mocked(toursApi.get)
      .mockResolvedValueOnce({
        route: ROUTE,
        stops: STOPS as never,
        legs: [makeLeg({ source: "straight", mode: "ferry" })],
        routingAvailable: true,
      })
      .mockResolvedValueOnce({
        route: ROUTE,
        stops: STOPS as never,
        legs: [makeLeg({ source: "straight", mode: "road" })],
        routingAvailable: true,
      });
    renderPage();

    const select = await screen.findByRole("combobox", { name: "trips:tours.modeLabel" });
    expect(
      screen.queryByRole("option", { name: "trips:tours.source.routed" })
    ).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "road" } });
    await settleWrite();

    const routing = await screen.findByRole("option", { name: "trips:tours.source.routed" });
    expect(routing).toBeEnabled();
    expect(modeSelect()).toHaveValue("road");
  });

  it("disables the mode control while the write is in flight", async () => {
    mockSection(makeLeg({ source: "straight", mode: "ferry" }));
    let release: (leg: TourLeg) => void = () => undefined;
    vi.mocked(toursApi.setLeg).mockImplementation(
      () =>
        new Promise<TourLeg>((resolve) => {
          release = resolve;
        })
    );
    renderPage();

    await changeMode("road");

    await waitFor(() => expect(modeSelect()).toBeDisabled());
    release(makeLeg({ source: "straight", mode: "road" }));
    await waitFor(() => expect(modeSelect()).not.toBeDisabled());
  });
});
