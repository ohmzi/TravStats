import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Cruise, Flight, Trip } from "../../types";

/**
 * The inbox's time flags link to an EDITOR, not a page (ADR 0002, plan Phase
 * 3b; `components/DataQuality/timeFlagLinks.ts`). These pin the receiving
 * end: `?edit=1` opens the flight's and the cruise's editor once the record
 * has loaded, and the parameter is gone afterwards — a reload or a Back must
 * not open the editor a second time. The editors themselves are stubbed; each
 * has its own suite.
 *
 * The journey's `?edit=1` is the third receiver: its form is a PAGE since the
 * shared-template design (spec 2026-10-12 §4), so the flag hands the reader
 * over to `/trips/:id/edit` rather than opening a modal on the detail page.
 */

const getFlight = vi.fn();
const getCruise = vi.fn();
const getTrip = vi.fn();

vi.mock("../../lib/api", () => ({
  flightsApi: {
    getById: (...a: unknown[]) => getFlight(...a),
    getTrack: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tripsApi: {
    getAll: vi.fn().mockResolvedValue([]),
    getById: (...a: unknown[]) => getTrip(...a),
  },
  cruiseApi: { get: (...a: unknown[]) => getCruise(...a), remove: vi.fn() },
}));
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/api/tours", () => ({
  toursApi: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/FlightEditModal", () => ({
  default: () => <div data-testid="flight-editor" />,
}));
vi.mock("../../components/SpecialFlightModal", () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="special-flight-editor" /> : null,
}));
vi.mock("../../components/Cruise/CruiseEditModal", () => ({
  CruiseEditModal: () => <div data-testid="cruise-editor" />,
}));
vi.mock("../../components/Cruise/CruiseRouteMap", () => ({
  CruiseRouteMap: () => <div data-testid="map-stub" />,
}));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["flight", "cruise", "lodging"], isEnabled: () => true }),
}));
vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));
// The journey overview draws its map and its trips chain; both have their own
// suites, and here they would only mount a canvas jsdom has no WebGL for and
// fetch the roadtrips list (forgejo#110).
vi.mock("../../components/Trips/TripMapWithTours", () => ({
  default: () => <div data-testid="map" />,
}));
vi.mock("../../components/Roadtrips/useTripRoadtrips", () => ({
  useTripRoadtrips: () => ({ rows: [], settled: true }),
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import FlightDetailPage from "../FlightDetailPage";
import CruiseDetailPage from "../CruiseDetailPage";
import TripDetailPage from "../TripDetailPage";

function LocationProbe(): JSX.Element {
  return <div data-testid="search">{useLocation().search}</div>;
}

/** The pathname probe, for the hand-offs that leave the page they arrived on. */
function Where(): JSX.Element {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path: string, entry: string, page: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path={path}
          element={
            <>
              {page}
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const FLIGHT = {
  id: "f1",
  airline: "Lufthansa",
  flightNumber: "LH2462",
  depIata: "MUC",
  arrIata: "CPH",
  departureTime: "2026-12-21T18:06:00.000Z",
  arrivalTime: "2026-12-21T19:36:00.000Z",
  status: "scheduled",
  createdAt: "2026-01-01T00:00:00.000Z",
} as Flight;

const CRUISE = {
  id: "c1",
  userId: "u1",
  shipId: null,
  ship: null,
  shipNameOverride: "AIDAnova",
  cruiseLine: "AIDA",
  routeName: null,
  departurePortId: null,
  departurePort: null,
  arrivalPortId: null,
  arrivalPort: null,
  startDate: "2024-05-13T00:00:00.000Z",
  endDate: "2024-05-20T00:00:00.000Z",
  status: "flown",
  cabinNumber: null,
  cabinType: null,
  deck: null,
  bookingReference: null,
  price: null,
  currency: null,
  notes: null,
  tags: [],
  companions: [],
  tripId: null,
  bookingId: null,
  stops: [],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
} as unknown as Cruise;

const TRIP = {
  id: "trip-1",
  userId: "u1",
  name: "Tabprobe",
  description: null,
  color: null,
  createdAt: "2031-05-01T00:00:00.000Z",
  updatedAt: "2031-05-01T00:00:00.000Z",
  startDate: "2031-05-13T00:00:00.000Z",
  endDate: "2031-05-15T00:00:00.000Z",
  status: "completed",
  category: null,
  tags: [],
  companions: [],
  notes: null,
  summary: null,
  originLabel: null,
  destinationLabel: null,
  coverImageUrl: null,
  icon: null,
  countries: [],
  flights: [],
  cruises: [],
  stops: [],
  journalEntries: [],
  photos: [],
  lodgingStays: [],
  bookings: [],
} as unknown as Trip;

describe("?edit=1 opens the record's editor", () => {
  beforeEach(() => {
    getFlight.mockReset();
    getCruise.mockReset();
    getTrip.mockReset();
  });

  it("hands the journey's flag to its edit page — the form's home since the template", async () => {
    getTrip.mockResolvedValue(TRIP);
    render(
      <MemoryRouter initialEntries={["/trips/trip-1?edit=1"]}>
        <Routes>
          <Route path="/trips/:id" element={<TripDetailPage />} />
        </Routes>
        {/* Outside the route: the hand-off leaves `/trips/:id`. */}
        <Where />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/trips/trip-1/edit")
    );
  });

  it("opens the flight editor once the flight has loaded, then drops the parameter", async () => {
    getFlight.mockResolvedValue(FLIGHT);
    renderAt("/flights/:id", "/flights/f1?edit=1", <FlightDetailPage />);

    expect(await screen.findByTestId("flight-editor")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
  });

  it("opens the special-flight editor for a special flight", async () => {
    getFlight.mockResolvedValue({ ...FLIGHT, specialType: "sightseeing" });
    renderAt("/flights/:id", "/flights/f1?edit=1", <FlightDetailPage />);

    expect(await screen.findByTestId("special-flight-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("flight-editor")).not.toBeInTheDocument();
  });

  it("opens no editor without the parameter", async () => {
    getFlight.mockResolvedValue(FLIGHT);
    renderAt("/flights/:id", "/flights/f1", <FlightDetailPage />);

    await screen.findByText(/LH2462/);
    expect(screen.queryByTestId("flight-editor")).not.toBeInTheDocument();
  });

  it("does not open an editor over a flight that failed to load", async () => {
    getFlight.mockRejectedValue(new Error("Network Error"));
    renderAt("/flights/:id", "/flights/f1?edit=1", <FlightDetailPage />);

    await waitFor(() => expect(getFlight).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("flight-editor")).not.toBeInTheDocument();
  });

  it("opens the cruise editor, where its stops are", async () => {
    getCruise.mockResolvedValue(CRUISE);
    renderAt("/cruises/:id", "/cruises/c1?edit=1", <CruiseDetailPage />);

    expect(await screen.findByTestId("cruise-editor")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
  });
});
