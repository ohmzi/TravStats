import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import FlightTripDetailPage from "../FlightTripDetailPage";
import type { Trip } from "../../types";

vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
// The map is a deck.gl canvas; jsdom has no ResizeObserver, so it is stubbed
// the way `RoadtripDetailPage.test` stubs it. Its own suite covers the drawing.
vi.mock("../../components/Trips/TripMap", () => ({ default: () => <div data-testid="map" /> }));

// The table tab renders the REAL panel — the point of the extraction is that
// the journey page shows the logbook's own table, so a mock here would erase
// the thing the tab exists for. Only its heavy children are stubbed.
vi.mock("../../components/ui/Table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => (
    <table>
      <tbody>{children}</tbody>
    </table>
  ),
}));
vi.mock("../../components/flightsTable/FlightRow", () => ({
  FlightRow: ({ flight, onOpen }: { flight: { id: string }; onOpen: () => void }) => (
    <tr data-testid={`row-${flight.id}`}>
      <td>
        <button type="button" onClick={onOpen}>
          {flight.id}
        </button>
      </td>
    </tr>
  ),
  FLIGHT_COLUMN_LAYOUT: new Proxy({}, { get: () => ({}) }),
}));
vi.mock("../../components/table/ColumnPicker", () => ({ ColumnPicker: () => null }));
vi.mock("../../components/SimplifiedFlightFormV2", () => ({ default: () => null }));
vi.mock("../../components/SpecialFlightModal", () => ({ default: () => null }));
vi.mock("../../components/FlightEditModal", () => ({ default: () => null }));
vi.mock("../../components/FlightRowActions", () => ({ default: () => null }));
vi.mock("../../components/Training/ConfirmModal", () => ({ default: () => null }));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    // The count rides the key so a plural call is still recognisable in the
    // DOM, the same trick the other page suites use.
    t: (k: string, o?: Record<string, unknown>) =>
      o && "count" in o ? `${k}:${String(o.count)}` : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const getById = vi.fn();
