import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const saveButton = (): HTMLButtonElement =>
  screen.getByText("trips:modal.save").closest("button") as HTMLButtonElement;
// The button's own row: what the page says AT the button is a sibling here.
const saveRow = (): HTMLElement => saveButton().parentElement as HTMLElement;
const save = (): void => {
  fireEvent.click(saveButton());
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

    // The field's own hint (the button's reason is its own line, below).
    expect(document.getElementById("trip-name-error")).toHaveTextContent(
      "trips:modal.nameRequired"
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses an end before the start with the field's own message", async () => {
    renderPage();

    await screen.findByDisplayValue("Northvale loop");
    fireEvent.change(dateInputs()[1], { target: { value: "2031-05-01" } });
    save();

    // Belt and braces: the field's hint AND the reason beside the button.
    expect(screen.getAllByText("trips:modal.endBeforeStart")).toHaveLength(2);
    expect(saveButton()).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  describe("the Save button says why it is refused", () => {
    it("puts the end-before-start reason beside the disabled Save button", async () => {
      renderPage();

      await screen.findByDisplayValue("Northvale loop");
      fireEvent.change(dateInputs()[1], { target: { value: "2031-05-01" } });

      expect(within(saveRow()).getByRole("alert")).toHaveTextContent("trips:modal.endBeforeStart");
      expect(saveButton()).toBeDisabled();
    });

    it("puts the missing-name reason beside the Save button", async () => {
      renderPage();

      fireEvent.change(await screen.findByDisplayValue("Northvale loop"), {
        target: { value: "   " },
      });

      expect(within(saveRow()).getByRole("alert")).toHaveTextContent("trips:modal.nameRequired");
    });

    it("renders no reason line for a valid edit, and leaves Save enabled", async () => {
      renderPage();

      await screen.findByDisplayValue("Northvale loop");

      expect(within(saveRow()).queryByRole("alert")).toBeNull();
      expect(saveButton()).toBeEnabled();
    });
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

describe("TripEditPage — the dates open at the journey's effective span", () => {
  beforeEach(() => {
    mocks.getById.mockReset();
    mocks.update.mockReset().mockResolvedValue(trip);
    mocks.uploadCover.mockReset();
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.addToast.mockReset();
  });

  // A flight-only journey as GET /trips/:id now serves it (owner 2026-10-13):
  // no stored days, and `startDate`/`endDate`/`times` carrying the span its
  // flights give — a 23:30 New York departure is the evening of the 20th.
  const flightOnly = {
    ...trip,
    name: "NYC 2020",
    startDate: "2020-11-20T00:00:00.000Z",
    endDate: "2020-11-28T00:00:00.000Z",
    startDay: null,
    endDay: null,
    times: {
      start: { date: "2020-11-20", zone: "America/New_York", precision: "day" },
      end: { date: "2020-11-28", zone: "America/New_York", precision: "day" },
    },
    flights: [
      {
        id: "f1",
        status: "flown",
        departureTime: "2020-11-21T04:30:00Z",
        arrivalTime: "2020-11-21T12:00:00Z",
      },
    ],
  } as unknown as Trip;

  it("prefills the inputs from the served span, and an untouched save makes it the journey's own", async () => {
    mocks.getById.mockResolvedValue(flightOnly);
    renderPage();

    await screen.findByDisplayValue("NYC 2020");
    await waitFor(() => expect(dateInputs()[0].value).toBe("2020-11-20"));
    expect(dateInputs()[1].value).toBe("2020-11-28");

    // The trip editor's rule, mirrored (commit 571736068): saving the
    // untouched, pre-filled form persists those dates as the journey's own.
    save();
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ startDate: "2020-11-20", endDate: "2020-11-28" })
      )
    );
  });

  it("keeps a stored day on its own side, the flights' day answering the other", async () => {
    mocks.getById.mockResolvedValue({
      ...flightOnly,
      startDate: "2020-11-19T00:00:00.000Z",
      startDay: "2020-11-19T00:00:00.000Z",
      times: {
        ...flightOnly.times,
        start: { date: "2020-11-19", zone: null, precision: "day" },
      },
    } as unknown as Trip);
    renderPage();

    await screen.findByDisplayValue("NYC 2020");
    await waitFor(() => expect(dateInputs()[0].value).toBe("2020-11-19"));
    expect(dateInputs()[1].value).toBe("2020-11-28");
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

describe("TripEditPage — the dates open at the entries' span", () => {
  // A journey that stores no day of its own but whose entries give one — a
  // 2031-05-01 → 2031-05-07 stay (the shape `tripEntrySpan` reads, and the
  // shape the modal's own "Use the span of the entries" offer is built
  // from). The boxes opened empty for exactly this journey until now.
  const entrySpanTrip = {
    ...trip,
    name: "Entry-span journey",
    startDate: null,
    endDate: null,
    lodgingStays: [
      {
        id: "s1",
        status: "completed",
        checkIn: "2031-05-01T00:00:00Z",
        checkOut: "2031-05-07T00:00:00Z",
      },
    ],
  } as unknown as Trip;

  beforeEach(() => {
    mocks.getById.mockReset().mockResolvedValue(entrySpanTrip);
    mocks.update.mockReset().mockResolvedValue(entrySpanTrip);
    mocks.uploadCover.mockReset();
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.addToast.mockReset();
  });

  it("pre-fills both boxes from the entries' span when no day is stored", async () => {
    renderPage();

    await screen.findByDisplayValue("Entry-span journey");
    await waitFor(() => expect(dateInputs()[0].value).toBe("2031-05-01"));
    expect(dateInputs()[1].value).toBe("2031-05-07");
    // The numbers are in the boxes now, so the offer that would copy them in
    // is gone — the fields already hold what it was offering.
    expect(screen.queryByText("trips:modal.useEntrySpan")).toBeNull();
  });

  it("keeps a stored day on its own side, the entries' span answering the other", async () => {
    mocks.getById.mockResolvedValue({
      ...entrySpanTrip,
      startDate: "2031-04-30T00:00:00.000Z",
    } as unknown as Trip);
    renderPage();

    await screen.findByDisplayValue("Entry-span journey");
    await waitFor(() => expect(dateInputs()[0].value).toBe("2031-04-30"));
    expect(dateInputs()[1].value).toBe("2031-05-07");
  });

  it("sends null for a pre-filled side the reader clears, whatever it opened with", async () => {
    // One side opened from a stored day, the other from the entries' span:
    // clearing either hands that side back to the entries — the payload
    // carries null, never the day the box was pre-filled with.
    mocks.getById.mockResolvedValue({
      ...entrySpanTrip,
      startDate: "2031-04-30T00:00:00.000Z",
    } as unknown as Trip);
    renderPage();

    await screen.findByDisplayValue("Entry-span journey");
    await waitFor(() => expect(dateInputs()[0].value).toBe("2031-04-30"));

    fireEvent.change(dateInputs()[0], { target: { value: "" } });
    fireEvent.change(dateInputs()[1], { target: { value: "" } });
    save();

    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ startDate: null, endDate: null })
    );
  });
});

/** The tree's phone band (`useIsPhoneViewport`, `max-width: 639px`). */
function setViewport(phone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width: 639px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("TripEditPage — the action row on a phone", () => {
  beforeEach(() => {
    mocks.getById.mockReset().mockResolvedValue(trip);
    mocks.update.mockReset().mockResolvedValue(trip);
    mocks.uploadCover.mockReset();
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.addToast.mockReset();
  });

  afterEach(() => setViewport(false));

  it("pins the row to the bottom edge, on the surface, ringed by a top border", async () => {
    // Measured live at 390×844 (owner report 2026-10-12): the row sat at
    // y≈1691 of a 2131px page — ~850px below the fold, with nothing sticky
    // to reach it. jsdom has no layout engine, so this pins the classes and
    // style hooks the layout reads, not the geometry; the pixels come from
    // the browser look.
    setViewport(true);
    renderPage();

    await screen.findByDisplayValue("Northvale loop");
    const row = saveRow();
    expect(row.className).toContain("sticky");
    expect(row.className).toContain("bottom-0");
    // The surface colour and the border, so the form scrolls UNDER the row…
    expect(row.style.background).toBe("var(--ts-bg)");
    expect(row.style.borderTop).toContain("var(--ts-border)");
    // …and the pad keeps its distance from a phone's home bar.
    expect(row.style.paddingBottom).toContain("safe-area-inset-bottom");
    // The row the reader reaches is the row with Cancel, the reason line and Save.
    expect(within(row).getByText("trips:modal.cancel")).toBeInTheDocument();
    expect(within(row).getByText("trips:modal.save")).toBeInTheDocument();
  });

  it("leaves the row in the form's flow on a desktop", async () => {
    setViewport(false);
    renderPage();

    await screen.findByDisplayValue("Northvale loop");
    const row = saveRow();
    expect(row.className).not.toContain("sticky");
    expect(row.className).not.toContain("bottom-0");
    expect(row.style.background).toBe("");
    expect(row.style.paddingBottom).toBe("");
  });
});
