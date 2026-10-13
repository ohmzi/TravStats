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
 * route PATCH on Save; a side opens at its stored day, else at the span the
 * trip already shows (`span`); clearing an input returns that side to the
 * stations' span — with an explicit null, whatever the box opened at; an end
 * before the start is refused in the app's own words, before any request.
 * Synthetic values only.
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

/** The span the trip already shows, as the roadtrip detail serves it. */
const SPAN = { startDate: "2031-06-01T00:00:00.000Z", endDate: "2031-06-09T00:00:00.000Z" };

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

  it("opens a trip with no stored days at the span it already shows", () => {
    render(
      <RoadtripDatesSection route={route()} tripId={undefined} span={SPAN} onSaved={vi.fn()} />
    );

    expect(startInput().value).toBe("2031-06-01");
    expect(endInput().value).toBe("2031-06-09");
  });

  it("keeps a stored day on its own side, the span on the other", () => {
    render(
      <RoadtripDatesSection
        route={route({ startDay: "2031-06-03" })}
        tripId={undefined}
        span={SPAN}
        onSaved={vi.fn()}
      />
    );

    expect(startInput().value).toBe("2031-06-03");
    expect(endInput().value).toBe("2031-06-09");
  });

  it("saves the whole pre-filled span as the trip's own days", async () => {
    render(
      <RoadtripDatesSection route={route()} tripId={undefined} span={SPAN} onSaved={vi.fn()} />
    );

    save();

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(undefined, route().id, {
        startDay: "2031-06-01",
        endDay: "2031-06-09",
      })
    );
  });

  it("clears a span-prefilled side with an explicit null, never the span's day", async () => {
    render(
      <RoadtripDatesSection route={route()} tripId={undefined} span={SPAN} onSaved={vi.fn()} />
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

  it("hands a cleared side back to the stations and leaves its box empty", async () => {
    // The page answers the save by replacing `route` with the server's row —
    // the same `onSaved={setRoute}` the editor wires. The cleared side came
    // back null, and its box must read empty (the side is the stations'
    // again), never refill from the span the form opened with.
    const { rerender } = render(
      <RoadtripDatesSection
        route={route({ startDay: "2031-06-01", endDay: "2031-06-09" })}
        tripId={undefined}
        span={SPAN}
        onSaved={vi.fn()}
      />
    );

    fireEvent.change(startInput(), { target: { value: "" } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalled());

    rerender(
      <RoadtripDatesSection
        route={route({ startDay: null, endDay: "2031-06-09" })}
        tripId={undefined}
        span={SPAN}
        onSaved={vi.fn()}
      />
    );

    expect(startInput().value).toBe("");
    expect(endInput().value).toBe("2031-06-09");
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

  it("draws Save dates at the shared row height, not the lone-CTA primary", () => {
    render(<RoadtripDatesSection route={route()} tripId={undefined} onSaved={vi.fn()} />);

    // The row it saves is the two date boxes beside it; a CTA in a row joins
    // the row's shared height (owner, 2026-10-11: "all these should be same
    // size"), and the owner's 2026-10-13 screenshot named the tall amber Save
    // as the trip editor's odd one out — the same treatment the change-dates
    // dialog's amber action already takes. jsdom measures no layout, so the
    // recipe is pinned as its tokens.
    const save = screen.getByRole("button", { name: "roadtrips:dates.save" });
    expect(save).toHaveClass("ts-button");
    expect(save.style.height).toBe("var(--ts-size-button-secondary)");
    expect(save.style.padding).toBe("0 var(--ts-space-xl)");
    expect(save.style.fontSize).toBe("16px");
  });
});
