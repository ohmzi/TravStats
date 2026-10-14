import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import LegDialog from "../LegDialog";
import { toursApi } from "../../../lib/api/tours";
import type { TourLeg } from "../../../types/tour";
import { useAuthStore } from "../../../store/authStore";

// A recording key-echo, so a test can see WHAT the dialog asked its copy
// for — the numbers behind a refused answer travel inside one of these
// options (`routeFallbackMessage`), invisible to a DOM query.
const tMock = vi.fn((key: string) => key);
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: tMock, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api/tours", () => ({
  toursApi: {
    setLeg: vi.fn(async () => ({})),
    routeLeg: vi.fn(async () => ({ leg: {}, fallbackReason: null, fallbackDetail: null })),
  },
}));

const LEG: TourLeg = {
  id: "leg",
  fromStopId: "a",
  toStopId: "b",
  distanceKm: 32,
  source: "straight",
  mode: "road",
  confidence: "estimate",
  waypoints: null,
  drivingMinutes: null,
};

function renderDialog(
  routingAvailable = true,
  onSaved = vi.fn(),
  leg: TourLeg = LEG,
  onClose = vi.fn()
): ReturnType<typeof vi.fn> {
  render(
    <MemoryRouter>
      <LegDialog
        routeId="rt"
        leg={leg}
        from={{ id: "a", title: "Gudvangen" }}
        to={{ id: "b", title: "Kaupanger" }}
        routingAvailable={routingAvailable}
        onClose={onClose}
        onSaved={onSaved}
      />
    </MemoryRouter>
  );
  return onSaved;
}

const networkError = (): Error =>
  Object.assign(new Error("Network Error"), { isAxiosError: true, response: undefined });

