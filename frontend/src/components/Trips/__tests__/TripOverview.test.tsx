import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

// The chain, the map, the summary card and the documents section each fetch
// their own data and have their own suites; this file pins the ORDER the
// journey's overview composes them in, and what it keeps beside them. The
// stubs keep the network guard happy (forgejo#110).
vi.mock("../JourneyTripsChain", () => ({ default: () => <div data-testid="chain" /> }));
vi.mock("../TripMapWithTours", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../TripSummaryPanel", () => ({ default: () => <div data-testid="summary" /> }));
vi.mock("../../documents/DocumentsSection", () => ({
  default: () => <div data-testid="documents" />,
}));

import TripOverview from "../TripOverview";

const t = ((key: string) => key) as never;

function trip(overrides: Partial<Trip>): Trip {
  return {
    id: "trip-1",
    name: "Probe",
    startDate: null,
    endDate: null,
    status: "completed",
    tags: [],
    companions: [],
    notes: null,
    summary: null,
    countries: [],
    flights: [],
    cruises: [],
    lodgingStays: [],
    bookings: [],
    immichAlbums: [],
    ...overrides,
  } as Trip;
}

function renderOverview(value: Trip): void {
  render(
    <MemoryRouter>
      <TripOverview trip={value} t={t} language="de" onChanged={() => undefined} />
    </MemoryRouter>
  );
}

const follows = (first: HTMLElement, second: HTMLElement): boolean =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("TripOverview", () => {
  it("lays the shared template out in order: the trips chain, the map, then the summary below the map", () => {
    renderOverview(trip({}));
    const chain = screen.getByTestId("chain");
    const map = screen.getByTestId("map");
    const summary = screen.getByTestId("summary");
    expect(follows(chain, map)).toBe(true);
    expect(follows(map, summary)).toBe(true);
  });

  it("keeps the journey's own material the template does not re-home: companions, tags, notes, documents", () => {
    renderOverview(
      trip({
        companions: ["Tove"],
        tags: ["fjords"],
        notes: "Rented the bikes in Bergen.",
      })
    );
    expect(screen.getByText("trips:detail.companions")).toBeInTheDocument();
    expect(screen.getByText("Tove")).toBeInTheDocument();
    expect(screen.getByText("trips:detail.tags")).toBeInTheDocument();
    expect(screen.getByText("#fjords")).toBeInTheDocument();
    expect(screen.getByText("trips:detail.notes")).toBeInTheDocument();
    expect(screen.getByText("Rented the bikes in Bergen.")).toBeInTheDocument();
    expect(screen.getByTestId("documents")).toBeInTheDocument();
  });

  it("leaves the lists that own their tabs off the overview", () => {
    renderOverview(
      trip({
        flights: [
          {
            id: "f1",
            airline: "Northvale Air",
            flightNumber: "NA101",
            depIata: "AAA",
            arrIata: "BBB",
            departureTime: "2031-05-02T10:00:00.000Z",
            status: "flown",
          },
        ] as Trip["flights"],
        immichAlbums: [
          { id: "a1", albumName: "Coast 2031", immichAlbumId: "im-1", assetCount: 12 },
        ] as Trip["immichAlbums"],
      })
    );
    // No entry rows and no tiles: the Timeline/Logistics/Gallery/Trips tabs
    // own them now, and the figures table owns the counts.
    expect(screen.queryByText("trips:detail.stats.flights")).toBeNull();
    expect(screen.queryByText("trips:detail.stats.albums")).toBeNull();
    expect(screen.queryByText("trips:overview.daysAway")).toBeNull();
    expect(screen.queryByText(/Northvale Air/)).toBeNull();
    expect(screen.queryByText("Coast 2031")).toBeNull();
  });
});
