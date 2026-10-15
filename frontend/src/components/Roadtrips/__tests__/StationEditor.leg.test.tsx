import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import StationEditor from "../StationEditor";
import type { RoadtripStation } from "../../../types/roadtrip";
import type { TourLeg } from "../../../types/tour";

/**
 * Owner, 2026-10-15: no action is an underlined word or a whole dashed row.
 * The editor's leg between two stations was one dashed button whose children
 * were the leg's facts, so the facts looked like a control and the control
 * had no icon. It now reads like the timeline's leg row: facts as text, one
 * edit icon at the end.
 */
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${String(o.name)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => <div /> }));
vi.mock("../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([]),
  createLodging: vi.fn(),
  createStay: vi.fn(),
  deleteLodging: vi.fn(),
}));
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: { replaceStations: vi.fn(), get: vi.fn() },
}));

const id = (n: number): string => `0000000${n}-0000-4000-8000-000000000000`;
const station = (n: number, title: string): RoadtripStation => ({
  id: id(n),
  title,
  lat: 60 + n,
  lon: 5,
  startDate: `2026-07-1${n}T00:00:00.000Z`,
  endDate: null,
  notes: null,
  order: n,
  state: "pass",
  lodgingStayId: null,
  stay: null,
});
const LEG: TourLeg = {
  id: "leg-1-2",
  fromStopId: id(1),
  toStopId: id(2),
  distanceKm: 100,
  source: "routed",
  mode: "road",
  confidence: "high",
  waypoints: null,
  drivingMinutes: null,
};

describe("StationEditor — the leg between two stations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function renderEditor(onEditLeg = vi.fn()): Promise<ReturnType<typeof vi.fn>> {
    render(
      <StationEditor
        routeId="rt"
        stations={[station(1, "Bergen"), station(2, "Voss")]}
        legs={[LEG]}
        tripId={null}
        start="plain"
        today="2026-07-14"
        onSaved={vi.fn()}
        onStatus={vi.fn()}
        onEditLeg={onEditLeg}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return onEditLeg;
  }

  it("opens the leg from an edit icon that carries the two stations", async () => {
    const onEditLeg = await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "roadtrips:timeline.legEdit" }));
    expect(onEditLeg).toHaveBeenCalledWith(
      expect.objectContaining({ id: "leg-1-2" }),
      { id: id(1), title: "Bergen" },
      { id: id(2), title: "Voss" }
    );
  });

  it("leaves the leg's facts as plain text, not inside a button", async () => {
    await renderEditor();
    // The whole leg used to be one dashed button; now only the icon is.
    expect(screen.getByText(/roadtrips:timeline\.leg\.road/).closest("button")).toBeNull();
    expect(screen.getByText("roadtrips:timeline.source.routed").closest("button")).toBeNull();
  });
});
