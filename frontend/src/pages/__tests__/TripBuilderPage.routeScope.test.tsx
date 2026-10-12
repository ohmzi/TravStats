/**
 * The trip-scoped review (owner request 2026-10-12): a draft whose target names
 * a roadtrip says so in its title, its caption and its primary action, and
 * offers no flight decisions — while the journey-wide draft keeps every one of
 * its own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { existingDraft } from "../../lib/tripBuilder/__tests__/existingFixture";
import type { TripBuilderDraft } from "../../types/tripBuilder";
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
const ROUTE = "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e";

const FLIGHT = {
  id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  label: "ZZ101 ZZA→ZZB",
  depIata: "ZZA",
  arrIata: "ZZB",
  depLocal: "2031-05-02 07:00",
  arrLocal: "2031-05-02 08:40",
  precise: true,
  currentTrip: null,
  defaultAssign: true,
  locked: false,
};

function scopedDraft(): TripBuilderDraft {
  return existingDraft({
    target: {
      kind: "existing",
      tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
      tripName: "Northvale loop",
      routeId: ROUTE,
      routeName: "Northvale loop",
    },
    flights: [FLIGHT],
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
  await screen.findByRole("heading", { level: 1 });
}

beforeEach(() => {
  mocks.getDraft.mockReset();
  sessionStorage.clear();
});

describe("the review of a trip-scoped re-sync", () => {
  it("says it updates the trip, in both the title and the primary action", async () => {
    await renderReview(scopedDraft());

    expect(
      screen.getByRole("heading", { level: 1, name: "tripBuilder:review.titleExistingRoute" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tripBuilder:existing.header.updateRoute" })
    ).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:review.header.existingRoute")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tripBuilder:existing.header.update" })
    ).not.toBeInTheDocument();
  });

  it("offers no flight decisions, because the commit writes the trip alone", async () => {
    await renderReview(scopedDraft());

    expect(screen.queryByText("tripBuilder:review.flights.title")).not.toBeInTheDocument();
  });

  it("keeps the journey's own words and flight decisions for a journey-wide draft", async () => {
    await renderReview(existingDraft({ flights: [FLIGHT] }));

    expect(
      screen.getByRole("heading", { level: 1, name: "tripBuilder:review.titleExisting" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tripBuilder:existing.header.update" })
    ).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:review.header.existingTrip")).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:review.flights.title")).toBeInTheDocument();
  });
});
