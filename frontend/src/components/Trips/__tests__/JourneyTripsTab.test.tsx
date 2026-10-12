import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import JourneyTripsTab from "../JourneyTripsTab";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import type { RoadtripSummary } from "../../../types/roadtrip";

// The cards carry a deck.gl route sketch and jsdom has no ResizeObserver, so
// it is stubbed the way the card's and the list page's own suites stub it.
vi.mock("../../map/CardMap", () => ({ default: () => <div data-testid="card-map" /> }));
vi.mock("../../../lib/api/roadtrips", () => ({ roadtripsApi: { list: vi.fn() } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

function summary(over: Partial<RoadtripSummary>): RoadtripSummary {
  return {
    id: "r",
    kind: "roadtrip",
    tripId: null,
    tripName: null,
    name: "R",
    mode: "road",
    color: null,
    vehicle: "campervan",
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: null,
    endDate: null,
    distanceKm: 100,
    drivenKm: 90,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 3,
    cityNames: ["Bergen", "Oslo"],
    driveCount: 2,
    stayNights: 1,
    freeNights: 1,
    nights: 2,
    nightsKnown: true,
    placesSlept: 2,
    trackCount: 0,
    tourCount: 0,
    countries: ["NO"],
    points: [],
    path: [],
    ...over,
  };
}

const at = (d: string) => `${d}T00:00:00.000Z`;

function renderTab(tripId = "trip-1"): void {
  render(
    <MemoryRouter>
      <JourneyTripsTab tripId={tripId} />
    </MemoryRouter>
  );
}

/**
 * The Trips tab (spec 2026-10-12 §3): the journey's trips as cards, promoted
 * from the overview's roadtrips section. Loading, failed and empty stay three
 * different pictures — an empty grid and a swallowed error look the same.
 */
describe("JourneyTripsTab", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00.000Z")); // an instant, not the host's noon
    vi.mocked(roadtripsApi.list).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("draws only this journey's trips, in travel order, each card opening its page", async () => {
    vi.mocked(roadtripsApi.list).mockResolvedValue([
      summary({
        id: "b",
        tripId: "trip-1",
        name: "Fjorde",
        startDate: at("2026-09-18"),
        endDate: at("2026-09-28"),
      }),
      summary({
        id: "a",
        tripId: "trip-1",
        name: "Anreise",
        startDate: at("2026-09-16"),
        endDate: at("2026-09-17"),
      }),
      summary({ id: "x", tripId: "trip-2", name: "Andere Reise", startDate: at("2026-01-01") }),
      summary({ id: "s", tripId: null, name: "Allein unterwegs" }),
    ]);
    renderTab();

    const cards = await screen.findAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/roadtrips/a",
      "/roadtrips/b",
    ]);
    expect(screen.queryByText("Andere Reise")).not.toBeInTheDocument();
    expect(screen.queryByText("Allein unterwegs")).not.toBeInTheDocument();
  });

  it("says the journey has no trip yet — with its own words, not an empty grid", async () => {
    vi.mocked(roadtripsApi.list).mockResolvedValue([
      summary({ id: "x", tripId: "trip-2", name: "Andere Reise" }),
    ]);
    renderTab();

    expect(await screen.findByText("trips:detail.tripsEmpty")).toBeInTheDocument();
  });

  it("keeps a failed load apart from the empty state, and re-asks on retry", async () => {
    vi.mocked(roadtripsApi.list)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([
        summary({ id: "a", tripId: "trip-1", name: "Anreise", startDate: at("2026-09-16") }),
      ]);
    renderTab();

    expect(await screen.findByText("roadtrips:loadError")).toBeInTheDocument();
    expect(screen.queryByText("trips:detail.tripsEmpty")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));

    const cards = await screen.findAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(["/roadtrips/a"]);
  });
});
