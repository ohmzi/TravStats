/**
 * The trip-side Re-sync page (owner request 2026-10-12): the trip edit page's
 * "Re-sync from Immich" starts HERE, so the scan's window is the trip's own
 * dates and its target names both the journey and the roadtrip.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import type { RoadtripDetail } from "../../types/roadtrip";

const mocks = vi.hoisted(() => ({ get: vi.fn(), scan: vi.fn() }));

vi.mock("../../lib/api/roadtrips", () => ({ roadtripsApi: { get: mocks.get } }));
vi.mock("../../lib/api/tripBuilder", () => ({ tripBuilderApi: { scan: mocks.scan } }));
// The header reads the settings profile, which the suite's settings mock does
// not carry; this test is about the page, not the header.
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));

import { jobKey } from "../../lib/tripBuilder/session";
import RoadtripResyncPage from "../RoadtripResyncPage";

// Synthetic fixtures only (public repository): invented places, shifted years.
const ROUTE_ID = "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e";

const detail = (over: Partial<RoadtripDetail> = {}): RoadtripDetail =>
  ({
    roadtrip: { id: ROUTE_ID, name: "Northvale loop", tripId: "j1", kind: "roadtrip" },
    trip: { id: "j1", name: "Southern loop" },
    startDate: "2031-05-02T00:00:00.000Z",
    endDate: "2031-05-04T00:00:00.000Z",
    countries: [],
    nights: {},
    stations: [],
    legs: [],
    tours: [],
    expenses: [],
    costs: {},
    routingAvailable: false,
    summary: null,
    summarySource: null,
    summaryGeneratedAt: null,
    ...over,
  }) as unknown as RoadtripDetail;

function Where(): JSX.Element {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/roadtrips/${ROUTE_ID}/resync`]}>
      <Routes>
        <Route path="/roadtrips/:routeId/resync" element={<RoadtripResyncPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const apiError = (status: number, data: Record<string, unknown>) => ({
  response: { status, data },
});

describe("RoadtripResyncPage", () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(detail());
    mocks.scan.mockReset().mockResolvedValue({ jobId: "job-2" });
    sessionStorage.clear();
  });

  it("scans the TRIP's saved dates with the route in the target, and hands the job to the review", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/trips/builder?job=job-2")
    );
    expect(mocks.scan).toHaveBeenCalledWith({
      name: "Northvale loop",
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      inspect: true,
      createAlbum: true,
      target: { kind: "existing", tripId: "j1", routeId: ROUTE_ID },
    });
    expect(JSON.parse(sessionStorage.getItem(jobKey("job-2")) ?? "null")).toEqual({
      form: { name: "Northvale loop", startDate: "2031-05-02", endDate: "2031-05-04" },
      target: { kind: "existing", tripId: "j1", routeId: ROUTE_ID },
      returnTo: `/roadtrips/${ROUTE_ID}`,
      scan: {
        name: "Northvale loop",
        startDay: "2031-05-02",
        endDay: "2031-05-04",
        inspect: true,
        createAlbum: true,
        target: { kind: "existing", tripId: "j1", routeId: ROUTE_ID },
      },
    });
  });

  it("asks for dates first when the trip has none, and scans nothing", async () => {
    mocks.get.mockResolvedValue(detail({ startDate: null, endDate: null }));
    renderPage();
    expect(await screen.findByText("tripBuilder:resync.tripNoDates.title")).toBeInTheDocument();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("says when the trip is longer than a scan covers, in the trip's own words", async () => {
    mocks.get.mockResolvedValue(detail({ endDate: "2031-07-05T00:00:00.000Z" }));
    renderPage();
    expect(await screen.findByText("tripBuilder:resync.tripTooLong.title")).toBeInTheDocument();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("points to the settings when Immich is not connected", async () => {
    mocks.scan.mockRejectedValue(apiError(409, { error: "notConfigured" }));
    renderPage();
    expect(await screen.findByText("tripBuilder:resync.notConfigured.title")).toBeInTheDocument();
  });

  it("says plainly when the scan could not be started, and for a detached trip", async () => {
    mocks.scan.mockRejectedValue(apiError(500, {}));
    renderPage();
    expect(await screen.findByText("tripBuilder:resync.failed.title")).toBeInTheDocument();
  });

  it("refuses to scan a detached trip — there is no journey to scan against", async () => {
    mocks.get.mockResolvedValue(detail({ trip: null }));
    renderPage();
    expect(await screen.findByText("tripBuilder:resync.failed.title")).toBeInTheDocument();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("starts the scan once, however often the page renders", async () => {
    renderPage();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
