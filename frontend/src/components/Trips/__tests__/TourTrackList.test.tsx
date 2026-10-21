import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TourTrackList from "../TourTrackList";
import type { TourTrackMeta } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function makeTrack(overrides: Partial<TourTrackMeta> = {}): TourTrackMeta {
  return {
    id: "track-1",
    routeId: "route-1",
    source: "gpx",
    name: "Day 1",
    startedAt: "2026-06-01T08:00:00.000Z",
    endedAt: "2026-06-01T16:00:00.000Z",
    pointCount: 1200,
    jitterDropped: 0,
    distanceKm: 340.4,
    truncated: false,
    ascentM: null,
    descentM: null,
    movingSeconds: null,
    externalRef: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

interface RenderOverrides {
  tracks?: TourTrackMeta[];
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  uploading?: boolean;
  onUpload?: (file: File) => void;
  onDelete?: (track: TourTrackMeta) => void;
  pulling?: boolean;
  dawarichAvailable?: boolean;
  onPullDawarich?: () => void;
  onDownload?: (track: TourTrackMeta) => void;
  onImportStrava?: () => void;
  stravaUnavailableReason?: string;
}

function renderList(overrides: RenderOverrides = {}) {
  const props = {
    title: "trips:tours.tracks.heading",
    tracks: [],
    loading: false,
    loadError: false,
    onRetry: vi.fn(),
    uploading: false,
    onUpload: vi.fn(),
    onDelete: vi.fn(),
    pulling: false,
    dawarichAvailable: false,
    onPullDawarich: vi.fn(),
    ...overrides,
  };
  const rendered = render(<TourTrackList {...props} />);
  return { ...props, ...rendered };
}

const openMenu = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /trips:tours.tracks.addRecording/ }));
};

