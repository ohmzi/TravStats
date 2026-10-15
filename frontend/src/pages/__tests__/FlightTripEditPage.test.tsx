import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import type { Trip } from "../../types";

/**
 * The flight trip's own edit page (owner, 2026-10-15): the journey's form under
 * the flight trip's title, with every exit going back to `/flights/journeys/:id`
 * or the flights logbook, never to the journey's pages. Synthetic journey
 * (public repository).
 */

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  uploadCover: vi.fn(),
  remove: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/CompanionPicker", () => ({ default: () => null }));
vi.mock("@/hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("../../hooks/useTripEntrySuggestions", () => ({
  useTripEntrySuggestions: () => ({ origins: [], destinations: [] }),
}));
// The confirm's document-count line asks the documents API; null = unknown.
vi.mock("../../hooks/useDocumentCount", () => ({ useDocumentCount: () => null }));
vi.mock("../../lib/api/trips", () => ({
  tripsApi: {
    getById: mocks.getById,
    update: mocks.update,
    uploadCover: mocks.uploadCover,
    delete: mocks.remove,
  },
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

import FlightTripEditPage from "../FlightTripEditPage";

const trip = {
  id: "t1",
  userId: "u1",
  name: "Northvale loop",
  description: null,
  color: "#818cf8",
  category: null,
  startDate: "2031-05-02T00:00:00.000Z",
  endDate: "2031-05-09T00:00:00.000Z",
  originLabel: null,
  destinationLabel: null,
  tags: [],
  companions: [],
  notes: null,
  coverImageUrl: null,
  icon: null,
  countries: [],
  createdAt: "2031-01-01T00:00:00.000Z",
} as unknown as Trip;

function Where(): JSX.Element {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderAt(path = "/flights/journeys/t1/edit"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/flights/journeys/:id/edit" element={<FlightTripEditPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("FlightTripEditPage", () => {
  beforeEach(() => {
    mocks.getById.mockResolvedValue(trip);
    mocks.update.mockResolvedValue(trip);
  });
  afterEach(() => vi.clearAllMocks());

  it("is titled as the flight trip and goes back to it", async () => {
    renderAt();
    expect(
      await screen.findByRole("heading", { level: 1, name: "trips:editFlightTrip" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /common:buttons.back/ })).toHaveAttribute(
      "href",
      "/flights/journeys/t1"
    );
  });

  it("returns to the flight trip after Save", async () => {
    renderAt();
    // The form fills from the trip in an effect; a Save pressed before that is
    // refused as a blank name, which is a different test.
    await screen.findByDisplayValue("Northvale loop");
    fireEvent.click(screen.getByRole("button", { name: "trips:modal.save" }));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(/^\/flights\/journeys\/t1$/)
    );
  });

  it("returns to the flight trip on Cancel", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "trips:modal.cancel" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/flights\/journeys\/t1$/);
  });

  it("lands on the flights logbook after a confirmed delete", async () => {
    mocks.remove.mockResolvedValue(undefined);
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "common:buttons.delete" }));
    fireEvent.click(await screen.findByText("trips:deleteTrip"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/flights$/));
  });

  it("lands on the flights logbook when the trip cannot be loaded", async () => {
    mocks.getById.mockRejectedValueOnce(new Error("nope"));
    renderAt();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/flights$/));
  });
});