const getAll = vi.fn();
const getFacets = vi.fn();
const getLoyaltyMembership = vi.fn();
vi.mock("../../lib/api", () => ({
  flightsApi: {
    getAll: (...a: unknown[]) => getAll(...a),
    getFacets: (...a: unknown[]) => getFacets(...a),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tripsApi: {
    getById: (...a: unknown[]) => getById(...a),
    getAll: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../../lib/api/loyalty", () => ({
  getLoyaltyMembership: (...a: unknown[]) => getLoyaltyMembership(...a),
}));

/** One leg of the fixture journey; every field a case does not set. */
function leg(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "f1",
    airline: "Lufthansa",
    flightNumber: "LH2462",
    depIata: "MUC",
    arrIata: "CPH",
    depLat: 48.35,
    depLon: 11.79,
    arrLat: 55.62,
    arrLon: 12.65,
    depName: "Munich",
    arrName: "Copenhagen",
    depCity: "Munich",
    arrCity: "Copenhagen",
    departureTime: "2026-06-01T08:00:00.000Z",
    arrivalTime: "2026-06-01T09:30:00.000Z",
    status: "flown",
    routeDistance: 850,
    depTimeSemantics: "UTC",
    ...over,
  };
}

const SECOND_LEG = leg({
  id: "f2",
  flightNumber: "LH2464",
  depIata: "CPH",
  arrIata: "ARN",
  depLat: 55.62,
  depLon: 12.65,
  arrLat: 59.65,
  arrLon: 17.92,
  depName: "Copenhagen",
  arrName: "Stockholm",
  depCity: "Copenhagen",
  arrCity: "Stockholm",
  routeDistance: 540,
});

function makeTrip(over: Record<string, unknown> = {}): Trip {
  return {
    id: "t1",
    name: "Baltic 2026",
    startDate: "2026-06-01T00:00:00.000Z",
    endDate: "2026-06-05T00:00:00.000Z",
    status: "completed",
    lodgingStays: [],
    immichAlbums: [],
    flights: [leg(), SECOND_LEG],
    ...over,
  } as unknown as Trip;
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/flights/journeys/:tripId" element={<FlightTripDetailPage />} />
        {/* Where a flight row goes — the criterion the journey page must not
            break by putting the table on a tab. */}
        <Route path="/flights/:id" element={<div data-testid="flight-page" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("FlightTripDetailPage", () => {
  beforeEach(() => {
    localStorage.clear();
    getLoyaltyMembership.mockReset().mockResolvedValue(null);
    getById.mockReset().mockResolvedValue(makeTrip());
    // The panel fetches its own page; one row is enough to prove the tab.
    getAll.mockReset().mockResolvedValue({
      flights: [{ id: "f1", status: "flown", depIata: "MUC", arrIata: "CPH" }],
      total: 1,
      limit: 50,
      offset: 0,
    });
    getFacets.mockReset().mockResolvedValue({
      years: [],
      airlines: [],
      summary: { flights: 2, airlines: 1, airports: 3, withoutAirline: 0 },
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("heads the journey with its name and its figures, the derived distance marked", async () => {
    renderAt("/flights/journeys/t1");
    expect((await screen.findAllByText("Baltic 2026")).length).toBeGreaterThan(0);
    // The distance is a sum of great-circle chords, so it is drawn with the one
    // estimate marker — never as a measured number.
    expect(await screen.findByText(/^~/)).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("draws a dash with its reason, not a zero, when no leg yields a distance", async () => {
    getById.mockResolvedValue(
      makeTrip({
        flights: [
          leg({
            routeDistance: null,
            depLat: Number.NaN,
            depLon: Number.NaN,
            depCity: null,
            arrCity: null,
          }),
        ],
      })
    );
    renderAt("/flights/journeys/t1");
    expect((await screen.findAllByText("Baltic 2026")).length).toBeGreaterThan(0);
    // The reason rides the cell (owner, 2026-10-08); the value is a dash, and
    // the band is explicit that nothing here is a distance.
    expect(screen.getByTitle("flights:journeyPage.figDistanceNone")).toBeInTheDocument();
    expect(screen.queryByText(/^~/)).toBeNull();
  });

  it("rings a picked airport on the map", async () => {
    renderAt("/flights/journeys/t1");
    const station = await screen.findByRole("button", { name: /MUC/ });
    fireEvent.click(station);
    expect(screen.getByRole("button", { name: /MUC/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("swaps the body for the logbook's own table on ?view=table, keeping the head and the band", async () => {
    renderAt("/flights/journeys/t1?view=table");
    // The table tab shows the same table the logbook does, locked to the trip.
    expect(await screen.findByTestId("row-f1")).toBeInTheDocument();
    // The map belongs to the Route tab alone.
    expect(screen.queryByTestId("map")).toBeNull();
    // The head and the band never unmount across the two.
    expect(screen.getAllByText("Baltic 2026").length).toBeGreaterThan(0);
    expect(screen.getByTitle("flights:journeyPage.figDistanceTitle")).toBeInTheDocument();
  });

  it("opens the flight's page from a row in the journey's table", async () => {
    renderAt("/flights/journeys/t1?view=table");
    const row = await screen.findByTestId("row-f1");
    fireEvent.click(row.querySelector("button") as HTMLElement);
    expect(await screen.findByTestId("flight-page")).toBeInTheDocument();
  });

  it("keeps the Logbook back label, as the four sibling detail pages do", async () => {
    renderAt("/flights/journeys/t1");
    await screen.findAllByText("Baltic 2026");
    // Deliberately NOT "Flights" to match the roadtrip page's "Roadtrips": the
    // journey belongs to the Logbook, and four siblings say "Logbook · …". See
    // the `backLabel` comment on the page.
    expect(screen.getByText("flights:detail.backToLogbook")).toBeInTheDocument();
  });

  it("draws no status pill for a journey in the past, as the roadtrip page draws none", async () => {
    getById.mockResolvedValue(
      makeTrip({ startDate: "2000-06-01T00:00:00.000Z", endDate: "2000-06-05T00:00:00.000Z" })
    );
    renderAt("/flights/journeys/t1");
    await screen.findAllByText("Baltic 2026");
    // A past journey reads as past from its date span; the grey "PAST" pill the
    // journey page used to add has no counterpart on the roadtrip page (owner,
    // 2026-10-08).
    expect(screen.queryByText("flights:journeyPage.phase.past")).toBeNull();
    expect(screen.queryByText("flights:journeyPage.phase.planned")).toBeNull();
    expect(screen.queryByText("flights:journeyPage.phase.underway")).toBeNull();
  });
});
