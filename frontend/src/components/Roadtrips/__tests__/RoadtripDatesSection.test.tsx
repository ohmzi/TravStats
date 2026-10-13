import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const update = vi.fn();
vi.mock("../../../lib/api/tours", () => ({
  toursApi: { update: (...args: unknown[]) => update(...args) },
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

import RoadtripDatesSection from "../RoadtripDatesSection";
import type { TourRoute } from "../../../types/tour";

/**
 * The trip's own start and end day (owner 2026-10-13, the primary ask): the
 * trip edit page's Dates section. Both sides go through the kind-agnostic
 * route PATCH on Save; clearing an input returns that side to the stations'
 * span; an end before the start is refused in the app's own words, before any
 * request. Synthetic values only.
 */
function route(over: Partial<TourRoute> = {}): TourRoute {
  return {
    id: "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
    tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
    name: "Northvale loop",
    mode: "road",
    orderIdx: 0,
    color: null,
    notes: null,
    startOdometerKm: null,
    endOdometerKm: null,
    stopCount: 2,
    legCount: 1,
    distanceKm: 305,
    drivenKm: 305,
    kind: "roadtrip",
    activity: null,
    vehicle: "car",
    vehicleName: null,
    anchorStopId: null,
    kindAssignedAutomatically: false,
    startDay: null,
    endDay: null,
    ...over,
  };
}

const save = () => fireEvent.click(screen.getByText("roadtrips:dates.save"));
const startInput = () => screen.getByLabelText("trips:modal.startDateLabel") as HTMLInputElement;
const endInput = () => screen.getByLabelText("trips:modal.endDateLabel") as HTMLInputElement;

describe("RoadtripDatesSection", () => {
  beforeEach(() => {
    update.mockReset();
    update.mockResolvedValue(route());
    addToast.mockReset();
  });

  it("prefills the trip's stored days and saves both through the route PATCH", async () => {
    const onSaved = vi.fn();
    render(
      <RoadtripDatesSection
        route={route({ startDay: "2031-06-01", endDay: "2031-06-09" })}
        tripId="3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c"
        onSaved={onSaved}
      />
    );

    expect(startInput().value).toBe("2031-06-01");
    expect(endInput().value).toBe("2031-06-09");

    fireEvent.change(endInput(), { target: { value: "2031-06-10" } });
    save();

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
        "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
        { startDay: "2031-06-01", endDay: "2031-06-10" }
      )
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(addToast).toHaveBeenCalledWith("success", "roadtrips:dates.saved");
  });

  it("clears a side back to the stations' span with an explicit null", async () => {
    render(
      <RoadtripDatesSection
        route={route({ startDay: "2031-06-01", endDay: "2031-06-09" })}
        tripId={undefined}
        onSaved={vi.fn()}
      />
    );

    fireEvent.change(startInput(), { target: { value: "" } });
    save();

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(undefined, route().id, {
        startDay: null,
        endDay: "2031-06-09",
      })
    );
  });

  it("refuses an end before the start in the app's words, before any request", () => {
    render(
      <RoadtripDatesSection
        route={route({ startDay: "2031-06-05" })}
        tripId={undefined}
        onSaved={vi.fn()}
      />
    );

    fireEvent.change(endInput(), { target: { value: "2031-06-01" } });
    save();

    expect(screen.getByText("trips:modal.endBeforeStart")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("says a failed save in the reader's language, never the server's prose", async () => {
    update.mockRejectedValue({
      response: { status: 400, data: { error: "endDate must not precede startDate" } },
    });
    render(<RoadtripDatesSection route={route()} tripId={undefined} onSaved={vi.fn()} />);

    save();

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "roadtrips:dates.saveError")
    );
  });

  it("draws nothing for a day tour — its own day is its date", () => {
    const { container } = render(
      <RoadtripDatesSection route={route({ kind: "tour" })} tripId={undefined} onSaved={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
