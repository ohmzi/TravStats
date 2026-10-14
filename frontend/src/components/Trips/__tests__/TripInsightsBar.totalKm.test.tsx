import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * The fourth journeys-page tile (owner request 2026-10-14): the lifetime
 * "Total logged km". It is deliberately NOT a winner — no trip, no navigation
 * — so it renders label + value only, as a plain element that joins neither the
 * clickable three nor their dashed non-winner placeholders, and it never forces
 * the strip to appear on its own.
 */
const lang = vi.hoisted(() => ({ value: "en" }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: lang.value } }),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

import { TripInsightsBar } from "../TripInsightsBar";

const trip = (over: Partial<Trip>): Trip =>
  ({
    id: "t",
    name: "Trip",
    countries: [],
    flights: [],
    cruises: [],
    bookings: [],
    lodgingStays: [],
    ...over,
  }) as Trip;

// A countries winner guarantees the strip renders, so the total tile can be
// judged beside a real one.
const withWinner = [trip({ id: "wide", name: "Grand Tour", countries: ["DE", "US", "JP"] })];

const render_ = (totalLoggedKm?: number | null): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <TripInsightsBar
        trips={withWinner}
        mostExpensiveTrip={null}
        totalLoggedKm={totalLoggedKm ?? undefined}
      />
    </MemoryRouter>
  );

describe("TripInsightsBar — the total logged km tile", () => {
  it("renders the label and the formatted total, and is not a button or a link", () => {
    lang.value = "en";
    render_(24727);
    expect(screen.getByText("trips:insights.totalLoggedKm")).toBeInTheDocument();
    const value = screen.getByText("24,727 km");
    expect(value.closest("button")).toBeNull();
    expect(value.closest("a")).toBeNull();
  });

  it("formats the total in the reader's locale", () => {
    lang.value = "de";
    render_(24727);
    expect(screen.getByText("24.727 km")).toBeInTheDocument();
    lang.value = "en";
  });

  it("shows the label with a dash when no total was requested", () => {
    render_(null);
    expect(screen.getByText("trips:insights.totalLoggedKm")).toBeInTheDocument();
  });

  it("does not render on its own when no metric has a winner", () => {
    // The null-tile behaviour is unchanged: a plain trip with a total but no
    // winner still shows nothing, exactly as before this tile existed.
    const { container } = render(
      <MemoryRouter>
        <TripInsightsBar trips={[trip({})]} mostExpensiveTrip={null} totalLoggedKm={5000} />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
