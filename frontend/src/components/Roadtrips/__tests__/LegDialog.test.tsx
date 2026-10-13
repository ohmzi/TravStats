import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import LegDialog from "../LegDialog";
import { toursApi } from "../../../lib/api/tours";
import type { TourLeg } from "../../../types/tour";

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
  leg: TourLeg = LEG
): ReturnType<typeof vi.fn> {
  render(
    <MemoryRouter>
      <LegDialog
        routeId="rt"
        leg={leg}
        from={{ id: "a", title: "Gudvangen" }}
        to={{ id: "b", title: "Kaupanger" }}
        routingAvailable={routingAvailable}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </MemoryRouter>
  );
  return onSaved;
}

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
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));

    await screen.findByText("roadtrips:legDialog.fallback");
    expect(toursApi.setLeg).not.toHaveBeenCalled();
  });

  it("saves a straight line when the reader picks one", async () => {
    const onSaved = renderDialog(true, vi.fn(), { ...LEG, source: "drawn" });
    fireEvent.click(screen.getByRole("radio", { name: /roadtrips:legDialog.straight/ }));
    fireEvent.click(screen.getByText("roadtrips:legDialog.apply"));
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
});
