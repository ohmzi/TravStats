/**
 * The page exists so a flight can be READ. Until now the only way to see the
 * ~50 fields the table has no column for was to open the edit form — reading
 * meant putting the record into an editable state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Flight } from "../../types";

const getByIdMock = vi.fn();

// The documents section fetches its entry's kept originals on mount. It has
// its own suite, and `__tests__/documentsMountPoints.test.tsx` checks that
// this surface mounts it — here it would only be a request reaching the
// network, which the setup refuses (forgejo#110).
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));

// The route map is a basemap under an SVG, and in jsdom the box it measures is
// 0px wide, so the real one draws nothing at all. Its own suite
// (`components/map/__tests__/CardMap.test.tsx`) covers the drawing; what this
// file can check is what the page hands it, so the stub exposes the stops and
// the arc.
vi.mock("../../components/map/CardMap", () => ({
  default: ({
    lines = [],
    stops = [],
  }: {
    lines?: ReadonlyArray<{ coords: ReadonlyArray<readonly [number, number]> }>;
    stops?: ReadonlyArray<{ coord: readonly [number, number] }>;
  }) => {
    const arc = lines[0]?.coords ?? [];
    return (
      <div
        data-testid="card-map"
        data-stops={JSON.stringify(stops.map((stop) => stop.coord))}
        data-arc-points={arc.length}
        data-arc-ends={JSON.stringify([arc[0], arc[arc.length - 1]])}
      />
    );
  },
}));

// The delete dialog counts the kept originals that cascade with the flight.
// The section above is stubbed out, so this mock serves the COUNT only.
const listForEntryMock = vi.fn();
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...args: unknown[]) => listForEntryMock(...args) },
}));

vi.mock("../../lib/api", () => ({
  flightsApi: {
    getById: (...args: unknown[]) => getByIdMock(...args),
    getTrack: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/FlightEditModal", () => ({ default: () => null }));
vi.mock("../../components/SpecialFlightModal", () => ({ default: () => null }));

import FlightDetailPage from "../FlightDetailPage";

function makeFlight(over: Partial<Flight> = {}): Flight {
  return {
    id: "f1",
    airline: "Lufthansa",
    flightNumber: "LH2462",
    depIata: "MUC",
    arrIata: "CPH",
    depLat: 48,
    depLon: 11,
    arrLat: 55,
    arrLon: 12,
    departureTime: "2026-12-21T18:06:00.000Z",
    arrivalTime: "2026-12-21T19:36:00.000Z",
    status: "scheduled",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Flight;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/flights/f1"]}>
      <Routes>
        <Route path="/flights/:id" element={<FlightDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("FlightDetailPage", () => {
  beforeEach(() => {
    getByIdMock.mockReset();
    listForEntryMock.mockReset();
    listForEntryMock.mockResolvedValue([]);
  });

  it("shows the fields the table has no column for", async () => {
    getByIdMock.mockResolvedValue(
      makeFlight({
        seatNumber: "34D",
        gate: "B24",
        terminal: "1",
        bookingReference: "XY7Z9Q",
        baggageAllowance: "1 x 23 kg",
      })
    );
    renderPage();

    // They live in the Booking card. The seat is ALSO a cell of the figures
    // band now (owner, 2026-10-08), so look inside the card, not the whole page.
    const heading = await screen.findByRole("heading", { name: "flights:detail.booking" });
    const booking = within(heading.closest("section") as HTMLElement);
    expect(booking.getByText("34D")).toBeInTheDocument();
    expect(booking.getByText("B24")).toBeInTheDocument();
    expect(booking.getByText("XY7Z9Q")).toBeInTheDocument();
    expect(booking.getByText("1 x 23 kg")).toBeInTheDocument();
  });

  it("reads the seat in the figures band as well as in the Booking card", async () => {
    getByIdMock.mockResolvedValue(makeFlight({ seatNumber: "34D" }));
    renderPage();

    await waitFor(() => expect(screen.getAllByText("34D")).toHaveLength(2));
    // One in the Booking card (a <section>), one in the band above the tabs.
    const inCard = screen.getAllByText("34D").filter((cell) => cell.closest("section") !== null);
    expect(inCard).toHaveLength(1);
  });

  it("draws the flight's own route on a map, from one airport to the other", async () => {
    getByIdMock.mockResolvedValue(makeFlight());
    renderPage();

    const map = await screen.findByTestId("card-map");
    const ends = [
      [11, 48], // MUC, as [lon, lat]
      [12, 55], // CPH
    ];
    expect(JSON.parse(map.getAttribute("data-stops") as string)).toEqual(ends);
    // A great circle is many waypoints, not the two airports joined by a ruler.
    expect(Number(map.getAttribute("data-arc-points"))).toBeGreaterThan(2);
    const [from, to] = JSON.parse(map.getAttribute("data-arc-ends") as string) as number[][];
    expect(from[0]).toBeCloseTo(ends[0][0], 3);
    expect(from[1]).toBeCloseTo(ends[0][1], 3);
    expect(to[0]).toBeCloseTo(ends[1][0], 3);
    expect(to[1]).toBeCloseTo(ends[1][1], 3);
  });

  it("gives a baggage allowance typed as a bare number its unit (forgejo#186)", async () => {
    // "Freigepäck 23" — the tester typed only the number, and the page
    // repeated it without saying 23 of what.
    getByIdMock.mockResolvedValue(
      makeFlight({ bookingReference: "XY7Z9Q", baggageAllowance: "23" })
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("XY7Z9Q")).toBeInTheDocument());
    expect(screen.getByText("23 kg")).toBeInTheDocument();
    expect(screen.queryByText("23")).not.toBeInTheDocument();
  });

  it("leaves out a card that has nothing to say", async () => {
    // A flight with no booking details at all should not render an empty
    // "Buchung & Sitz" heading over a blank box.
    getByIdMock.mockResolvedValue(makeFlight());
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    expect(screen.queryByText("flights:detail.booking")).not.toBeInTheDocument();
  });

  it("says the flight could not be loaded, rather than that it does not exist", async () => {
    // A network drop says nothing about whether the record exists — the same
    // distinction the cruise and lodging detail pages now make.
    getByIdMock.mockRejectedValue(new Error("Network Error"));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("flights:detail.loadError");
    expect(screen.getByRole("button", { name: "common:buttons.retry" })).toBeInTheDocument();
  });

  it("offers no retry when the flight is genuinely gone", async () => {
    const notFound = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404 },
    });
    getByIdMock.mockRejectedValue(notFound);
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("flights:detail.notFound");
    expect(screen.queryByRole("button", { name: "common:buttons.retry" })).not.toBeInTheDocument();
  });
  /**
   * Finding 3 of the write-path audit (2026-09-19): deleting a flight takes
   * its documents with it — `onDelete: Cascade`, measured against the live
   * database by `backend/src/__tests__/integrity/cascades.integrity.test.ts` —
   * and the dialog said nothing about them.
   */
  it("names the documents that cascade with the flight", async () => {
    getByIdMock.mockResolvedValue(makeFlight());
    listForEntryMock.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "common:buttons.delete" }));

    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
    expect(listForEntryMock).toHaveBeenCalledWith({ type: "flight", id: "f1" });
  });

  it("counts nothing until the dialog is opening", async () => {
    getByIdMock.mockResolvedValue(makeFlight());
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    // A reader who never reaches for the delete button pays for no request.
    expect(listForEntryMock).not.toHaveBeenCalled();
  });

  it("opens at once and adds the line when the count arrives", async () => {
    let settle: (rows: { id: string }[]) => void = () => {};
    listForEntryMock.mockReturnValue(
      new Promise<{ id: string }[]>((resolve) => {
        settle = resolve;
      })
    );
    getByIdMock.mockResolvedValue(makeFlight());
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "common:buttons.delete" }));

    // The question is on screen before the count is: a warning is worth
    // adding to a dialog, never worth delaying it.
    const dialog = await screen.findByTestId("confirm-modal");
    expect(dialog.textContent).toContain("flights:table.deleteConfirm.message");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");

    settle([{ id: "d1" }]);
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
  });

  it("keeps the base sentence when the count cannot be had", async () => {
    getByIdMock.mockResolvedValue(makeFlight());
    listForEntryMock.mockRejectedValue(new Error("Network Error"));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "common:buttons.delete" }));

    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(listForEntryMock).toHaveBeenCalled());
    expect(dialog.textContent).toContain("flights:table.deleteConfirm.message");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");
  });
});
