import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { existingDraft, KEY } from "../../lib/tripBuilder/__tests__/existingFixture";
import { reviewDraft } from "../../lib/tripBuilder/__tests__/reviewFixtures";
import type { DraftDay, TripBuilderDraft } from "../../types/tripBuilder";
import TripBuilderPage from "../TripBuilderPage";

const mocks = vi.hoisted(() => ({ getDraft: vi.fn() }));

vi.mock("../../lib/api/tripBuilder", () => ({
  tripBuilderApi: {
    getDraft: mocks.getDraft,
    commit: vi.fn(),
    retryAlbum: vi.fn(),
    scan: vi.fn(),
    discardDraft: vi.fn().mockResolvedValue(undefined),
    previewUrl: (id: string, index: number) => `/thumb/${id}/${index}`,
  },
}));
vi.mock("../../lib/api/jobs", () => ({
  waitForJob: vi.fn(),
  JobLostError: class extends Error {},
  JobFailedError: class extends Error {},
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/Trips/TripMap", () => ({ default: () => <div data-testid="map" /> }));

// Synthetic fixtures only (public repository): invented places, shifted years.
const day = (when: string, stationKeys: string[]): DraftDay => ({
  day: when,
  photos: 5,
  located: 5,
  stationKeys,
  flightIds: [],
  passedThrough: [],
});

function withDays(): TripBuilderDraft {
  return existingDraft({
    days: [
      day("2031-05-02", [KEY.northvale]),
      day("2031-05-03", [KEY.northvale]),
      day("2031-05-04", [KEY.portCarrow]),
      day("2031-05-05", [KEY.southbridge]),
      day("2031-05-06", [KEY.southbridge]),
    ],
  });
}

async function renderReview(draft: TripBuilderDraft): Promise<void> {
  mocks.getDraft.mockResolvedValue(draft);
  render(
    <MemoryRouter initialEntries={[`/trips/builder?draft=${draft.id}`]}>
      <Routes>
        <Route path="/trips/builder" element={<TripBuilderPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { level: 1, name: /tripBuilder:review\.title/ });
}

const row = (key: string): HTMLElement | null => document.querySelector(`[data-station="${key}"]`);

beforeEach(() => {
  mocks.getDraft.mockReset();
  sessionStorage.clear();
});

describe("the review of an existing trip", () => {
  it("collapses the unchanged rows and says what the others are", async () => {
    await renderReview(withDays());
    expect(row(KEY.northvale)).toBeNull();
    expect(
      within(row(KEY.portCarrow)!).getByText("tripBuilder:existing.status.changed")
    ).toBeInTheDocument();
    expect(
      within(row(KEY.southbridge)!).getByText("tripBuilder:existing.status.new")
    ).toBeInTheDocument();
  });

  it("brings the unchanged rows back on request", async () => {
    await renderReview(withDays());
    fireEvent.click(screen.getByRole("switch", { name: "tripBuilder:existing.showUnchanged" }));
    expect(
      within(row(KEY.northvale)!).getByText("tripBuilder:existing.status.same")
    ).toBeInTheDocument();
  });

  it("lists what the photos do not show, in the area and among the stops, and takes the decision", async () => {
    await renderReview(withDays());
    expect(screen.getByText("tripBuilder:existing.notSeen.title")).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:existing.notSeenStops.title")).toBeInTheDocument();
    expect(screen.getByText("Port Carrow Harbour")).toBeInTheDocument();
    const kelmore = screen.getByRole("switch", { name: "Kelmore" });
    expect(kelmore).toBeChecked();
    fireEvent.click(kelmore);
    expect(screen.getByRole("switch", { name: "Kelmore" })).not.toBeChecked();
  });

  it("shows none of this for a new trip", async () => {
    await renderReview(reviewDraft());
    expect(screen.queryByRole("switch", { name: "tripBuilder:existing.showUnchanged" })).toBeNull();
    expect(screen.queryByText("tripBuilder:existing.notSeen.title")).toBeNull();
    expect(screen.queryByText(/tripBuilder:existing\.status/)).toBeNull();
  });
});
