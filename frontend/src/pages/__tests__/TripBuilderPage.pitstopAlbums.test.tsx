import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import {
  DRAFT_ID,
  PITSTOP_ALBUM,
  PITSTOP_KEY,
  reviewDraft,
} from "../../lib/tripBuilder/__tests__/reviewFixtures";
import type { CommitJobResult } from "../../types/tripBuilder";
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
const COMMIT_JOB = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60";
const RESULT: CommitJobResult = {
  status: "committed",
  tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
  created: true,
  roadtrips: [{ id: "r1", name: "Southern loop · Southbridge", stations: 4, nights: 2 }],
  stopIds: [],
  flightsAssigned: 2,
  flightsMovedFrom: [],
  routing: { routed: 0, straight: 4, ferry: 0, providerAvailable: true },
  photoJourneysResolved: 1,
  unknownNights: 1,
  album: { status: "linked", added: 72, alreadyIn: 0 },
};

async function renderReview(): Promise<void> {
  mocks.getDraft.mockResolvedValue(reviewDraft());
  render(
    <MemoryRouter initialEntries={[`/trips/builder?draft=${DRAFT_ID}`]}>
      <Routes>
        <Route path="/trips/builder" element={<TripBuilderPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { level: 1, name: /tripBuilder:review\.title/ });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (typeof fn === "function" && "mockReset" in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mocks.discardDraft.mockResolvedValue(undefined);
  sessionStorage.clear();
});

describe("the success panel's pitstop albums", () => {
  beforeEach(() => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
  });

  it("shows a line per pitstop album and retries that one by name", async () => {
    mocks.waitForJob
      .mockResolvedValueOnce({
        ...RESULT,
        pitstopAlbums: [
          {
            key: PITSTOP_KEY,
            name: PITSTOP_ALBUM,
            album: { status: "failed", error: { kind: "unreachable" } },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "linked",
        albumName: PITSTOP_ALBUM,
        added: 18,
        alreadyIn: 0,
      });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    await renderReview();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.createTrip" }));
    await screen.findByText("tripBuilder:review.success.created");
    const line = document.querySelector(`[data-album="${PITSTOP_KEY}"]`) as HTMLElement;
    fireEvent.click(
      within(line).getByRole("button", { name: "tripBuilder:review.success.retryAlbum" })
    );
    await waitFor(() => expect(mocks.retryAlbum).toHaveBeenCalled());
    expect(mocks.retryAlbum).toHaveBeenCalledWith(RESULT.tripId, {
      pitstopName: PITSTOP_ALBUM,
    });
    await waitFor(() =>
      expect(
        within(line).getByText(
          `tripBuilder:review.success.pitstopAlbum ${JSON.stringify({
            name: PITSTOP_ALBUM,
            added: 18,
            already: 0,
          })}`
        )
      ).toBeInTheDocument()
    );
  });
});
