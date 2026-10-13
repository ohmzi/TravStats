import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import type { Trip } from "../../types";
import { tripEntrySpan } from "../../lib/tripEntrySpan";

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

describe("TripEditPage — the date boxes open at the journey's one served span", () => {
  beforeEach(() => {
    mocks.getById.mockReset();
    mocks.update.mockReset().mockResolvedValue(trip);
    mocks.uploadCover.mockReset();
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.addToast.mockReset();
  });

  // A flight-only journey as GET /trips/:id serves it (owner 2026-10-13): no
  // stored days, no other entries, and the flights' days — each read on the
  // clock at its own airport — served as `times` (ADR 0002) with the legacy
  // anchors beside them. The backend half (the served span IS 2020-11-20 →
  // 2020-11-28, nothing written to the row) is pinned in
  // `backend/src/routes/__tests__/trips.journeySpan.test.ts`; this is its
  // consumer half. A 23:30 New York departure is the evening of the 20th.
  const outbound = {
    id: "f1",
    status: "flown",
    departureTime: "2020-11-21T04:30:00Z",
    depTimezone: "America/New_York",
    arrivalTime: "2020-11-21T12:00:00Z",
    arrTimezone: "Europe/Berlin",
  };
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
      outbound,
      {
        id: "f2",
        status: "flown",
        departureTime: "2020-11-28T17:40:00Z",
        depTimezone: "Europe/Berlin",
        arrivalTime: "2020-11-28T23:30:00Z",
        arrTimezone: "America/New_York",
      },
    ],
  } as unknown as Trip;

  it("opens at the served span of a flight-only journey — the NYC shape, end to end", async () => {
    mocks.getById.mockResolvedValue(flightOnly);
    renderPage();

    await screen.findByDisplayValue("NYC 2020");
    await waitFor(() => expect(dateInputs()[0].value).toBe("2020-11-20"));
    expect(dateInputs()[1].value).toBe("2020-11-28");
    // Here the served span IS the entries' span, so the offer to copy the
    // latter in has nothing to say.
    expect(screen.queryByText("trips:modal.useEntrySpan")).toBeNull();

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

  it("opens at the served day the legacy anchors do not carry", async () => {
    // A stored day the row keeps in `startDay` alone: `withJourneySpan`
    // leaves the legacy anchor untouched (null here) and the day travels on
    // `times` — the name every other reader already uses. Reading the anchors
    // alone would open the box empty, and a client-side re-derivation would
    // open it at the entries' span instead (the 20th), silently dropping the
    // day the journey stored.
    mocks.getById.mockResolvedValue({
      ...flightOnly,
      startDate: null,
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

  it("opens at the flights-inclusive served span, which the entries-only client span would get wrong", async () => {
    // The constructed disagreement: the payload's flight rows are the legacy
    // zone-less shape, so the client's `tripEntrySpan` — what the offer below
    // reads — can only see the UTC day, a day late and a week short of the
    // days the journey's flights really cover. The boxes take the SERVED span
    // (read on each airport's clock, over the whole flight set); the client
    // span stays what it is for, the offer's number.
    const zoneLess = {
      ...flightOnly,
      flights: [
        {
          id: outbound.id,
          status: outbound.status,
          departureTime: outbound.departureTime,
          arrivalTime: outbound.arrivalTime,
        },
      ],
    } as unknown as Trip;
    expect(tripEntrySpan(zoneLess)).toEqual({ start: "2020-11-21", end: "2020-11-21" });

    mocks.getById.mockResolvedValue(zoneLess);
    renderPage();

    await screen.findByDisplayValue("NYC 2020");
    await waitFor(() => expect(dateInputs()[0].value).toBe("2020-11-20"));
    expect(dateInputs()[1].value).toBe("2020-11-28");
    // The client span is still what the offer is built from — deliberately,
    // and it never seeds a box.
    expect(screen.getByText("trips:modal.useEntrySpan")).toBeInTheDocument();
  });

  it("sends null for a pre-filled side the reader clears, whatever it opened with", async () => {
    mocks.getById.mockResolvedValue(flightOnly);
    renderPage();

    await screen.findByDisplayValue("NYC 2020");
    await waitFor(() => expect(dateInputs()[0].value).toBe("2020-11-20"));

    fireEvent.change(dateInputs()[0], { target: { value: "" } });
    fireEvent.change(dateInputs()[1], { target: { value: "" } });
    save();

    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    // A cleared side hands itself back to the journey's fallback: it travels
    // as null, never as the day the box was pre-filled with, and nothing
    // re-derives it while the trip stands.
    expect(mocks.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ startDate: null, endDate: null })
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
