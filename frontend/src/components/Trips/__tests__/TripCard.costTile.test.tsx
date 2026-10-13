import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * The card used to carry the trip's total, and this suite chased which switch
 * gated the figure: the card hid it behind `enableCostTracking` while the trip
 * DETAIL page rendered the same total ungated (same trip, two answers), and
 * since 2.4.0/#192 the toggle gates the taxes/fees breakdown, not whether a
 * price is shown at all.
 *
 * The figure itself is gone from the card (owner, 2026-10-12): the journey card
 * shows days, kilometres and countries, the price lives on the trip page. The
 * toggle now changes nothing here, and the cost cell's "—" went with it.
 */
const settings = vi.hoisted(() => ({
  value: {
    features: { enableCostTracking: false },
    // TripCard also reaches the store through useEnabledDomains.
    enabledDomains: ["flight", "cruise"],
  },
}));

vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(settings.value) : settings.value,
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de" },
  }),
}));

import TripCard from "../TripCard";

const trip = {
  id: "t1",
  name: "Kostenprobe",
  status: "completed",
  countries: ["Germany"],
  bookings: [{ id: "b1", pnr: "AB12CD", price: 2832, currency: "EUR" }],
  flights: [],
  cruises: [],
  tags: [],
  category: null,
  color: null,
  coverImageUrl: null,
  destinationLabel: null,
  startDate: null,
  endDate: null,
  _count: { flights: 2, cruises: 0 },
} as unknown as Trip;

describe("TripCard cost tile", () => {
  beforeEach(() => {
    settings.value = {
      features: { enableCostTracking: false },
      enabledDomains: ["flight", "cruise"],
    };
  });

  it("carries no total with cost tracking off", () => {
    render(
      <MemoryRouter>
        <TripCard trip={trip} onOpen={() => {}} />
      </MemoryRouter>
    );
    expect(screen.queryByText(/2\.?832/)).not.toBeInTheDocument();
    expect(screen.queryByText(/trips:card\.entries/)).not.toBeInTheDocument();
  });

  it("carries no total with cost tracking on either", () => {
    settings.value = {
      features: { enableCostTracking: true },
      enabledDomains: ["flight", "cruise"],
    };
    render(
      <MemoryRouter>
        <TripCard trip={trip} onOpen={() => {}} />
      </MemoryRouter>
    );
    expect(screen.queryByText(/2\.?832/)).not.toBeInTheDocument();
  });

  it("leaves a trip with no price without a cost dash, too", () => {
    const free = { ...trip, bookings: [], flights: [] } as unknown as Trip;
    render(
      <MemoryRouter>
        <TripCard trip={free} onOpen={() => {}} />
      </MemoryRouter>
    );
    expect(screen.queryByText(/2\.?832/)).not.toBeInTheDocument();
    // The only dash left is the km cell's own (no distance either); the cost
    // cell, dash and all, is not in the document.
    expect(screen.getByText("—").parentElement?.textContent).toBe("— km");
  });
});