describe("LegDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers no road routing for a ferry, and saves the ferry as a straight crossing", async () => {
    const onSaved = renderDialog();
    fireEvent.click(screen.getByText("roadtrips:timeline.leg.ferry"));
    expect(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ })).toBeDisabled();
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toursApi.setLeg).toHaveBeenCalledWith(undefined, "rt", "a", "b", {
      source: "straight",
      mode: "ferry",
    });
    expect(toursApi.routeLeg).not.toHaveBeenCalled();
  });

  it("routes a road leg along the road when asked", async () => {
    const onSaved = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toursApi.routeLeg).toHaveBeenCalledWith(undefined, "rt", "a", "b");
  });

  it("stays open and says why when the provider could not route the leg", async () => {
    vi.mocked(toursApi.routeLeg).mockResolvedValueOnce({
      leg: LEG,
      fallbackReason: "point_not_near_road",
      fallbackDetail: null,
    });
    const onSaved = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));

    expect(await screen.findByText("roadtrips:legDialog.fallback")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:legDialog.fallbackKept")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("hands the numbers behind a refused answer to its copy (2026-10-13, Muscat)", async () => {
    // "The answer did not fit the two places" without them reads like the
    // app rejected a good route; the offsets are what show the provider was
    // answering from a road graph ~9,500 km away.
    vi.mocked(toursApi.routeLeg).mockResolvedValueOnce({
      leg: LEG,
      fallbackReason: "untrustworthy",
      fallbackDetail: { kind: "anchors", headOffKm: 9533, tailOffKm: 9551 },
    });
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));

    await screen.findByText("roadtrips:legDialog.fallback");
    expect(tMock).toHaveBeenCalledWith("roadtrips:legDialog.fallback", {
      reason: expect.stringContaining("trips:tours.routing.detail.anchors"),
    });
  });

  it("does not flatten a drawn leg to a straight line before trying to route it", async () => {
    vi.mocked(toursApi.routeLeg).mockResolvedValueOnce({
      leg: LEG,
      fallbackReason: "no_route",
      fallbackDetail: null,
    });
    renderDialog(true, vi.fn(), {
      ...LEG,
      source: "drawn",
      waypoints: [
        [6.8, 60.9],
        [7.2, 61.2],
      ],
    });
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    // Replacing a hand-drawn line is said on the button (forgejo#242).
    fireEvent.click(screen.getByText("roadtrips:legDialog.applyReplace"));

    await screen.findByText("roadtrips:legDialog.fallback");
    expect(toursApi.setLeg).not.toHaveBeenCalled();
  });

  it("saves a straight line when the reader picks one", async () => {
    const onSaved = renderDialog(true, vi.fn(), { ...LEG, source: "drawn" });
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.straight/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.applyReplace"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toursApi.setLeg).toHaveBeenCalledWith(undefined, "rt", "a", "b", {
      source: "straight",
      mode: "road",
    });
    expect(toursApi.routeLeg).not.toHaveBeenCalled();
  });

  it("says why there is no routing when the instance has no provider", () => {
    renderDialog(false);
    expect(screen.getByText("roadtrips:legDialog.routedUnavailable")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ })).toBeDisabled();
  });

  // forgejo#246/#247: the failure stays in the dialog with a retry; the choice is kept.
  it("keeps the choice after a dropped connection, says so in a banner and retries", async () => {
    vi.mocked(toursApi.setLeg).mockRejectedValueOnce(networkError());
    const onSaved = renderDialog();
    fireEvent.click(screen.getByText("roadtrips:timeline.leg.ferry"));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.network");
    expect(screen.getByText("roadtrips:timeline.leg.ferry").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(toursApi.setLeg).toHaveBeenCalledTimes(2);
  });

  // forgejo#248: a changed choice asks before Escape throws it away; an
  // untouched dialog closes at once.
  it("asks before a changed choice is dismissed, and closes an untouched one", async () => {
    const onClose = vi.fn();
    renderDialog(true, vi.fn(), LEG, onClose);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("common:discard.title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("roadtrips:timeline.leg.ferry"));
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed while the leg is being saved", async () => {
    let resolve: () => void = () => {};
    vi.mocked(toursApi.setLeg).mockImplementationOnce(
      () => new Promise((r) => (resolve = () => r({} as never)))
    );
    const onClose = vi.fn();
    renderDialog(true, vi.fn(), LEG, onClose);
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.straight/ }));
    fireEvent.click(screen.getByText("roadtrips:timeline.leg.ferry"));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
    expect(screen.getByRole("button", { name: "common:buttons.cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve());
  });

  // forgejo#242: a recorded leg opened on "Gerade Linie", so "Übernehmen"
  // without a second look replaced the recording's line with a straight one.
  it("opens a recorded leg on its recording and leaves it alone when applied", async () => {
    const onClose = vi.fn();
    renderDialog(true, vi.fn(), { ...LEG, source: "track" }, onClose);
    expect(screen.getByRole("radio", { name: /roadtrips:legDialog.track/ })).toBeChecked();
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toursApi.setLeg).not.toHaveBeenCalled();
    expect(toursApi.routeLeg).not.toHaveBeenCalled();
  });

  it("says a recorded line is being replaced, and the button says so too", async () => {
    const onSaved = renderDialog(true, vi.fn(), { ...LEG, source: "track" });
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.straight/ }));
    expect(screen.getByText("roadtrips:legDialog.replacesTrack")).toBeInTheDocument();
    fireEvent.click(screen.getByText("roadtrips:legDialog.applyReplace"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("warns before a hand-drawn line is replaced by a routed one", () => {
    renderDialog(true, vi.fn(), { ...LEG, source: "drawn" });
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    expect(screen.getByText("roadtrips:legDialog.replacesDrawn")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:legDialog.applyReplace")).toBeInTheDocument();
  });
});

/**
 * The same downloading sentence the toast carries (owner request 2026-10-14),
 * so the dialog is not the one surface that silently lacks the link. The
 * link is admin-only — the panel is admin-only — and only the `started` /
 * `running` answer that names a region offers one.
 */
describe("LegDialog — a downloading refusal links to the admin progress page", () => {
  const ADMIN = { id: "u1", username: "admin", isAdmin: true } as never;
  const USER = { id: "u2", username: "user", isAdmin: false } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
  });

  async function renderDownloading(): Promise<void> {
    vi.mocked(toursApi.routeLeg).mockResolvedValueOnce({
      leg: LEG,
      fallbackReason: "untrustworthy",
      fallbackDetail: { kind: "anchors", headOffKm: 671.3, tailOffKm: 517.9 },
      autofetch: { status: "started", region: "Tennessee", etaMinutes: 25 },
    });
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
    await screen.findByText("roadtrips:legDialog.fallback");
  }

  it("renders an inline link to the progress page for an admin", async () => {
    useAuthStore.setState({ user: ADMIN });
    await renderDownloading();

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/admin?section=externalServices");
  });

  it("renders no link for a non-admin", async () => {
    useAuthStore.setState({ user: USER });
    await renderDownloading();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders no link when the refusal started no download", async () => {
    useAuthStore.setState({ user: ADMIN });
    vi.mocked(toursApi.routeLeg).mockResolvedValueOnce({
      leg: LEG,
      fallbackReason: "point_not_near_road",
      fallbackDetail: null,
    });
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.routed/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
    await screen.findByText("roadtrips:legDialog.fallback");

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
