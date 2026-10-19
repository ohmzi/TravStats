import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import TourLegList from "../TourLegList";
import type { LegMode, TourLeg } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const STOP_TITLES = new Map([
  ["a", "Kristiansand"],
  ["b", "Bergen"],
  ["c", "Oslo"],
]);

const NO_TRACK_COVERAGE: ReadonlyMap<string, string> = new Map();

function makeLeg(overrides: Partial<TourLeg>): TourLeg {
  return {
    id: "leg-1",
    fromStopId: "a",
    toStopId: "b",
    distanceKm: 340,
    source: "straight",
    mode: "road",
    confidence: "low",
    waypoints: null,
    drivingMinutes: null,
    ...overrides,
  };
}

interface RenderOverrides {
  routingAvailable?: boolean;
  onSetSource?: (leg: TourLeg, source: "straight" | "drawn") => void;
  onRoute?: (leg: TourLeg) => void;
  trackCoverageByLegId?: ReadonlyMap<string, string>;
  tracksKnown?: boolean;
  onAdoptTrack?: (leg: TourLeg, trackId: string) => void;
  onClear?: (leg: TourLeg) => void;
  onRouteAll?: () => void;
  routingAllInProgress?: boolean;
  onSetMode?: (leg: TourLeg, mode: LegMode) => void;
  modeChangeInFlightLegId?: string | null;
}

function renderList(legs: TourLeg[], overrides: RenderOverrides = {}) {
  const props = {
    routingAvailable: false,
    onSetSource: vi.fn(),
    onRoute: vi.fn(),
    trackCoverageByLegId: NO_TRACK_COVERAGE,
    // Most tests below assert the "no track covers this leg" hint directly,
    // so the default matches "the track list finished loading successfully"
    // — the one state in which that hint is actually true.
    tracksKnown: true,
    onAdoptTrack: vi.fn(),
    onClear: vi.fn(),
    onRouteAll: vi.fn(),
    onSetMode: vi.fn(),
    modeChangeInFlightLegId: null,
    ...overrides,
  };
  render(
    <TourLegList
      title="trips:tours.legsHeading"
      legs={legs}
      stopTitleById={STOP_TITLES}
      {...props}
    />
  );
  return props;
}

/**
 * A row now carries TWO selects. The mode control (owner request
 * 2026-10-12) is the one named by the reused `trips:tours.modeLabel`; the
 * source select has no label of its own — it predates that control — so it
 * is the unlabelled one these tests have always pinned.
 */
function modeSelect(): HTMLElement {
  return screen.getByRole("combobox", { name: "trips:tours.modeLabel" });
}

function sourceSelect(): HTMLElement {
  const select = screen
    .getAllByRole("combobox")
    .find((el) => el.getAttribute("aria-label") === null);
  if (!select) throw new Error("source select not found");
  return select;
}

