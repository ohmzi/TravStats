import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import {
  DRAFT_ID,
  FLIGHT_OUT,
  STOPOVER,
  STOPOVER_IN,
  STOPOVER_OUT,
  stopoverDraft,
} from "../../lib/tripBuilder/__tests__/reviewFixtures";
import type { CommitJobResult, TripBuilderDraft } from "../../types/tripBuilder";
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
// Exported for the success-panel describe Task E3 appends to this file.
export const COMMIT_JOB = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60";
export const RESULT: CommitJobResult = {
  status: "committed",
  tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
  created: true,
  roadtrips: [{ id: "r1", name: "Southern loop · Northvale", stations: 4, nights: 2 }],
  stopIds: [],
  flightsAssigned: 2,
  flightsMovedFrom: [],
  routing: { routed: 0, straight: 4, ferry: 0, providerAvailable: true },
  photoJourneysResolved: 1,
  unknownNights: 1,
  album: { status: "linked", added: 72, alreadyIn: 0 },
};

async function renderReview(draft: TripBuilderDraft = stopoverDraft()): Promise<void> {
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

const card = (): HTMLElement => document.querySelector("[data-stopover]") as HTMLElement;

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (typeof fn === "function" && "mockReset" in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mocks.discardDraft.mockResolvedValue(undefined);
  sessionStorage.clear();
});

