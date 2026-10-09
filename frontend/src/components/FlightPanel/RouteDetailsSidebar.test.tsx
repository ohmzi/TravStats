import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RouteDetailsSidebar } from "./RouteDetailsSidebar";
import type { Flight } from "../../types";

// Mock i18next used by useTranslation hook — mirrors AirportTooltip.test.tsx.
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "dashboard:flown") return "geflogen";
      if (key === "dashboard:planned") return "geplant";
      if (key === "common:buttons.back") return "Zurück";
      if (key === "dashboard:flightsOnRoute") return "Flüge auf dieser Route";
      return key;
    },
    i18n: { language: "de" },
  }),
}));

vi.mock("../../hooks/useLocale", () => ({
  useLocale: () => "de-DE",
}));

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: "f1",
    userId: "u1",
    airline: "Lufthansa",
    flightNumber: "LH123",
    depIata: "MUC",
    depName: "Munich",
    depLat: 48.35,
    depLon: 11.78,
    arrIata: "FRA",
    arrName: "Frankfurt",
    arrLat: 50.03,
    arrLon: 8.57,
    departureTime: "2024-01-01T08:00:00Z",
    arrivalTime: "2024-01-01T09:00:00Z",
    status: "flown",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// Each route row is a <Link> to the flight (85a6c3994), and a Link reads the router context, so
// the sidebar renders inside a router, as it does in the app (BrowserRouter in App.tsx).
function renderSidebar(flights: Flight[]) {
  return render(
    <MemoryRouter>
      <RouteDetailsSidebar flights={flights} onBack={() => {}} />
    </MemoryRouter>
  );
}

describe("RouteDetailsSidebar", () => {
  it("route sidebar separates flown and planned legs", () => {
    const flights = [
      makeFlight({ id: "1", status: "flown" }),
      makeFlight({ id: "2", status: "flown" }),
      makeFlight({ id: "3", status: "scheduled" }),
    ];
    renderSidebar(flights);
    expect(screen.getByText(/2× geflogen/)).toBeInTheDocument();
    expect(screen.getByText(/1× geplant/)).toBeInTheDocument();
    expect(screen.queryByText(/3× geflogen/)).toBeNull();
    expect(screen.queryByText(/3× geplant/)).toBeNull();
  });

  it("falls back to the legacy label when nothing is flown or planned (cancelled-only)", () => {
    const flights = [makeFlight({ id: "1", status: "cancelled" })];
    renderSidebar(flights);
    expect(screen.getByText(/1× geflogen/)).toBeInTheDocument();
  });

  it("shows only the flown count when every leg has flown (majority case)", () => {
    const flights = [
      makeFlight({ id: "1", status: "flown" }),
      makeFlight({ id: "2", status: "flown" }),
      makeFlight({ id: "3", status: "flown" }),
    ];
    renderSidebar(flights);
    expect(screen.getByText(/3× geflogen/)).toBeInTheDocument();
    expect(screen.queryByText(/geplant/)).toBeNull();
  });

  it("lists each flight as a link to that flight's own page, in departure order", () => {
    // Passed out of order on purpose: the sidebar sorts by departureTime, so a1 (January) must
    // come first even though b2 (March) is handed in first.
    const flights = [
      makeFlight({ id: "b2", flightNumber: "LH456", departureTime: "2024-03-01T08:00:00Z" }),
      makeFlight({ id: "a1", flightNumber: "LH123", departureTime: "2024-01-01T08:00:00Z" }),
    ];
    renderSidebar(flights);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/flights/a1");
    expect(links[0]).toHaveTextContent("LH123");
    expect(links[1]).toHaveAttribute("href", "/flights/b2");
    expect(links[1]).toHaveTextContent("LH456");
  });
});
