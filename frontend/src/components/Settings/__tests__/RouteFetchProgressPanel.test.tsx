import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The admin map-download progress panel (owner request 2026-10-14: "have a
 * place in setting that shows its progress"). It reads only what the
 * service's own `GET /status` reports — phase, regions, start — so every
 * state below is one the wire can actually produce. Nothing here invents a
 * percentage: when the service names only a phase, the panel says the phase.
 */
const tMock = vi.fn((key: string, opts?: Record<string, unknown>) =>
  opts && Object.keys(opts).length > 0 ? `${key}|${JSON.stringify(opts)}` : key
);
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: tMock, i18n: { language: "de" }, ready: true }),
}));

const tours = vi.hoisted(() => ({ visible: true }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => tours.visible }));

const adminApi = vi.hoisted(() => ({ getRouteFetchStatus: vi.fn() }));
vi.mock("../../../lib/api", () => ({ adminApi }));

import RouteFetchProgressPanel from "../RouteFetchProgressPanel";

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** Reads an interpolated option the panel handed its copy. */
function calledWith(key: string, opts: Record<string, unknown>): boolean {
  return (tMock.mock.calls as Array<[string, Record<string, unknown>?]>).some(
    ([k, o]) => k === key && o !== undefined && JSON.stringify(o) === JSON.stringify(opts)
  );
}

describe("RouteFetchProgressPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tours.visible = true;
  });

  it("shows the phase, the region label, the regions and the elapsed time while a job runs", async () => {
    const startedAt = nowSec() - 420; // ~7 minutes
    adminApi.getRouteFetchStatus.mockResolvedValue({
      configured: true,
      reachable: true,
      built: ["us/texas"],
      job: {
        state: "downloading",
        regions: ["us/tennessee", "us/kentucky"],
        label: "Tennessee + Kentucky",
        startedAt,
      },
      lastResult: null,
    });

    render(<RouteFetchProgressPanel />);

    expect(await screen.findByText("settings:routing.fetch.phase.downloading")).toBeInTheDocument();
    expect(screen.getByText("Tennessee + Kentucky")).toBeInTheDocument();
    // The elapsed time is real arithmetic from `startedAt`, not a fabricated
    // number — ~7 minutes, so anything from 6 to 8 is honest for this fixture.
    const elapsed = screen.getByText(/settings:routing\.fetch\.elapsed/).textContent ?? "";
    const minutes = Number(/"minutes":(\d+)/.exec(elapsed)?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(6);
    expect(minutes).toBeLessThanOrEqual(8);
  });

  it("shows the ETA when the service supplies one, and omits the line when it does not", async () => {
    adminApi.getRouteFetchStatus.mockResolvedValue({
      configured: true,
      reachable: true,
      built: [],
      job: {
        state: "queued",
        regions: ["us/ohio"],
        label: "Ohio",
        startedAt: nowSec(),
        etaMinutes: 25,
      },
      lastResult: null,
    });

    render(<RouteFetchProgressPanel />);

    expect(await screen.findByText("settings:routing.fetch.phase.queued")).toBeInTheDocument();
    expect(calledWith("settings:routing.fetch.eta", { minutes: 25 })).toBe(true);
  });

  it("omits the ETA line entirely when /status carries no etaMinutes — never invents one", async () => {
    adminApi.getRouteFetchStatus.mockResolvedValue({
      configured: true,
      reachable: true,
      built: [],
      job: { state: "building", regions: ["us/ohio"], label: "Ohio", startedAt: nowSec() },
      lastResult: null,
    });

    render(<RouteFetchProgressPanel />);

    expect(await screen.findByText("settings:routing.fetch.phase.building")).toBeInTheDocument();
    expect(screen.queryByText(/settings:routing\.fetch\.eta/)).toBeNull();
  });

  it("shows the last built result (regions, and when) when nothing is running", async () => {
    adminApi.getRouteFetchStatus.mockResolvedValue({
      configured: true,
      reachable: true,
      built: ["us/ohio"],
      job: null,
      lastResult: { status: "built", regions: ["us/ohio"], at: nowSec() - 120 },
    });

    render(<RouteFetchProgressPanel />);

    expect(await screen.findByText("settings:routing.fetch.idle")).toBeInTheDocument();
    const lastBuilt = screen.getByText(/settings:routing\.fetch\.lastBuilt/);
    expect(lastBuilt.textContent).toContain("us/ohio");
  });

  it("shows the last failure's own error when the last build failed", async () => {
    adminApi.getRouteFetchStatus.mockResolvedValue({
      configured: true,
      reachable: true,
      built: [],
      job: null,
      lastResult: {
        status: "failed",
        regions: ["us/ohio"],
        error: "osmium exited 1",
        at: nowSec(),
      },
    });

    render(<RouteFetchProgressPanel />);

    expect(await screen.findByText(/settings:routing\.fetch\.lastFailed/)).toBeInTheDocument();
    expect(screen.getByText(/osmium exited 1/)).toBeInTheDocument();
  });

  it("says the feature is not configured when the instance has no auto-fetch URL", async () => {
    adminApi.getRouteFetchStatus.mockResolvedValue({ configured: false });

    render(<RouteFetchProgressPanel />);

    expect(await screen.findByText("settings:routing.fetch.notConfigured")).toBeInTheDocument();
  });

  it("says the service is unreachable when it did not answer", async () => {
    adminApi.getRouteFetchStatus.mockResolvedValue({ configured: true, reachable: false });

    render(<RouteFetchProgressPanel />);

    expect(await screen.findByText("settings:routing.fetch.unreachable")).toBeInTheDocument();
  });

  it("stays out, and never polls, while tours are behind the switch", () => {
    tours.visible = false;
    const { container } = render(<RouteFetchProgressPanel />);

    expect(container).toBeEmptyDOMElement();
    expect(adminApi.getRouteFetchStatus).not.toHaveBeenCalled();
  });
});