describe("a stopover the scan offers", () => {
  it("shows its city, the hours at the airport, the counts and the tour's stops", async () => {
    await renderReview();
    const box = card();
    expect(box).toBeInTheDocument();
    expect(
      within(box).getByText(
        'tripBuilder:review.stopovers.heading {"city":"Sundhavn","day":"04.05.2031","hours":7,"airport":"ZSD"}'
      )
    ).toBeInTheDocument();
    expect(
      within(box).getByText(
        'tripBuilder:review.stopovers.photos {"count":24} · tripBuilder:review.stopovers.outing {"count":19}'
      )
    ).toBeInTheDocument();
    expect(within(box).getByText("Sundhavn Old Town")).toBeInTheDocument();
    expect(within(box).getByText("Sundhavn Harbour")).toBeInTheDocument();
    expect(within(box).getAllByText("→")).toHaveLength(2);
    expect(within(box).getByText("tripBuilder:review.stopovers.albumNote")).toBeInTheDocument();
  });

  it("starts both switches off, with the album gated on the roadtrip", async () => {
    await renderReview();
    const box = card();
    const roadtrip = within(box).getByRole("switch", {
      name: "tripBuilder:review.stopovers.roadtrip",
    });
    const album = within(box).getByRole("switch", {
      name: `tripBuilder:review.stopovers.album {"title":"Sundhavn 2031 Road Trip"}`,
    });
    expect(roadtrip).not.toBeChecked();
    expect(album).not.toBeChecked();
    expect(album).toBeDisabled();
    fireEvent.click(roadtrip);
    expect(
      within(box).getByRole("switch", { name: "tripBuilder:review.stopovers.roadtrip" })
    ).toBeChecked();
    expect(
      within(box).getByRole("switch", {
        name: `tripBuilder:review.stopovers.album {"title":"Sundhavn 2031 Road Trip"}`,
      })
    ).toBeEnabled();
    fireEvent.click(
      within(box).getByRole("switch", {
        name: `tripBuilder:review.stopovers.album {"title":"Sundhavn 2031 Road Trip"}`,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.createTrip" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalled());
    const body = mocks.commit.mock.calls[0][1];
    expect(body.stopovers).toEqual([{ key: STOPOVER.key, roadtrip: true, album: true }]);
    expect(body.flightIds).toEqual([FLIGHT_OUT, STOPOVER_IN, STOPOVER_OUT]);
  });

  it("draws the tour on the map once the roadtrip switch is on", async () => {
    await renderReview();
    expect(await screen.findByTestId("map")).toHaveAttribute("data-stops", "6");
    fireEvent.click(
      within(card()).getByRole("switch", { name: "tripBuilder:review.stopovers.roadtrip" })
    );
    expect(screen.getByTestId("map")).toHaveAttribute("data-stops", "9");
  });

  it("refuses the roadtrip switch when roadtrips are off, and says why", async () => {
    await renderReview(stopoverDraft({ warnings: [{ code: "roadtripsHidden", params: {} }] }));
    const roadtrip = within(card()).getByRole("switch", {
      name: "tripBuilder:review.stopovers.roadtrip",
    });
    expect(roadtrip).toBeDisabled();
    expect(within(card()).getByText("tripBuilder:warnings.roadtripsHidden")).toBeInTheDocument();
  });

  it("shows an already-synced stopover with both switches on and locked", async () => {
    await renderReview(
      stopoverDraft({
        stopovers: [{ ...STOPOVER, roadtripId: "r-9", storedPhotoCount: 22 }],
      })
    );
    const box = card();
    const roadtrip = within(box).getByRole("switch", {
      name: "tripBuilder:review.stopovers.roadtrip",
    });
    const album = within(box).getByRole("switch", {
      name: `tripBuilder:review.stopovers.album {"title":"Sundhavn 2031 Road Trip"}`,
    });
    expect(roadtrip).toBeChecked();
    expect(roadtrip).toBeDisabled();
    expect(album).toBeChecked();
    expect(album).toBeDisabled();
    expect(within(box).getByText("tripBuilder:review.stopovers.synced")).toBeInTheDocument();
    expect(
      within(box).getByText('tripBuilder:review.stopovers.syncedCounts {"stored":22,"count":24}')
    ).toBeInTheDocument();
  });

  it("keeps a stopover's switches when they are flipped twice", async () => {
    await renderReview();
    const albumName = `tripBuilder:review.stopovers.album {"title":"Sundhavn 2031 Road Trip"}`;
    const roadtripName = "tripBuilder:review.stopovers.roadtrip";
    fireEvent.click(within(card()).getByRole("switch", { name: roadtripName }));
    fireEvent.click(within(card()).getByRole("switch", { name: albumName }));
    fireEvent.click(within(card()).getByRole("switch", { name: roadtripName }));
    expect(within(card()).getByRole("switch", { name: roadtripName })).not.toBeChecked();
    expect(within(card()).getByRole("switch", { name: albumName })).not.toBeChecked();
    expect(within(card()).getByRole("switch", { name: albumName })).toBeDisabled();
  });
});

describe("the success panel's stopover albums", () => {
  beforeEach(() => {
    mocks.commit.mockResolvedValue({ jobId: COMMIT_JOB });
  });

  it("shows a line per stopover album and retries that one by key", async () => {
    mocks.waitForJob
      .mockResolvedValueOnce({
        ...RESULT,
        stopoverAlbums: [
          {
            key: STOPOVER.key,
            name: STOPOVER.title,
            album: { status: "failed", error: { kind: "unreachable" } },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "linked",
        albumName: STOPOVER.title,
        added: 24,
        alreadyIn: 0,
      });
    mocks.retryAlbum.mockResolvedValue({ jobId: "album-job" });
    await renderReview();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.createTrip" }));
    await screen.findByText("tripBuilder:review.success.created");
    const line = document.querySelector(`[data-album="${STOPOVER.key}"]`) as HTMLElement;
    fireEvent.click(
      within(line).getByRole("button", { name: "tripBuilder:review.success.retryAlbum" })
    );
    await waitFor(() => expect(mocks.retryAlbum).toHaveBeenCalled());
    expect(mocks.retryAlbum).toHaveBeenCalledWith(RESULT.tripId, {
      stopoverKey: STOPOVER.key,
    });
    await waitFor(() =>
      expect(
        within(line).getByText(
          'tripBuilder:review.success.stopoverAlbum {"name":"Sundhavn 2031 Road Trip","added":24,"already":0}'
        )
      ).toBeInTheDocument()
    );
  });
});