describe("TourLegList", () => {
  it("offers 'straight' and disabled 'routed'/'track' for a routable leg with no stored line when neither is available", () => {
    const leg = makeLeg({ waypoints: null, mode: "road" });
    renderList([leg], { routingAvailable: false });

    const select = sourceSelect();
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["straight", "routed", "track"]);
    expect(options.find((o) => o.getAttribute("value") === "routed")).toBeDisabled();
    expect(options.find((o) => o.getAttribute("value") === "track")).toBeDisabled();
    // Only one enabled option ("straight") — the select as a whole has
    // nothing to switch to, same rule as before "routed" existed.
    expect(select).toBeDisabled();
    expect(screen.getByText("trips:tours.noLineYet")).toBeInTheDocument();
    expect(screen.getByText("trips:tours.routing.unavailableReason")).toBeInTheDocument();
    expect(screen.getByText("trips:tours.tracks.noCoverageReason")).toBeInTheDocument();
  });

  it("offers 'straight', 'drawn', and disabled 'routed'/'track' for a leg with waypoints when neither is available", () => {
    const leg = makeLeg({
      source: "drawn",
      mode: "road",
      waypoints: [
        [8.0, 58.15],
        [5.32, 60.39],
      ],
    });
    renderList([leg], { routingAvailable: false });

    const select = sourceSelect();
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value")).sort()).toEqual([
      "drawn",
      "routed",
      "straight",
      "track",
    ]);
    expect(options.find((o) => o.getAttribute("value") === "routed")).toBeDisabled();
    expect(options.find((o) => o.getAttribute("value") === "track")).toBeDisabled();
    // Two functional options ("straight", "drawn") — the select stays usable.
    expect(select).not.toBeDisabled();
    expect(screen.queryByText("trips:tours.noLineYet")).not.toBeInTheDocument();
    expect(screen.getByText("trips:tours.routing.unavailableReason")).toBeInTheDocument();
  });

  it("still treats a leg with fewer than two waypoints as having no line", () => {
    // `hasLine` requires waypoints.length >= 2 — a single stray point is
    // not a usable line, so this must fall back to the "straight only" case.
    const leg = makeLeg({ waypoints: [[8.0, 58.15]], mode: "road" });
    renderList([leg], { routingAvailable: false });

    const select = sourceSelect();
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["straight", "routed", "track"]);
    expect(select).toBeDisabled();
  });

  it("enables 'routed' (and does not show the unavailable reason) once a provider is configured", () => {
    const leg = makeLeg({ waypoints: null, mode: "road" });
    renderList([leg], { routingAvailable: true });

    const select = sourceSelect();
    const options = within(select).getAllByRole("option");
    expect(options.find((o) => o.getAttribute("value") === "routed")).not.toBeDisabled();
    // "straight" + "routed" are both functional now.
    expect(select).not.toBeDisabled();
    expect(screen.queryByText("trips:tours.routing.unavailableReason")).not.toBeInTheDocument();
  });

  it("never offers 'routed' for a non-routable leg mode, even when routing is available — 'track' still shows, disabled", () => {
    const ferryLeg = makeLeg({ mode: "ferry", waypoints: null });
    renderList([ferryLeg], { routingAvailable: true });

    const select = sourceSelect();
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["straight", "track"]);
    expect(screen.queryByText("trips:tours.routing.unavailableReason")).not.toBeInTheDocument();
    expect(screen.getByText("trips:tours.tracks.noCoverageReason")).toBeInTheDocument();
  });

  it("enables 'track' (and hides the no-coverage reason) once a track is known to cover this leg", () => {
    const leg = makeLeg({ id: "leg-covered", waypoints: null, mode: "road" });
    const coverage = new Map([["leg-covered", "track-1"]]);
    renderList([leg], { routingAvailable: false, trackCoverageByLegId: coverage });

    const select = sourceSelect();
    const options = within(select).getAllByRole("option");
    expect(options.find((o) => o.getAttribute("value") === "track")).not.toBeDisabled();
    expect(screen.queryByText("trips:tours.tracks.noCoverageReason")).not.toBeInTheDocument();
    // Two functional options now ("straight", "track") — the select is usable.
    expect(select).not.toBeDisabled();
  });

  it("calls onSetSource (not onRoute/onAdoptTrack) with the leg and the chosen manual value", () => {
    const leg = makeLeg({
      source: "straight",
      mode: "road",
      waypoints: [
        [8.0, 58.15],
        [5.32, 60.39],
      ],
    });
    const props = renderList([leg], { routingAvailable: true });

    fireEvent.change(sourceSelect(), { target: { value: "drawn" } });
    expect(props.onSetSource).toHaveBeenCalledWith(leg, "drawn");
    expect(props.onRoute).not.toHaveBeenCalled();
    expect(props.onAdoptTrack).not.toHaveBeenCalled();
  });

  it("calls onRoute (not onSetSource/onAdoptTrack) when 'routed' is selected", () => {
    const leg = makeLeg({ source: "straight", mode: "road", waypoints: null });
    const props = renderList([leg], { routingAvailable: true });

    fireEvent.change(sourceSelect(), { target: { value: "routed" } });
    expect(props.onRoute).toHaveBeenCalledWith(leg);
    expect(props.onSetSource).not.toHaveBeenCalled();
    expect(props.onAdoptTrack).not.toHaveBeenCalled();
  });

  it("calls onAdoptTrack with the leg and the covering track id when 'track' is selected", () => {
    const leg = makeLeg({ id: "leg-covered", source: "straight", mode: "road", waypoints: null });
    const coverage = new Map([["leg-covered", "track-42"]]);
    const props = renderList([leg], { routingAvailable: true, trackCoverageByLegId: coverage });

    fireEvent.change(sourceSelect(), { target: { value: "track" } });
    expect(props.onAdoptTrack).toHaveBeenCalledWith(leg, "track-42");
    expect(props.onSetSource).not.toHaveBeenCalled();
    expect(props.onRoute).not.toHaveBeenCalled();
  });

  it("disables the clear button when the leg is already straight, enables it otherwise", () => {
    const straightLeg = makeLeg({ source: "straight" });
    const { rerender } = render(
      <TourLegList
        title="trips:tours.legsHeading"
        legs={[straightLeg]}
        stopTitleById={STOP_TITLES}
        routingAvailable={false}
        onSetSource={vi.fn()}
        onRoute={vi.fn()}
        trackCoverageByLegId={NO_TRACK_COVERAGE}
        tracksKnown={true}
        onAdoptTrack={vi.fn()}
        onClear={vi.fn()}
        onRouteAll={vi.fn()}
        onSetMode={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "trips:tours.clearLeg" })).toBeDisabled();

    const drawnLeg = makeLeg({
      source: "drawn",
      waypoints: [
        [8.0, 58.15],
        [5.32, 60.39],
      ],
    });
    rerender(
      <TourLegList
        title="trips:tours.legsHeading"
        legs={[drawnLeg]}
        stopTitleById={STOP_TITLES}
        routingAvailable={false}
        onSetSource={vi.fn()}
        onRoute={vi.fn()}
        trackCoverageByLegId={NO_TRACK_COVERAGE}
        tracksKnown={true}
        onAdoptTrack={vi.fn()}
        onClear={vi.fn()}
        onRouteAll={vi.fn()}
        onSetMode={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "trips:tours.clearLeg" })).not.toBeDisabled();
  });

  it("shows the empty-state message when there are no legs, without a 'route all' button", () => {
    renderList([]);
    expect(screen.getByText("trips:tours.noLegs")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "trips:tours.routing.routeAll" })
    ).not.toBeInTheDocument();
  });

  it("calls onRouteAll when the 'route the whole section' button is clicked", () => {
    const leg = makeLeg({});
    // Needs a provider: without one the button is disabled on purpose, so
    // the default `routingAvailable: false` would assert the old bug.
    const props = renderList([leg], { routingAvailable: true });

    fireEvent.click(screen.getByRole("button", { name: "trips:tours.routing.routeAll" }));
    expect(props.onRouteAll).toHaveBeenCalledTimes(1);
  });

  it("puts Route the whole tour on the section's title line, as the shared button", () => {
    renderList([makeLeg({})], { routingAvailable: true });

    const heading = screen.getByRole("heading", { name: "trips:tours.legsHeading" });
    const btn = screen.getByRole("button", { name: "trips:tours.routing.routeAll" });
    expect(heading.parentElement!.contains(btn)).toBe(true);
    expect(btn).toHaveAttribute("data-variant", "secondary");
    expect(btn.style.height).toBe("var(--ts-button-height, var(--ts-size-button-secondary))");
  });

  it("keeps a leg's clear icon at the row's right edge when the row wraps", () => {
    renderList([makeLeg({})]);

    const clear = screen.getByRole("button", { name: "trips:tours.clearLeg" });
    expect(clear.parentElement).toHaveClass("ml-auto");
  });

  it("still draws the heading when there are no legs yet", () => {
    renderList([]);
    expect(screen.getByRole("heading", { name: "trips:tours.legsHeading" })).toBeInTheDocument();
  });

  it("shows a busy label and disables the 'route all' button while a batch request is in flight", () => {
    const leg = makeLeg({});
    // `routingAvailable: true` is load-bearing: the button is also disabled
    // without a provider, so leaving the default would make the assertion
    // below pass for the wrong reason and stop testing the busy state.
    renderList([leg], { routingAllInProgress: true, routingAvailable: true });

    const button = screen.getByRole("button", { name: "trips:tours.routing.routingAll" });
    expect(button).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "trips:tours.routing.routeAll" })
    ).not.toBeInTheDocument();
  });

  // Regression, found in browser UAT: the batch button ignored
  // `routingAvailable`. With no provider configured every leg fell back to
  // its straight chord, nothing was computed, and the toast still announced
  // them as routed — a success message for work that never happened. The
  // per-leg "routed" option was already gated; this button was not.
  it("disables the whole-tour button when no routing provider is configured", () => {
    const leg = makeLeg({ waypoints: null, mode: "road" });
    const { onRouteAll } = renderList([leg], { routingAvailable: false });

    const btn = screen.getByRole("button", { name: "trips:tours.routing.routeAll" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onRouteAll).not.toHaveBeenCalled();
  });

  it("enables the whole-tour button once a provider is configured", () => {
    const leg = makeLeg({ waypoints: null, mode: "road" });
    renderList([leg], { routingAvailable: true });

    expect(screen.getByRole("button", { name: "trips:tours.routing.routeAll" })).toBeEnabled();
  });

  // LOW-2 (final whole-phase review, 2026-08-29): `useTourTracks`'s own doc
  // comment warns that an absent `trackCoverageByLegId` entry means "not
  // fetched yet, or the fetch failed" — never "confirmed to cover nothing".
  // Before this fix, the row rendered the definitive "no track covers this
  // leg" hint in exactly those unknown states too.
  it("does not claim 'no track covers this leg' while the track list is still loading or failed", () => {
    const leg = makeLeg({ waypoints: null, mode: "road" });
    renderList([leg], { tracksKnown: false });

    expect(screen.queryByText("trips:tours.tracks.noCoverageReason")).not.toBeInTheDocument();
  });

  it("still claims 'no track covers this leg' once the track list is known and genuinely has no match", () => {
    const leg = makeLeg({ waypoints: null, mode: "road" });
    renderList([leg], { tracksKnown: true });

    expect(screen.getByText("trips:tours.tracks.noCoverageReason")).toBeInTheDocument();
  });

  // Same finding, second half: after an adopted track is deleted, the leg
  // keeps `source: "track"` (adoption COPIES the geometry, see the DELETE
  // handler's doc comment) but no longer has a covering track id — the row
  // must not show "aus der Spur" selected right next to "no track covers
  // this leg", which contradicts it on the same line.
  it("does not show the no-coverage hint for a leg already adopted from a track, even with no current coverage match", () => {
    const leg = makeLeg({
      source: "track",
      waypoints: [
        [8.0, 58.15],
        [5.32, 60.39],
      ],
    });
    renderList([leg], { tracksKnown: true, trackCoverageByLegId: NO_TRACK_COVERAGE });

    expect(screen.queryByText("trips:tours.tracks.noCoverageReason")).not.toBeInTheDocument();
  });

  // Owner request 2026-10-12: a leg the inference got wrong ("it's not ferry
  // it was roadtrip or vice versa") must be correctable right in the row.
  describe("the mode control", () => {
    it("shows the leg's current mode and offers every selectable mode", () => {
      const leg = makeLeg({ mode: "ferry" });
      renderList([leg]);

      const select = modeSelect();
      expect(select).toHaveValue("ferry");
      const options = within(select).getAllByRole("option");
      expect(options.map((o) => o.getAttribute("value"))).toEqual([
        "road",
        "ferry",
        "foot",
        "bike",
      ]);
      // Every offered mode is a real choice — unlike the source select,
      // nothing here can only fail.
      for (const option of options) expect(option).not.toBeDisabled();
    });

    it("calls onSetMode with the leg and the chosen mode", () => {
      const leg = makeLeg({ mode: "ferry" });
      const props = renderList([leg]);

      fireEvent.change(modeSelect(), { target: { value: "road" } });

      expect(props.onSetMode).toHaveBeenCalledWith(leg, "road");
      expect(props.onSetSource).not.toHaveBeenCalled();
    });

    // `SELECTABLE_LEG_MODES` excludes rail (a rail leg belongs to the rail
    // domain, never a hand pick), but a rail leg STILL shows its own mode as
    // the current value, and may be corrected away from rail — that is the
    // very fix this control exists for.
    it("shows rail as a rail leg's current value without offering it as a choice", () => {
      const leg = makeLeg({ mode: "rail" });
      renderList([leg]);

      const select = modeSelect();
      expect(select).toHaveValue("rail");
      const options = within(select).getAllByRole("option");
      expect(options.map((o) => o.getAttribute("value"))).toEqual([
        "road",
        "ferry",
        "rail",
        "foot",
        "bike",
      ]);
      expect(options.find((o) => o.getAttribute("value") === "rail")).toBeDisabled();
      expect(select).not.toBeDisabled();
    });

    it("disables the mode control of the leg whose write is in flight", () => {
      const leg = makeLeg({ id: "leg-1" });
      renderList([leg], { modeChangeInFlightLegId: "leg-1" });

      expect(modeSelect()).toBeDisabled();
    });

    it("leaves other rows' mode controls usable while one leg's write is in flight", () => {
      const legs = [
        makeLeg({ id: "leg-1" }),
        makeLeg({ id: "leg-2", fromStopId: "b", toStopId: "c" }),
      ];
      renderList(legs, { modeChangeInFlightLegId: "leg-1" });

      const selects = screen.getAllByRole("combobox", { name: "trips:tours.modeLabel" });
      expect(selects[0]).toBeDisabled();
      expect(selects[1]).not.toBeDisabled();
    });
  });
});
