import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * The figure line, in the owner's words (2026-10-12): "just show days, km and
 * country . countries, just these 3 nothing else in card". The entry count and
 * the cost total left the card with that request — the price lives on the trip
 * page — so neither their figures nor their placeholders may come back here.
 */
const settings = vi.hoisted(() => ({
  value: {
    features: { enableCostTracking: true },
    enabledDomains: ["flight", "cruise"],
  },
}));

vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(settings.value) : settings.value,
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}/${o.count}` : k),
    i18n: { language: "de" },
  }),
}));

import TripCard from "../TripCard";

const trip = {
  id: "t1",
  name: "Nordkap",
  status: "completed",
  countries: ["Norway"],
  // A priced booking and a cruise, so both dropped rows would have a value.
  bookings: [{ id: "b1", pnr: "AB12CD", price: 1290, currency: "EUR" }],
  flights: [],
  cruises: [
    {
      id: "c1",
      cruiseLine: "AIDA",
      startDate: null,
      endDate: null,
      status: "completed",
      shipId: null,
      price: null,
      currency: "EUR",
      bookingId: null,
      distanceKm: 3400,
    },
  ],
  tags: [],
  category: null,
  color: null,
  coverImageUrl: null,
  destinationLabel: null,
  // Ten calendar days including both ends.
  startDate: "2026-10-03",
  endDate: "2026-10-12",
  _count: { flights: 0, cruises: 1, lodgingStays: 1, routes: 0, photos: 0 },
} as unknown as Trip;

function renderCard(): void {
  render(
    <MemoryRouter>
      <TripCard trip={trip} onOpen={() => {}} />
    </MemoryRouter>
  );
}

describe("TripCard figure line", () => {
  it("renders days, kilometres and countries, in the owner's order", () => {
    renderCard();
    const days = screen.getByText("trips:card.days/10");
    const km = screen.getByText("3.4k");
    const countries = screen.getByText("trips:card.countries/1");
    expect(days.compareDocumentPosition(km) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(km.compareDocumentPosition(countries) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("carries no entry count", () => {
    renderCard();
    expect(screen.queryByText(/trips:card\.entries/)).not.toBeInTheDocument();
  });

  it("carries no cost — not the total, not a dash", () => {
    renderCard();
    expect(screen.queryByText(/1\.?290/)).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});
