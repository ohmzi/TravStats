import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import type { Trip } from "../../types";

const mocks = vi.hoisted(() => ({ getById: vi.fn(), scan: vi.fn() }));

vi.mock("../../lib/api/trips", () => ({ tripsApi: { getById: mocks.getById } }));
vi.mock("../../lib/api/tripBuilder", () => ({ tripBuilderApi: { scan: mocks.scan } }));
// The header reads the settings profile, which the suite's settings mock does
// not carry; this test is about the page, not the header.
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));

import { jobKey } from "../../lib/tripBuilder/session";
import TripResyncPage from "../TripResyncPage";

// Synthetic trip (public repository).
const trip = (over: Partial<Trip> = {}): Trip =>
  ({
    id: "t1",
    name: "Northvale loop",
    startDate: "2031-05-02T00:00:00.000Z",
    endDate: "2031-05-09T00:00:00.000Z",
    times: {
      start: { date: "2031-05-02", zone: null, precision: "day" },
      end: { date: "2031-05-09", zone: null, precision: "day" },
    },
    immichAlbums: [],
    ...over,
  }) as unknown as Trip;

function Where(): JSX.Element {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/trips/t1/resync"]}>
      <Routes>
        <Route path="/trips/:id/resync" element={<TripResyncPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const apiError = (status: number, data: Record<string, unknown>) => ({
  response: { status, data },
});

describe("TripResyncPage", () => {
  beforeEach(() => {
    mocks.getById.mockReset().mockResolvedValue(trip());
    mocks.scan.mockReset().mockResolvedValue({ jobId: "job-1" });
    sessionStorage.clear();
  });

  it("scans the trip's saved dates against the trip, and hands the job to the review page", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/trips/builder?job=job-1")
    );
    expect(mocks.scan).toHaveBeenCalledWith({
      name: "Northvale loop",
      startDay: "2031-05-02",
      endDay: "2031-05-09",
      inspect: true,
      createAlbum: false,
      target: { kind: "existing", tripId: "t1" },
    });
    // The handoff Task 141's startExistingScan files: the form, the target,
    // where Back returns — and the scan itself, so a scan that is lost before
    // any draft exists can be run again.
    expect(JSON.parse(sessionStorage.getItem(jobKey("job-1")) ?? "null")).toEqual({
      form: { name: "Northvale loop", startDate: "2031-05-02", endDate: "2031-05-09" },
      target: { kind: "existing", tripId: "t1" },
      returnTo: "/trips/t1",
      scan: {
        name: "Northvale loop",
        startDay: "2031-05-02",
        endDay: "2031-05-09",
        inspect: true,
        createAlbum: false,
        target: { kind: "existing", tripId: "t1" },
      },
    });
  });

  it("also syncs the album when the trip has a linked one", async () => {
    mocks.getById.mockResolvedValue(
      trip({
        immichAlbums: [{ id: "l1", immichAlbumId: "a1", albumName: "x", assetCount: 3 } as never],
      })
    );
    renderPage();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalled());
    expect(mocks.scan.mock.calls[0][0].createAlbum).toBe(true);
  });

  it("asks for dates first when the trip has none, and scans nothing", async () => {
    mocks.getById.mockResolvedValue(
      trip({ times: undefined, startDate: null, endDate: null } as Partial<Trip>)
    );
    renderPage();
    expect(await screen.findByText("tripBuilder:resync.noDates.title")).toBeInTheDocument();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("points to the settings when Immich is not connected", async () => {
    mocks.scan.mockRejectedValue(apiError(409, { error: "notConfigured" }));
    renderPage();
    expect(await screen.findByText("tripBuilder:resync.notConfigured.title")).toBeInTheDocument();
  });

  it("says when the trip is longer than a scan covers", async () => {
    mocks.scan.mockRejectedValue(apiError(400, { code: "VALIDATION_FAILED" }));
    renderPage();
    expect(await screen.findByText("tripBuilder:resync.tooLong.title")).toBeInTheDocument();
  });

  it("says plainly when the scan could not be started", async () => {
    mocks.scan.mockRejectedValue(apiError(500, {}));
    renderPage();
    expect(await screen.findByText("tripBuilder:resync.failed.title")).toBeInTheDocument();
  });

  it("starts the scan once, however often the page renders", async () => {
    renderPage();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
    expect(mocks.getById).toHaveBeenCalledTimes(1);
  });
});
