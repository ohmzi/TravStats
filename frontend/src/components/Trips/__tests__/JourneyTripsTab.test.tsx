import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import JourneyTripsTab from "../JourneyTripsTab";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import type { JourneyFlight } from "../../../lib/flights/journeyFigures";
import type { RoadtripSummary } from "../../../types/roadtrip";

// The cards carry a deck.gl route sketch and jsdom has no ResizeObserver, so
// it is stubbed the way the card's and the list page's own suites stub it.
vi.mock("../../map/CardMap", () => ({ default: () => <div data-testid="card-map" /> }));
vi.mock("../../../lib/api/roadtrips", () => ({ roadtripsApi: { list: vi.fn() } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
// The tab gates its roadtrip cards on the roadtrips domain (the page can now
// mount it for a journey whose only trip is its flights), so the suite states
// the domain like the page's own suite does.
const domains = vi.hoisted(() => ({ roadtrip: true }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: [],
    isEnabled: (key: string) => (key === "roadtrip" ? domains.roadtrip : true),
  }),
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

/**
 * A flight as the journey page hands it down — the fields the flights fold
 * reads (an invented pair of airports, like every fixture here).
 */
function flight(over: Partial<JourneyFlight> = {}): JourneyFlight {
  return {
    depIata: "QQA",
    arrIata: "QQB",
    depLat: 52.31,
    depLon: 4.76,
    arrLat: 55.68,
    arrLon: 12.57,
    departureTime: "2031-09-16T08:00:00.000Z",
    arrivalTime: "2031-09-16T10:30:00.000Z",
    ...over,
  };
}

function renderTab(tripId = "trip-1", flights: readonly JourneyFlight[] = []): void {
  render(
    <MemoryRouter>
      <JourneyTripsTab tripId={tripId} flights={flights} />
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
    domains.roadtrip = true;
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

  it("lists the journey's flights as a trip of its own, first, opening the flights page", async () => {
    vi.mocked(roadtripsApi.list).mockResolvedValue([
      summary({ id: "a", tripId: "trip-1", name: "Anreise", startDate: at("2031-09-16") }),
    ]);
    renderTab("trip-1", [
      flight({ routeDistance: 3400, routeSource: "live_tracking" }),
      flight({ routeDistance: 1200, routeSource: "live_tracking" }),
    ]);

    const cards = await screen.findAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/flights/journeys/trip-1",
      "/roadtrips/a",
    ]);
    const flights = cards[0];
    // Named as the flights, and carrying the flown sum (3.400 + 1.200), its
    // own label, and the flight count.
    expect(flights.textContent).toContain("common:summary.flights");
    expect(within(flights).getByText("4.600")).toBeInTheDocument();
    expect(within(flights).getByText("trips:figures.kmFlown")).toBeInTheDocument();
    expect(within(flights).getByText("2")).toBeInTheDocument();
  });

  it("adds no flights entry for a journey without flights", async () => {
    vi.mocked(roadtripsApi.list).mockResolvedValue([
      summary({ id: "a", tripId: "trip-1", name: "Anreise", startDate: at("2031-09-16") }),
    ]);
    renderTab("trip-1");

    const cards = await screen.findAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(["/roadtrips/a"]);
  });

  it("keeps the flights entry while the roadtrips domain is off — and asks for no roadtrips", async () => {
    domains.roadtrip = false;
    renderTab("trip-1", [flight({ routeDistance: 3400, routeSource: "live_tracking" })]);

    const cards = await screen.findAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(["/flights/journeys/trip-1"]);
    expect(roadtripsApi.list).not.toHaveBeenCalled();
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
