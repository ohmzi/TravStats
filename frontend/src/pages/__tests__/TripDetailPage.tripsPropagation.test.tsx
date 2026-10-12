import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Trip } from "../../types";

/**
 * The propagation rule (design 2026-10-12 §5): everything a trip changes
 * shows on its journey because both read the same rows — the journey's Km is
 * the SUM of its trips' stored driven km, its chain and Trips tab read the
 * trips themselves, and its Gallery lists the albums the journey carries (a
 * trip's album change is a link row, not a second copy).
 *
 * The pin is data-model-true: the page is rendered with the rows mocked, and
 * the second render hands it the renamed, re-dated, further-driven rows. If a
 * journey ever kept its own copy of a trip's name, dates or kilometres, the
 * second render would still show the first.
 */
const getByIdMock = vi.fn();
const tripRows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));
vi.mock("../../lib/api", () => ({
  tripsApi: { getById: (...args: unknown[]) => getByIdMock(...args) },
}));
vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/api/tours", () => ({
  toursApi: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: ["roadtrip"], isEnabled: () => true }),
}));
// The count rides the key, so a station figure is visible in the output.
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "count" in o ? `${k}:${String(o.count)}` : k,
    i18n: { language: "de" },
  }),
}));
// The map, the summary and the album sections are not what this pin reads: the
// map is a deck.gl canvas jsdom cannot draw, and the other two fetch. Each has
// its own suite.
vi.mock("../../components/map/CardMap", () => ({ default: () => <div data-testid="card-map" /> }));
vi.mock("../../components/Trips/TripMapWithTours", () => ({ default: () => null }));
vi.mock("../../components/Trips/TripSummaryPanel", () => ({ default: () => null }));
vi.mock("../../components/Trips/JourneyPhotosSection", () => ({ default: () => null }));
vi.mock("../../components/Trips/ImmichAlbumSection", () => ({
  default: ({ album }: { album: { albumName: string } }) => <div>{album.albumName}</div>,
}));
// The hook's `{ rows, settled }` contract (the chain draws nothing while the
// read is unsettled); the rows themselves are the whole point of the pin.
vi.mock("../../components/Roadtrips/useTripRoadtrips", () => ({
  useTripRoadtrips: () => ({ rows: tripRows.current, settled: true }),
}));
// The Trips tab reads roadtripsApi directly; the lib/api barrel mock above
// does not cover it (forgejo#110).
vi.mock("../../lib/api/roadtrips", () => ({
  roadtripsApi: { list: () => Promise.resolve(tripRows.current), summarize: vi.fn() },
}));

import TripDetailPage from "../TripDetailPage";

/** A roadtrips-list row: every field the chain, a card or the band can read. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "r1",
    kind: "roadtrip",
    tripId: "trip-1",
    tripName: null,
    name: "Dunholme loop",
    mode: "road",
    color: null,
    vehicle: "car",
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: "2031-05-02T00:00:00.000Z",
    endDate: "2031-05-08T00:00:00.000Z",
    distanceKm: 137,
    drivenKm: 137,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 4,
    cityNames: ["Dunholme"],
    driveCount: 3,
    stayNights: 2,
    freeNights: 2,
    nights: 4,
    nightsKnown: true,
    placesSlept: 3,
    trackCount: 0,
    tourCount: 0,
    countries: ["NO"],
    points: [
      [10, 53],
      [6, 62],
    ],
    path: [
      [10, 53],
      [6, 62],
    ],
    ...over,
  };
}

/** Two trips: 137 + 205 = 342 km, the journey's own Km figure. */
function twoTrips(): Record<string, unknown>[] {
  return [
    row(),
    row({
      id: "r2",
      name: "Southhollow run",
      drivenKm: 205,
      distanceKm: 205,
      startDate: "2031-05-10T00:00:00.000Z",
      endDate: "2031-05-14T00:00:00.000Z",
    }),
  ];
}

/** One album the journey links, as the trip-builder writes it. */
function linkedAlbum(albumName: string, assetCount: number): Record<string, unknown> {
  return {
    id: "al-1",
    tripId: "trip-1",
    immichAlbumId: "immich-1",
    albumName,
    assetCount,
    thumbnailAssetId: null,
    mode: "link",
    sortIdx: 0,
    lastSyncedAt: null,
    createdAt: "2031-05-02T00:00:00.000Z",
  };
}

