import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlightPanel } from "../../components/FlightPanel";
import type { Flight } from "../../types";

// Mutable on purpose: the trip-details tests below put the panel in that mode
// by writing the fields the real store would hold.
const storeState = vi.hoisted(() => ({
  selectedIds: [] as string[],
  selectedFlights: [] as unknown[],
  highlightMode: null as string | null,
  detailMode: null as string | null,
  setSelection: vi.fn(),
  clearSelection: vi.fn(),
  showDetails: vi.fn(),
}));

vi.mock("../../store/flightSelectionStore", () => {
  const state = storeState;
  return {
    useFlightSelectionStore: vi.fn(<T,>(selector?: (s: typeof state) => T) =>
      selector ? selector(state) : state
    ),
  };
});

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

// TripSelectField fetches the trip list on mount from `lib/api/trips` — a
// different module than the `lib/api` barrel, so a barrel mock never covered it
// and the request escaped to the network (forgejo#110). An empty list is what a
// failed request already produced, so the assertions below are unchanged.
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return { ...actual, tripsApi: { ...actual.tripsApi, getAll: vi.fn().mockResolvedValue([]) } };
});

const flights: Flight[] = [
  {
    id: "f1",
    userId: "u1",
    airline: "LH",
    flightNumber: "LH404",
    depIata: "MUC",
    arrIata: "JFK",
    depLat: 48.35,
    depLon: 11.79,
    arrLat: 40.64,
    arrLon: -73.78,
    departureTime: "2024-03-14T10:00:00Z",
    arrivalTime: "2024-03-14T19:45:00Z",
    status: "flown",
    createdAt: "2024-03-14T00:00:00Z",
  },
];

const twoFlights: Flight[] = [
  {
    ...flights[0],
    id: "old",
    depIata: "MUC",
    arrIata: "JFK",
    departureTime: "2024-03-14T10:00:00Z",
  },
  {
    ...flights[0],
    id: "new",
    depIata: "BER",
    arrIata: "LHR",
    departureTime: "2025-06-01T08:00:00Z",
  },
];

describe("FlightPanel sort order", () => {
  // The default sort is labelled `date-desc`, and the label has to be true:
  // the newest flight belongs at the top. `groupFlights` sorts ASCENDING and
  // the `date-desc` branch used to `break` without touching it, so the panel
  // opened on the OLDEST flight while claiming the opposite.
  it("puts the newest flight first by default", () => {
    render(
      <FlightPanel
        flights={twoFlights}
        totalCount={2}
        isOpen
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onEditTrip={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    const body = document.body.textContent ?? "";
    expect(body).toContain("BER");
    expect(body).toContain("MUC");
    expect(body.indexOf("BER")).toBeLessThan(body.indexOf("MUC"));
  });
});

describe("FlightPanel", () => {
  it("renders flight list when open", () => {
    render(
      <FlightPanel
        flights={flights}
        totalCount={42}
        isOpen={true}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onEditTrip={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    expect(screen.getByText("MUC → JFK")).toBeInTheDocument();
  });

  it("shows total count in header", () => {
    render(
      <FlightPanel
        flights={flights}
        totalCount={42}
        isOpen={true}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onEditTrip={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <FlightPanel
        flights={flights}
        totalCount={1}
        isOpen={true}
        onClose={onClose}
        onEdit={vi.fn()}
        onEditTrip={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "common:buttons.close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <FlightPanel
        flights={flights}
        totalCount={1}
        isOpen={false}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onEditTrip={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("FlightPanel — a trip's Edit opens its page", () => {
  afterEach(() => {
    storeState.selectedFlights = [];
    storeState.selectedIds = [];
    storeState.detailMode = null;
  });

  // Owner, 2026-10-15: the trip's edit popup became an edit page. The panel no
  // longer renders any form; it hands the trip's id to its host, which routes.
  // Without this the prop could be dropped from `handleEditDetailTrip` and
  // every other test here would stay green.
  it("hands the shown trip's id to onEditTrip", async () => {
    const trip = { id: "trip-9", name: "Northvale loop", color: "#818cf8" };
    storeState.detailMode = "trip-details";
    storeState.selectedFlights = [{ ...flights[0], tripId: trip.id, trip }];
    const onEditTrip = vi.fn();
    const user = userEvent.setup();
    render(
      <FlightPanel
        flights={flights}
        totalCount={1}
        isOpen
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onEditTrip={onEditTrip}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "trips:editTrip" }));
    expect(onEditTrip).toHaveBeenCalledTimes(1);
    expect(onEditTrip).toHaveBeenCalledWith("trip-9");
  });
});
