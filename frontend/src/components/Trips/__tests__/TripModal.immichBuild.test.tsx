import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Trip } from "../../../types";
import type { CapabilitiesDto } from "../../../types/tripBuilder";
import TripModal from "../TripModal";

/**
 * The create-trip popup with its photo switches (spec 2026-10-09 §G). The only
 * TripModal test under a Router, because the launcher navigates; the others
 * render the modal bare and must keep doing so. Synthetic data only.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  capabilities: vi.fn(),
  scan: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
vi.mock("@/hooks/useTagSuggestions", () => ({ useTagSuggestions: () => [] }));
vi.mock("@/hooks/useTripEntrySuggestions", () => ({
  useTripEntrySuggestions: () => ({ origins: [], destinations: [] }),
}));
vi.mock("../../../lib/api", () => ({ tripsApi: { create: mocks.create, update: vi.fn() } }));
vi.mock("../../../lib/api/tripBuilder", () => ({
  tripBuilderApi: { capabilities: mocks.capabilities, scan: mocks.scan },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

const JOB = "6a0b7c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d";
const READY: CapabilitiesDto = {
  immich: {
    configured: true,
    source: "user",
    inspect: { ok: true, missingScopes: [] },
    album: { canCreate: true, reason: null },
  },
  roadtrips: true,
  routing: { available: true, canProbe: true },
  home: { known: true, confirmed: true },
};

function Where(): JSX.Element {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderCreate(props: { initialInspect?: boolean } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <MemoryRouter initialEntries={["/trips"]}>
      <Routes>
        <Route
          path="/trips"
          element={<TripModal trip={null} onClose={onClose} onSaved={onSaved} {...props} />}
        />
        <Route path="/trips/builder" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  return { onClose, onSaved };
}

const inspect = (): HTMLElement =>
  screen.getByRole("switch", { name: "tripBuilder:popup.inspect.label" });
const button = (label: string): HTMLButtonElement =>
  screen.getByText(label).closest("button") as HTMLButtonElement;
// The capability check shows a status line while it runs; waiting for it to go
// keeps every state update inside the awaited window, none outside act(...).
const settled = (): Promise<void> => waitFor(() => expect(screen.queryByRole("status")).toBeNull());

function fill(): void {
  fireEvent.change(screen.getByPlaceholderText("trips:modal.namePlaceholder"), {
    target: { value: "Northvale loop" },
  });
  const [start, end] = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="date"]')
  );
  fireEvent.change(start, { target: { value: "2031-05-02" } });
  fireEvent.change(end, { target: { value: "2031-05-09" } });
}

describe("TripModal with the Immich switches", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.create.mockReset().mockResolvedValue({ id: "t1" });
    mocks.capabilities.mockReset().mockResolvedValue(READY);
    mocks.scan.mockReset().mockResolvedValue({ jobId: JOB });
    mocks.addToast.mockReset();
  });

  it("creates a plain trip when no switch is on, and never asks Immich", async () => {
    const { onSaved } = renderCreate();
    fill();

    fireEvent.click(button("trips:modal.save"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.capabilities).not.toHaveBeenCalled();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("scans instead of creating when a switch is on, and hands over to the review page", async () => {
    const { onClose } = renderCreate();
    fireEvent.click(inspect());
    fill();

    fireEvent.click(button("tripBuilder:popup.scan"));

    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe(`/trips/builder?job=${JOB}`)
    );
    expect(mocks.scan).toHaveBeenCalledWith({
      name: "Northvale loop",
      startDay: "2031-05-02",
      endDay: "2031-05-09",
      inspect: true,
      createAlbum: false,
      target: { kind: "new" },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`tb:job:${JOB}`)).toContain('"returnTo":"/trips"');
    expect(onClose).toHaveBeenCalled();
  });

  it("holds Save until both dates are set while a switch is on", async () => {
    renderCreate();
    fireEvent.change(screen.getByPlaceholderText("trips:modal.namePlaceholder"), {
      target: { value: "Northvale loop" },
    });

    fireEvent.click(inspect());

    expect(button("tripBuilder:popup.scan").disabled).toBe(true);
    expect(screen.getByText("tripBuilder:popup.needDates")).toBeTruthy();
    fill();
    expect(button("tripBuilder:popup.scan").disabled).toBe(false);
    await settled();
  });

  it("hides the cover picker while a switch is on", async () => {
    renderCreate();
    const openAppearance = (): void => {
      fireEvent.click(screen.getByRole("tab", { name: /trips:modalTabs\.appearance/ }));
    };
    openAppearance();
    expect(screen.getByText("trips:modal.coverLabel")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /trips:modalTabs\.general/ }));

    fireEvent.click(inspect());
    await settled();
    openAppearance();

    expect(screen.queryByText("trips:modal.coverLabel")).toBeNull();
  });

  it("opens with Inspect already on when the chooser asks for it", async () => {
    renderCreate({ initialInspect: true });

    await waitFor(() => expect(mocks.capabilities).toHaveBeenCalledTimes(1));
    await settled();

    expect(inspect()).toBeChecked();
    expect(button("tripBuilder:popup.scan")).toBeTruthy();
  });

  it("gives the form back when the scan cannot start", async () => {
    mocks.scan.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "notConfigured" } },
    });
    const { onClose } = renderCreate();
    fireEvent.click(inspect());
    fill();

    fireEvent.click(button("tripBuilder:popup.scan"));

    await waitFor(() => expect(button("tripBuilder:popup.scan").disabled).toBe(false));
    expect(mocks.addToast).toHaveBeenCalledWith("error", "tripBuilder:launch.notConfigured");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("asks Immich once, however often the popup visits another tab", async () => {
    renderCreate();
    fireEvent.click(inspect());
    await settled();

    fireEvent.click(screen.getByRole("tab", { name: /trips:modalTabs\.people/ }));
    fireEvent.click(screen.getByRole("tab", { name: /trips:modalTabs\.general/ }));

    expect(mocks.capabilities).toHaveBeenCalledTimes(1);
    expect(inspect()).toBeChecked();
  });

  it("offers no switches when an existing trip is edited", () => {
    const existing = {
      id: "t1",
      name: "Existing trip",
      tags: [],
      companions: [],
    } as unknown as Trip;
    render(
      <MemoryRouter>
        <TripModal trip={existing} onClose={vi.fn()} onSaved={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("tripBuilder:popup.heading")).toBeNull();
  });
});
