import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import {
  DRAFT_ID,
  PITSTOP_ALBUM,
  PITSTOP_KEY,
  pitstopDraft,
  syncedPitstopDraft,
} from "../../lib/tripBuilder/__tests__/reviewFixtures";
import type { TripBuilderDraft } from "../../types/tripBuilder";
import TripBuilderPage from "../TripBuilderPage";

const mocks = vi.hoisted(() => {
  class JobLostError extends Error {}
  class JobFailedError extends Error {}
  return {
    JobLostError,
    JobFailedError,
    getDraft: vi.fn(),
    commit: vi.fn(),
    retryAlbum: vi.fn(),
    scan: vi.fn(),
    discardDraft: vi.fn(),
    waitForJob: vi.fn(),
    addToast: vi.fn(),
  };
});

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../lib/api/tripBuilder", () => ({
  tripBuilderApi: {
    getDraft: mocks.getDraft,
    commit: mocks.commit,
    retryAlbum: mocks.retryAlbum,
    scan: mocks.scan,
    discardDraft: mocks.discardDraft,
    previewUrl: (id: string, index: number) => `/thumb/${id}/${index}`,
  },
}));
vi.mock("../../lib/api/jobs", () => ({
  waitForJob: mocks.waitForJob,
  JobLostError: mocks.JobLostError,
  JobFailedError: mocks.JobFailedError,
}));
vi.mock("../../hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(), confirmDelete: vi.fn(), confirmDialog: null }),
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/Trips/TripMap", () => ({
  default: (props: { trip: { stops: unknown[] } }) => (
    <div data-testid="map" data-stops={props.trip.stops.length} />
  ),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (select: (s: { addToast: unknown }) => unknown) =>
    select({ addToast: mocks.addToast }),
}));

// Synthetic fixtures only (public repository): invented places, shifted years.

async function renderReview(draft: TripBuilderDraft = pitstopDraft()): Promise<void> {
  mocks.getDraft.mockResolvedValue(draft);
  render(
    <MemoryRouter initialEntries={[`/trips/builder?draft=${DRAFT_ID}`]}>
      <Routes>
        <Route path="/trips/builder" element={<TripBuilderPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { level: 1, name: /tripBuilder:review\.title/ });
}

const card = (): HTMLElement =>
  document.querySelector(`[data-area="${PITSTOP_KEY}"]`) as HTMLElement;
const ALBUM_NAME = `tripBuilder:review.area.album {"name":"${PITSTOP_ALBUM}"}`;

/** The area entry the commit body will carry for the pitstop. */
function pitstopAreaIn(body: { areas: Array<{ key: string }> }): unknown {
  return body.areas.find((entry) => entry.key === PITSTOP_KEY);
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (typeof fn === "function" && "mockReset" in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mocks.discardDraft.mockResolvedValue(undefined);
  sessionStorage.clear();
});

describe("a pitstop area in the review", () => {
  it("starts as a roadtrip with its own album on, drawn once on the map", async () => {
    await renderReview();
    expect(await screen.findByTestId("map")).toHaveAttribute("data-stops", "6");
    const box = card();
    expect(box).toBeInTheDocument();
    expect(
      within(box).getByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toHaveAttribute("aria-checked", "true");
    const album = within(box).getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeChecked();
    expect(album).toBeEnabled();
  });

  it("writes the pitstop as a roadtrip with its album on, as the card showed", async () => {
    await renderReview();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.createTrip" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalled());
    expect(pitstopAreaIn(mocks.commit.mock.calls[0][1])).toMatchObject({
      as: "roadtrip",
      album: true,
    });
  });

  it("carries the album off once it is unticked", async () => {
    await renderReview();
    fireEvent.click(within(card()).getByRole("switch", { name: ALBUM_NAME }));
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.createTrip" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalled());
    expect(pitstopAreaIn(mocks.commit.mock.calls[0][1])).toMatchObject({
      as: "roadtrip",
      album: false,
    });
  });

  it("disables the album switch, and writes the album off, when the kind is not a roadtrip", async () => {
    await renderReview();
    fireEvent.click(
      within(card()).getByRole("radio", { name: "tripBuilder:review.area.kinds.stops" })
    );
    const album = within(card()).getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeDisabled();
    expect(album).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.createTrip" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalled());
    expect(pitstopAreaIn(mocks.commit.mock.calls[0][1])).toMatchObject({
      as: "stops",
      album: false,
    });
  });

  it("refuses the album switch when roadtrips are off, and says why", async () => {
    await renderReview(pitstopDraft({ warnings: [{ code: "roadtripsHidden", params: {} }] }));
    const album = within(card()).getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeDisabled();
    expect(within(card()).getByText("tripBuilder:warnings.roadtripsHidden")).toBeInTheDocument();
  });

  it("shows an already-synced pitstop locked, with its counts, and keeps it in the body", async () => {
    await renderReview(syncedPitstopDraft());
    const box = card();
    const album = within(box).getByRole("switch", { name: ALBUM_NAME });
    expect(album).toBeChecked();
    expect(album).toBeDisabled();
    expect(within(box).getByText("tripBuilder:review.area.synced")).toBeInTheDocument();
    expect(
      within(box).getByText('tripBuilder:review.area.syncedCounts {"stored":18,"count":20}')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.createTrip" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalled());
    expect(pitstopAreaIn(mocks.commit.mock.calls[0][1])).toMatchObject({
      as: "roadtrip",
      album: true,
    });
  });
});
