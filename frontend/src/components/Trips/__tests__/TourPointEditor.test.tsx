import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TourPointEditor from "../TourPointEditor";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// The place search is its own tested component; here it is a button that
// reports what a search hit reports — a coordinate and a name.
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    idPrefix,
    onChange,
  }: {
    idPrefix: string;
    onChange: (s: { lat: number; lon: number; name?: string }) => void;
  }) => (
    <button
      type="button"
      data-testid={idPrefix}
      onClick={() => onChange({ lat: 61.52, lon: 8.7, name: "Memurubu" })}
    >
      pick
    </button>
  ),
}));

const POINTS = [
  { id: "p1", title: "Gjendesheim", lat: 61.49, lon: 8.8 },
  { id: "p2", title: "Besseggen", lat: 61.5, lon: 8.73 },
];

/** A stored station with a night — `hasNight` as the server sends it. */
const NIGHT_POINT = { id: "p3", title: "Memurubu", lat: 61.5, lon: 8.73, hasNight: true };

describe("the standalone tour's point editor", () => {
  it("writes the whole list in one call, in the order shown", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getAllByLabelText("trips:tours.points.moveDown")[0]);
    fireEvent.click(screen.getByText("trips:tours.points.save"));

    // One call with the complete list — not two calls, and not a diff. The
    // endpoint replaces the list in one transaction, and a per-row save
    // would leave a half-edited tour as a state the server can be in.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].map((p: { id?: string }) => p.id)).toEqual(["p2", "p1"]);
  });

  it("keeps an existing point's id across a reorder, so its legs survive", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getAllByLabelText("trips:tours.points.moveUp")[1]);
    fireEvent.click(screen.getByText("trips:tours.points.save"));

    // Legs are keyed by their endpoint STOPS, never by position: an id
    // dropped here would re-create the point and take its legs with it.
    expect(onSave.mock.calls[0][0].every((p: { id?: string }) => p.id !== undefined)).toBe(true);
  });

  it("refuses to save a point with no coordinate, and says why", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getByText("trips:tours.points.add"));

    // A point with no coordinate produces no leg and no kilometre, and the
    // server refuses it. Meeting that after typing a whole list would be
    // one error for all of it.
    expect(screen.getByText("trips:tours.points.incomplete")).toBeInTheDocument();
    expect(screen.getByText("trips:tours.points.save")).toBeDisabled();
  });

  it("drops a removed point from the list it sends", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getAllByText("trips:tours.points.remove")[0]);
    fireEvent.click(screen.getByText("trips:tours.points.save"));

    expect(onSave.mock.calls[0][0]).toHaveLength(1);
    expect(onSave.mock.calls[0][0][0].id).toBe("p2");
  });

  it("takes a new point's place AND name from the search — no coordinate typed", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getByText("trips:tours.points.add"));
    fireEvent.click(screen.getByTestId("tour-point-2"));
    fireEvent.click(screen.getByText("trips:tours.points.save"));

    expect(onSave.mock.calls[0][0][2]).toEqual({ title: "Memurubu", lat: 61.52, lon: 8.7 });
  });

  it("keeps a name the reader typed when the place is picked afterwards", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={POINTS} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getByTestId("tour-point-0"));
    fireEvent.click(screen.getByText("trips:tours.points.save"));

    expect(onSave.mock.calls[0][0][0]).toMatchObject({
      id: "p1",
      title: "Gjendesheim",
      lat: 61.52,
    });
  });

  it("offers no bare latitude/longitude fields", () => {
    render(<TourPointEditor points={POINTS} saving={false} onSave={vi.fn()} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("disables the correction switch on a point that carries a night, and says why", () => {
    render(<TourPointEditor points={[...POINTS, NIGHT_POINT]} saving={false} onSave={vi.fn()} />);

    // The server refuses a correction on a station with a night — this editor
    // knows no nights, so a save through here would delete one unseen
    // (VIA_POINT_HAS_NIGHT, owner report 2026-10-12). The form tells the
    // reader where the switch is instead of letting the save find out.
    const switches = screen.getAllByRole("switch", { name: "trips:tours.points.via" });
    expect(switches[0]).toBeEnabled();
    expect(switches[1]).toBeEnabled();
    expect(switches[2]).toBeDisabled();
    expect(screen.getByText(/trips:tours.points.saveErrorViaNight/)).toBeInTheDocument();
  });

  it("saves the whole list after a flip elsewhere, the night's row sent as it stood", () => {
    const onSave = vi.fn();
    render(<TourPointEditor points={[...POINTS, NIGHT_POINT]} saving={false} onSave={onSave} />);

    fireEvent.click(screen.getAllByRole("switch", { name: "trips:tours.points.via" })[0]);
    fireEvent.click(screen.getByText("trips:tours.points.save"));

    expect(onSave).toHaveBeenCalledTimes(1);
    const sent = onSave.mock.calls[0][0];
    expect(sent.map((p: { via?: boolean }) => p.via ?? false)).toEqual([true, false, false]);
    // `hasNight` is the server's answer, not a field this form writes: the
    // save payload is the same one it was before the flag existed.
    expect(sent[2]).not.toHaveProperty("hasNight");
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

/**
 * The row's own band on a phone (owner report 2026-10-12, the journey edit
 * page's Save): on `/tours/:id` and `/roadtrips/:id/edit` the points sit
 * under a 540px map, and a dozen rows of point editing put Save well below
 * the fold with nothing sticky to reach it. The row the reader reaches is
 * cancelled by the same surface, border and safe-area pad as the journey
 * page's. jsdom has no layout engine: this pins the classes and style hooks
 * the layout reads, not the geometry.
 */
describe("the point editor's action row on a phone", () => {
  const saveRow = (): HTMLElement =>
    screen.getByText("trips:tours.points.save").parentElement as HTMLElement;

  afterEach(() => setViewport(false));

  it("pins the row to the bottom edge, on the surface, ringed by a top border", () => {
    setViewport(true);
    render(<TourPointEditor points={POINTS} saving={false} onSave={vi.fn()} />);

    const row = saveRow();
    expect(row.className).toContain("sticky");
    expect(row.className).toContain("bottom-0");
    expect(row.style.background).toBe("var(--ts-bg)");
    expect(row.style.borderTop).toContain("var(--ts-border)");
    expect(row.style.paddingBottom).toContain("safe-area-inset-bottom");
    // Add and Save still live in the row, and Add is not orphaned from it.
    expect(screen.getByText("trips:tours.points.add").parentElement).toBe(row);
    expect(screen.getByText("trips:tours.points.save").parentElement).toBe(row);
  });

  it("leaves the row in the editor's flow on a desktop", () => {
    setViewport(false);
    render(<TourPointEditor points={POINTS} saving={false} onSave={vi.fn()} />);

    const row = saveRow();
    expect(row.className).not.toContain("sticky");
    expect(row.style.background).toBe("");
    expect(row.style.paddingBottom).toBe("");
  });
});
