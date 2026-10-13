import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * forgejo#169 — a trip whose only entry is a linked train ride: the trip page
 * said "Bahn – 1 Fahrt", the card "0 Einträge", even after a reload. The
 * roadtrip entry is `_count.routes`, the sections the trip page lists (tours
 * included), not the kind='roadtrip' subset `_count.roadtrips`.
 *
 * The count itself has left the card (owner, 2026-10-12: days, kilometres,
 * countries), so none of those figures renders here any more. What the count
 * still decides is the one cell that cannot be counted directly: a trip with
 * entries but no recorded country says "?" for its countries, so "no country
 * recorded" never reads as "no country"; with neither, it says "—".
 */
const settings = vi.hoisted(() => ({
  value: {
    features: { enableCostTracking: false },
    enabledDomains: ["flight", "rail", "rental", "roadtrip"],
  },
}));
vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(settings.value) : settings.value,
}));
// Roadtrips sit behind the instance beta switch; open it, as on the beta.
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => true }),
}));
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => true }));
vi.mock("../../../hooks/useRentalVisible", () => ({ useRentalVisible: () => true }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}/${o.count}` : k),
    i18n: { language: "de" },
  }),
}));

import TripCard from "../TripCard";

const trip = (count: Record<string, number>): Trip =>
  ({
    id: "t1",
    name: "QA Herbstreise",
    status: "planned",
    countries: [],
    bookings: [],
    flights: [],
    cruises: [],
    tags: [],
    category: null,
    color: null,
    coverImageUrl: null,
    destinationLabel: null,
    startDate: null,
    endDate: null,
    _count: { flights: 0, cruises: 0, lodgingStays: 0, routes: 0, photos: 0, ...count },
  }) as unknown as Trip;

function renderCard(t: Trip): void {
  render(
    <MemoryRouter>
      <TripCard trip={t} onOpen={() => {}} />
    </MemoryRouter>
  );
}

const countriesFigure = (label: string): HTMLElement =>
  within(screen.getByText(label)).getByText(/^(—|\?|\d+)$/);

describe("TripCard entry count (forgejo#169)", () => {
  it("no longer shows an entry count, a linked train ride included", () => {
    renderCard(trip({ railJourneys: 1 }));
    expect(screen.queryByText(/trips:card\.entries/)).not.toBeInTheDocument();
  });

  it("keeps counting the entry as the countries cell's ? — entries but no country", () => {
    // The train ride is the only entry and the trip records no country; the
    // cell says "?" rather than "—" so the gap reads as unrecorded.
    renderCard(trip({ railJourneys: 1 }));
    expect(countriesFigure("trips:card.countries/0")).toHaveTextContent("?");
  });

  it("says — for the countries when there is not even an entry", () => {
    renderCard(trip({}));
    expect(countriesFigure("trips:card.countries/0")).toHaveTextContent("—");
  });
});
