import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * A trip made only of cruises read "— km" and "— Gesamtkosten" on its card,
 * although the cruises carried prices and their legs carried distances. The
 * card summed flights and nothing else, so a trip with `flights: []` summed to
 * nothing at all.
 *
 * The kilometres half of that fix stays, pinned below. The cost half has since
 * left the card altogether (owner, 2026-10-12: days, kilometres, countries), so
 * a cruise price no longer renders here — nor does a cost "—" in its place.
 */
const settings = vi.hoisted(() => ({
  value: {
    features: { enableCostTracking: false },
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

const cruiseOnlyTrip = {
  id: "t-cruise",
  name: "Nordland",
  status: "completed",
  countries: ["Norway"],
  bookings: [],
  flights: [],
  cruises: [
    {
      id: "c1",
      cruiseLine: "AIDA",
      startDate: null,
      endDate: null,
      status: "completed",
      shipId: null,
      price: 1290,
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
  startDate: null,
  endDate: null,
  _count: { flights: 0, cruises: 1 },
  cost: { spendByCurrency: { EUR: 1290 }, unpricedEntries: 0 },
} as unknown as Trip;

function renderCard(trip: Trip): void {
  render(
    <MemoryRouter>
      <TripCard trip={trip} onOpen={() => {}} />
    </MemoryRouter>
  );
}

describe("TripCard totals on a cruise-only trip", () => {
  it("shows no price for the cruise on the card", () => {
    renderCard(cruiseOnlyTrip);
    expect(screen.queryByText(/1\.?290/)).not.toBeInTheDocument();
  });

  it("counts the cruise distance towards the trip kilometres", () => {
    renderCard(cruiseOnlyTrip);
    // formatDistance renders >= 1000 km as "3.4k"
    expect(screen.getByText("3.4k")).toBeInTheDocument();
  });

  it("adds cruise kilometres to flight kilometres on a mixed trip", () => {
    const mixed = {
      ...cruiseOnlyTrip,
      flights: [
        // Hamburg → Oslo, ~733 km great-circle.
        { id: "f1", depLat: 53.63, depLon: 9.99, arrLat: 60.19, arrLon: 11.1, bookingId: null },
      ],
      cruises: [{ ...(cruiseOnlyTrip.cruises ?? [])[0], distanceKm: 3400 }],
    } as unknown as Trip;

    renderCard(mixed);
    // 3400 + ~733 = ~4.1k, and no longer the cruise figure alone.
    expect(screen.queryByText("3.4k")).not.toBeInTheDocument();
    expect(screen.getByText("4.1k")).toBeInTheDocument();
  });

  it("keeps the km dash for a cruise without computed legs — and no cost dash", () => {
    const bare = {
      ...cruiseOnlyTrip,
      cruises: [
        {
          id: "c2",
          cruiseLine: "AIDA",
          startDate: null,
          endDate: null,
          status: "completed",
          shipId: null,
          price: null,
          currency: "EUR",
          bookingId: null,
          distanceKm: 0,
        },
      ],
      cost: { spendByCurrency: {}, unpricedEntries: 1 },
    } as unknown as Trip;

    renderCard(bare);
    expect(screen.queryByText(/1\.?290/)).not.toBeInTheDocument();
    // The only dash left is the km cell's; the cost cell, dash and all, is
    // not in the document.
    expect(screen.getByText("—").parentElement?.textContent).toBe("— km");
  });
});
