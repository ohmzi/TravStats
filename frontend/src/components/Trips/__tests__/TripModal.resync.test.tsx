import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import TripModal from "../TripModal";
import type { Trip } from "../../../types";

/**
 * Editing a trip's dates leaves its photos out of step: the album and the
 * stations were built for the old dates. The save says so and offers the re-sync.
 */
const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), addToast: vi.fn() }));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
vi.mock("@/hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("@/hooks/useTripEntrySuggestions", () => ({
  useTripEntrySuggestions: () => ({ origins: [], destinations: [] }),
}));
vi.mock("../../../lib/api", () => ({
  tripsApi: { update: mocks.update, create: mocks.create },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

// Synthetic trip (public repository).
const trip = {
  id: "t1",
  userId: "u1",
  name: "Northvale loop",
  color: "#818cf8",
  startDate: "2031-05-02T00:00:00.000Z",
  endDate: "2031-05-09T00:00:00.000Z",
  tags: [],
  companions: [],
  createdAt: "2031-01-01T00:00:00.000Z",
} as unknown as Trip;

const dateInputs = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
const save = (): void => {
  fireEvent.click(screen.getByText("trips:modal.save").closest("button") as HTMLButtonElement);
};

describe("TripModal: a date change offers the re-sync", () => {
  beforeEach(() => {
    mocks.update.mockReset().mockResolvedValue(trip);
    mocks.create.mockReset().mockResolvedValue(trip);
    mocks.addToast.mockReset();
  });

  it("offers it after the end date changed, with a link to the trip's re-sync", async () => {
    render(<TripModal trip={trip} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(dateInputs()[1], { target: { value: "2031-05-10" } });
    save();
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith(
        "info",
        "tripBuilder:resync.datesChanged",
        15000,
        {
          label: "tripBuilder:resync.action",
          to: "/trips/t1/resync",
        }
      )
    );
  });

  it("offers it after the start date changed", async () => {
    render(<TripModal trip={trip} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(dateInputs()[0], { target: { value: "2031-05-01" } });
    save();
    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith(
        "info",
        "tripBuilder:resync.datesChanged",
        15000,
        expect.anything()
      )
    );
  });

  it("does not offer it when only the name changed", async () => {
    render(<TripModal trip={trip} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("Northvale loop"), {
      target: { value: "Northvale round" },
    });
    save();
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith("success", "trips:toasts.updated")
    );
    expect(mocks.addToast).not.toHaveBeenCalledWith(
      "info",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("does not offer it for a new trip", async () => {
    render(<TripModal trip={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Fresh" } });
    fireEvent.change(dateInputs()[0], { target: { value: "2031-06-01" } });
    fireEvent.change(dateInputs()[1], { target: { value: "2031-06-03" } });
    save();
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.addToast).not.toHaveBeenCalledWith(
      "info",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });
});
