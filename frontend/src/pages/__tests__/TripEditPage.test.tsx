import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import type { Trip } from "../../types";

/**
 * The journey's edit page (spec 2026-10-12 §4): the modal's fields as page
 * content, plus the Re-sync from Immich section the header carries today and
 * the Delete section with the existing confirm. Synthetic journey (public
 * repository).
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

import TripEditPage from "../TripEditPage";

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
  const location = useLocation();
  return <span data-testid="where">{location.pathname}</span>;
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/trips/t1/edit"]}>
      <Routes>
        <Route path="/trips/:id/edit" element={<TripEditPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const dateInputs = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
const save = (): void => {
  fireEvent.click(screen.getByText("trips:modal.save").closest("button") as HTMLButtonElement);
};

describe("TripEditPage — the journey's form", () => {
  beforeEach(() => {
    mocks.getById.mockReset().mockResolvedValue(trip);
    mocks.update.mockReset().mockResolvedValue(trip);
    mocks.uploadCover.mockReset();
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.addToast.mockReset();
  });

  it("fills the form from the journey and saves the edited fields", async () => {
    renderPage();

    const name = await screen.findByDisplayValue("Northvale loop");
    fireEvent.change(name, { target: { value: "Northvale round" } });
    save();

    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith("t1", {
      name: "Northvale round",
      description: null,
      color: "#818cf8",
      category: null,
      startDate: "2031-05-02",
      endDate: "2031-05-09",
      originLabel: null,
      destinationLabel: null,
      tags: [],
      companions: [],
      notes: null,
    });
    expect(mocks.addToast).toHaveBeenCalledWith("success", "trips:toasts.updated");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/trips\/t1$/));
  });

  it("names the missing field on a blank name and sends nothing", async () => {
    renderPage();

    fireEvent.change(await screen.findByDisplayValue("Northvale loop"), {
      target: { value: "   " },
    });
    save();

    expect(screen.getByRole("alert")).toHaveTextContent("trips:modal.nameRequired");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses an end before the start with the field's own message", async () => {
    renderPage();

    await screen.findByDisplayValue("Northvale loop");
    fireEvent.change(dateInputs()[1], { target: { value: "2031-05-01" } });
    save();

    expect(screen.getByText("trips:modal.endBeforeStart")).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("offers the re-sync after the dates moved, with a link to the resync page", async () => {
    renderPage();

    await screen.findByDisplayValue("Northvale loop");
    fireEvent.change(dateInputs()[1], { target: { value: "2031-05-10" } });
    save();

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith(
        "info",
        "tripBuilder:resync.datesChanged",
        15000,
        { label: "tripBuilder:resync.action", to: "/trips/t1/resync" }
      )
    );
  });
});

describe("TripEditPage — the two sections the header loses", () => {
  beforeEach(() => {
    mocks.getById.mockReset().mockResolvedValue(trip);
    mocks.update.mockReset().mockResolvedValue(trip);
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.addToast.mockReset();
  });

  it("carries the Re-sync from Immich launch the header button uses today", async () => {
    renderPage();

    const link = await screen.findByRole("link", { name: "tripBuilder:resync.action" });
    expect(link).toHaveAttribute("href", "/trips/t1/resync");
    expect(screen.getByRole("heading", { name: "tripBuilder:resync.action" })).toBeInTheDocument();
  });

  it("deletes the journey only after the existing confirm was answered", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "common:buttons.delete" }));

    expect(await screen.findByText("trips:deleteTripConfirmTitle")).toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("trips:deleteTrip"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("t1"));
    expect(mocks.addToast).toHaveBeenCalledWith("success", "trips:toasts.deleted");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/trips$/));
  });
});