function makeTrip(over: Record<string, unknown> = {}): Trip {
  return {
    id: "trip-1",
    userId: "user-1",
    name: "Coastline journey",
    description: null,
    color: "#818cf8",
    createdAt: "2024-05-01T00:00:00.000Z",
    updatedAt: "2024-05-01T00:00:00.000Z",
    startDate: "2024-05-13T00:00:00.000Z",
    endDate: "2024-05-15T00:00:00.000Z",
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
    immichAlbums: [],
    ...over,
  } as unknown as Trip;
}

async function renderAt(
  entry: string,
  over: { trip?: Record<string, unknown>; rows?: Record<string, unknown>[] } = {}
): Promise<void> {
  getByIdMock.mockResolvedValue(makeTrip(over.trip));
  tripRows.current = over.rows ?? twoTrips();
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/trips/:id" element={<TripDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
  await screen.findByText("Coastline journey");
}

describe("a journey reads its trips' own rows (design 2026-10-12 §5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows each trip in the chain with its span, km and stations, and sums the km", async () => {
    await renderAt("/trips/trip-1");

    const dunholme = (await screen.findByText("Dunholme loop")).closest("a");
    expect(dunholme).toHaveAttribute("href", "/roadtrips/r1");
    expect(dunholme?.textContent).toContain("02.05. – 08.05.2031");
    expect(dunholme?.textContent).toContain("137 km");
    expect(dunholme?.textContent).toContain("roadtrips:stationCount:4");

    const southhollow = screen.getByText("Southhollow run").closest("a");
    expect(southhollow).toHaveAttribute("href", "/roadtrips/r2");
    expect(southhollow?.textContent).toContain("205 km");

    // The journey's Km is the SUM of the two rows, and its Dates are its own.
    expect(screen.getByText("342 km")).toBeInTheDocument();
    expect(screen.getByText("13.05. – 15.05.2024")).toBeInTheDocument();
  });

  it("lists every trip on the Trips tab, each a link to its page", async () => {
    await renderAt("/trips/trip-1?tab=trips");

    // The pin is tab-SPECIFIC: the Overview draws the same chain, so the two
    // link assertions below would still pass if the Trips tab stopped
    // opening (a bad key, a fallback to the overview) and the page rendered
    // the chain the `?tab=trips` URL asked it not to. Assert the tab itself
    // is the selected one before reading its rows.
    expect(screen.getByRole("tab", { name: "trips:detail.tabs.trips" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "trips:detail.tabs.overview" })).toHaveAttribute(
      "aria-selected",
      "false"
    );

    const first = (await screen.findByText("Dunholme loop")).closest("a");
    expect(first).toHaveAttribute("href", "/roadtrips/r1");
    const second = screen.getByText("Southhollow run").closest("a");
    expect(second).toHaveAttribute("href", "/roadtrips/r2");
  });

  it("follows a rename, a re-date and a station edit — nothing is copied", async () => {
    await renderAt("/trips/trip-1", {
      rows: [
        row({
          id: "r1",
          name: "Carrow loop",
          startDate: "2031-06-02T00:00:00.000Z",
          endDate: "2031-06-08T00:00:00.000Z",
          drivenKm: 489,
          distanceKm: 489,
          stationCount: 9,
        }),
        row({ id: "r2", name: "Southhollow run", drivenKm: 205, distanceKm: 205 }),
      ],
    });

    const carrow = (await screen.findByText("Carrow loop")).closest("a");
    expect(carrow?.textContent).toContain("02.06. – 08.06.2031");
    expect(carrow?.textContent).toContain("489 km");
    expect(carrow?.textContent).toContain("roadtrips:stationCount:9");
    expect(screen.queryByText("Dunholme loop")).not.toBeInTheDocument();
    // 489 + 205 — the journey's own figure follows the row that changed.
    expect(screen.getByText("694 km")).toBeInTheDocument();
  });

  it("shows the album a trip's album change links, on the journey Gallery", async () => {
    await renderAt("/trips/trip-1?tab=gallery", {
      trip: { immichAlbums: [linkedAlbum("Dunholme 2031 Road Trip (Coastline journey)", 52)] },
    });

    expect(
      await screen.findByText("Dunholme 2031 Road Trip (Coastline journey)")
    ).toBeInTheDocument();
  });
});