describe("TourTrackList", () => {
  it("shows the loading state and nothing else", () => {
    renderList({ loading: true });
    expect(screen.getByText("trips:tours.tracks.loading")).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.tracks.empty")).not.toBeInTheDocument();
    expect(screen.queryByText("trips:tours.tracks.loadError")).not.toBeInTheDocument();
  });

  it("shows the error state with a retry action, distinct from the empty state", () => {
    const props = renderList({ loadError: true, tracks: [] });
    expect(screen.getByText("trips:tours.tracks.loadError")).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.tracks.empty")).not.toBeInTheDocument();

    // The shared secondary button, not an underlined word.
    const retry = screen.getByRole("button", { name: "common:buttons.retry" });
    expect(retry).toHaveAttribute("data-variant", "secondary");
    fireEvent.click(retry);
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state only once loading succeeded with zero tracks", () => {
    renderList({ tracks: [] });
    expect(screen.getByText("trips:tours.tracks.empty")).toBeInTheDocument();
  });

  it("renders each track's window, point count, distance, and source", () => {
    renderList({ tracks: [makeTrack()] });
    expect(screen.getByText("trips:tours.tracks.source.gpx")).toBeInTheDocument();
    expect(screen.getByText("340,4 km")).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.tracks.empty")).not.toBeInTheDocument();
  });

  it("offers every source through one Add recording menu on the section's title line", () => {
    renderList({ dawarichAvailable: true, onImportStrava: vi.fn() });
    const heading = screen.getByRole("heading", { name: "trips:tours.tracks.heading" });
    const trigger = screen.getByRole("button", { name: /trips:tours.tracks.addRecording/ });
    expect(heading.parentElement!.contains(trigger)).toBe(true);
    openMenu();
    expect(
      screen.getByRole("menuitem", { name: "trips:tours.tracks.uploadFile" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "trips:tours.tracks.dawarich.pullLabel" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "roadtrips:strava.importButton" })
    ).toBeInTheDocument();
  });

  it("opens the file picker from the Upload item, and the same file can be picked twice", () => {
    const onUpload = vi.fn();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    const { container } = renderList({ onUpload });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "trips:tours.tracks.uploadFile" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // The input is not inside a <button> any more — that is what made it unreliable.
    expect(input.closest("button")).toBeNull();
    const file = new File(["<gpx/>"], "a.gpx", { type: "application/gpx+xml" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  it("keeps the file input out of the tab order and the accessibility tree", () => {
    const { container } = renderList();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute("aria-hidden", "true");
    expect(input).toHaveAttribute("tabindex", "-1");
  });

  it("disables the menu and says so while an upload runs", () => {
    renderList({ uploading: true });
    expect(screen.getByRole("button", { name: /trips:tours.tracks.uploading/ })).toBeDisabled();
  });

  it("disables the menu and says so while a pull runs", () => {
    renderList({ dawarichAvailable: true, pulling: true });
    expect(
      screen.getByRole("button", { name: /trips:tours.tracks.dawarich.pulling/ })
    ).toBeDisabled();
  });

  it("keeps Dawarich in the menu, disabled, with its reason, when no connection is configured", () => {
    const onPullDawarich = vi.fn();
    renderList({ dawarichAvailable: false, onPullDawarich });
    openMenu();
    const item = screen.getByRole("menuitem", { name: /trips:tours.tracks.dawarich.pullLabel/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("trips:tours.tracks.dawarich.unavailableReason")).toBeVisible();
    fireEvent.click(item);
    expect(onPullDawarich).not.toHaveBeenCalled();
  });

  it("pulls from Dawarich when the item is chosen", () => {
    const onPullDawarich = vi.fn();
    renderList({ dawarichAvailable: true, onPullDawarich });
    openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "trips:tours.tracks.dawarich.pullLabel" })
    );
    expect(onPullDawarich).toHaveBeenCalledTimes(1);
  });

  it("keeps Strava in the menu, disabled, with its reason, when it is not connected", () => {
    // Owner, 2026-10-15: one menu for the three sources, and the spec's
    // "an unavailable source is a disabled item that shows its reason".
    // Strava used to be spread in only when connected, so a reader who had not
    // connected it found a menu that simply lacked the source they came for —
    // and could not tell whether the app does Strava at all.
    const onImportStrava = vi.fn();
    renderList({ onImportStrava: undefined });
    openMenu();
    const item = screen.getByRole("menuitem", { name: /roadtrips:strava.importButton/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("trips:tours.tracks.strava.unavailableReason")).toBeVisible();
    fireEvent.click(item);
    expect(onImportStrava).not.toHaveBeenCalled();
  });

  it("says the instance has no Strava app when that is the reason", () => {
    // The reader's own missing connection and the instance's missing Strava
    // app are different next steps — one is Settings → Services, the other an
    // admin's — so the caller that knows which passes its own sentence.
    renderList({
      onImportStrava: undefined,
      stravaUnavailableReason: "roadtrips:strava.askAdmin",
    });
    openMenu();
    const item = screen.getByRole("menuitem", { name: /roadtrips:strava.importButton/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("roadtrips:strava.askAdmin")).toBeVisible();
  });

  // Data-integrity audit 2026-09-19, finding 4: the delete link used to call
  // `onDelete` on the first click. For a track uploaded as a GPX the server
  // keeps the parsed points and not the file, so that click destroyed the
  // only copy — with no question asked and nothing to undo it with.
  it("asks before deleting, and deletes nothing until the question is answered", () => {
    const track = makeTrack();
    const props = renderList({ tracks: [track] });

    fireEvent.click(screen.getByRole("button", { name: "trips:tours.tracks.deleteLabel" }));

    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("trips:tours.tracks.deleteConfirm.title")).toBeInTheDocument();
  });

  it("names the track in the question — its window and its point count", () => {
    renderList({ tracks: [makeTrack()] });
    fireEvent.click(screen.getByRole("button", { name: "trips:tours.tracks.deleteLabel" }));

    // The mocked `t` returns the key, so the interpolation itself cannot be
    // read here. What IS observable is that the message key is used with the
    // two values that identify the row — a dialog that named neither would
    // have to reach this component without them.
    expect(screen.getByText("trips:tours.tracks.deleteConfirm.message")).toBeInTheDocument();
  });

  it("calls onDelete with the track once the delete is confirmed", () => {
    const track = makeTrack();
    const props = renderList({ tracks: [track] });

    fireEvent.click(screen.getByRole("button", { name: "trips:tours.tracks.deleteLabel" }));
    fireEvent.click(screen.getByText("trips:tours.tracks.deleteConfirm.confirm"));

    expect(props.onDelete).toHaveBeenCalledWith(track);
  });

  it("deletes nothing when the question is cancelled", () => {
    const props = renderList({ tracks: [makeTrack()] });

    fireEvent.click(screen.getByRole("button", { name: "trips:tours.tracks.deleteLabel" }));
    fireEvent.click(screen.getByText("common:buttons.cancel"));

    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("trips:tours.tracks.deleteConfirm.title")).not.toBeInTheDocument();
  });

  // MEDIUM-2 (final whole-phase review, 2026-08-29): a Dawarich pull cut
  // short by the server's hard page cap must be visibly marked incomplete —
  // its distance is a partial measurement, not the full one it looks like.
  it("shows a truncated badge for a track whose pull was cut short", () => {
    renderList({ tracks: [makeTrack({ truncated: true })] });
    expect(screen.getByText("trips:tours.tracks.truncated")).toBeInTheDocument();
  });

  it("shows no truncated badge for a complete track", () => {
    renderList({ tracks: [makeTrack({ truncated: false })] });
    expect(screen.queryByText("trips:tours.tracks.truncated")).not.toBeInTheDocument();
  });

  it("offers each recording as a GPX file, and hands over the one clicked", () => {
    const onDownload = vi.fn();
    const second = makeTrack({ id: "track-2" });
    renderList({ tracks: [makeTrack(), second], onDownload });
    const buttons = screen.getAllByRole("button", { name: "roadtrips:trackArchive.downloadOne" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(onDownload).toHaveBeenCalledWith(second);
  });

  it("draws no download control where no page can take the file", () => {
    renderList({ tracks: [makeTrack()] });
    expect(
      screen.queryByRole("button", { name: "roadtrips:trackArchive.downloadOne" })
    ).not.toBeInTheDocument();
  });

  it("draws a recording's actions as row icons, not text buttons", () => {
    renderList({ tracks: [makeTrack()], onDownload: vi.fn() });
    for (const name of ["roadtrips:trackArchive.downloadOne", "trips:tours.tracks.deleteLabel"]) {
      const button = screen.getByRole("button", { name });
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button).toHaveAttribute("title", name);
    }
  });

  it("keeps a recording's icons at the row's right edge when the row wraps", () => {
    renderList({ tracks: [makeTrack()], onDownload: vi.fn() });
    const icons = screen.getByRole("button", { name: "trips:tours.tracks.deleteLabel" })
      .parentElement as HTMLElement;
    expect(icons.parentElement).toHaveClass("ml-auto");
  });

  it("says under a track how many fixes were left out as GPS jitter (forgejo#319)", () => {
    renderList({ tracks: [makeTrack({ jitterDropped: 37 })] });
    expect(screen.getByTestId("track-jitter-note")).toHaveTextContent("common:trackJitter.dropped");
  });
});
