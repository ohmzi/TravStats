import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import {
  applyEdit,
  initialReviewState,
  type DraftEdit,
} from "../../../../lib/tripBuilder/draftEdits";
import { sleptKeys } from "../../../../lib/tripBuilder/planRules";
import { placeNights } from "../../../../lib/tripBuilder/reviewView";
import { matchedStopDraft, STOP_KEY } from "../../../../lib/tripBuilder/__tests__/existingFixture";
import { reviewDraft } from "../../../../lib/tripBuilder/__tests__/reviewFixtures";
import ReviewAreaSection from "../ReviewAreaSection";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../../../lib/api/tripBuilder", () => ({
  tripBuilderApi: { previewUrl: (id: string, index: number) => `/thumb/${id}/${index}` },
}));

const draft = reviewDraft();

function renderArea(
  areaIndex: number,
  edits: DraftEdit[] = [],
  props: { roadtripsHidden?: boolean } = {}
) {
  const state = edits.reduce((s, e) => applyEdit(draft, s, e), initialReviewState(draft));
  const area = state.areas[areaIndex];
  const onEdit = vi.fn();
  render(
    <ReviewAreaSection
      draft={draft}
      state={state}
      area={area}
      ordinal={areaIndex + 1}
      nights={placeNights(draft, state).byArea.get(area.key) ?? []}
      slept={sleptKeys(state)}
      roadtripsHidden={props.roadtripsHidden ?? false}
      onEdit={onEdit}
    />
  );
  return onEdit;
}

describe("ReviewAreaSection", () => {
  it("titles the area, dates it and counts its stations and nights", () => {
    renderArea(0);
    expect(
      screen.getByRole("heading", { name: 'tripBuilder:review.area.title {"n":1}' })
    ).toBeInTheDocument();
    expect(screen.getAllByText("02.05.2031 – 03.05.2031")[0]).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:review.area.summary {"stations":4,"nights":2}')
    ).toBeInTheDocument();
  });

  it("draws a group for each day of the area", () => {
    renderArea(0);
    expect(
      Array.from(document.querySelectorAll("[data-day]")).map((d) => d.getAttribute("data-day"))
    ).toEqual(["2031-05-02", "2031-05-03"]);
  });

  it("draws the night before the first day above it", () => {
    renderArea(1);
    expect(screen.getByText(/review\.night\.flight/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-day]")).toHaveLength(2);
  });

  it("names what the area ends in and what it was called", () => {
    renderArea(0);
    expect(
      screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("tripBuilder:review.area.name")).toHaveValue(
      "Southern loop · Northvale"
    );
  });

  it("says what the area after a flight follows", () => {
    renderArea(1);
    expect(
      screen.getByText('tripBuilder:review.area.afterFlight {"flight":"ZZ101 ZNV→ZSB"}')
    ).toBeInTheDocument();
  });

  it("changes what the area becomes", () => {
    const onEdit = renderArea(0);
    fireEvent.click(screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.skip" }));
    expect(onEdit).toHaveBeenCalledWith({
      type: "setAreaKind",
      areaKey: "2031-05-02#1",
      as: "skip",
    });
  });

  it("will not offer a roadtrip when roadtrips are off, unless the area already is one", () => {
    renderArea(0, [{ type: "setAreaKind", areaKey: "2031-05-02#1", as: "stops" }], {
      roadtripsHidden: true,
    });
    expect(
      screen.queryByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toBeNull();
  });

  it("renames the roadtrip and changes its vehicle", () => {
    const onEdit = renderArea(0);
    fireEvent.change(screen.getByLabelText("tripBuilder:review.area.name"), {
      target: { value: "The long way" },
    });
    expect(onEdit).toHaveBeenCalledWith({
      type: "setAreaName",
      areaKey: "2031-05-02#1",
      name: "The long way",
    });
    fireEvent.change(screen.getByLabelText("tripBuilder:review.area.vehicle"), {
      target: { value: "motorhome" },
    });
    expect(onEdit).toHaveBeenCalledWith({
      type: "setVehicle",
      areaKey: "2031-05-02#1",
      vehicle: "motorhome",
    });
  });

  it("has no name or vehicle for an area that is only stops", () => {
    renderArea(0, [{ type: "setAreaKind", areaKey: "2031-05-02#1", as: "stops" }]);
    expect(screen.queryByLabelText("tripBuilder:review.area.name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("tripBuilder:review.area.vehicle")).not.toBeInTheDocument();
  });

  it("offers the home switch the scan offered, on, and turns it off", () => {
    const onEdit = renderArea(0);
    const home = screen.getByRole("switch", { name: "tripBuilder:review.area.homeStart" });
    expect(home).toBeChecked();
    fireEvent.click(home);
    expect(onEdit).toHaveBeenCalledWith({
      type: "toggleHome",
      areaKey: "2031-05-02#1",
      end: "start",
      on: false,
    });
    expect(screen.queryByRole("switch", { name: "tripBuilder:review.area.homeEnd" })).toBeNull();
  });

  it("offers no home switch for an area with none offered", () => {
    renderArea(1);
    expect(screen.queryByRole("switch", { name: /review\.area\.home/ })).toBeNull();
  });

  it("draws a skipped area as one line and no days", () => {
    renderArea(1, [{ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" }]);
    expect(screen.getByText("tripBuilder:review.area.skipped")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-day]")).toHaveLength(0);
  });
});

describe("a stops area matched to a stored stop", () => {
  const draft = matchedStopDraft();

  function renderMatched(): void {
    const state = initialReviewState(draft);
    const area = state.areas[0];
    render(
      <ReviewAreaSection
        draft={draft}
        state={state}
        area={area}
        ordinal={1}
        nights={placeNights(draft, state).byArea.get(area.key) ?? []}
        slept={sleptKeys(state)}
        roadtripsHidden={false}
        onEdit={vi.fn()}
      />
    );
  }

  /** The row's header is its first button, open or closed. */
  const toggleRow = (key: string): void => {
    const row = document.querySelector(`[data-station="${key}"]`) as HTMLElement;
    fireEvent.click(within(row).getAllByRole("button")[0]);
  };
  const removeButton = (): HTMLElement =>
    screen.getByRole("button", { name: "tripBuilder:review.station.delete" });

  it("offers stops and skip, but not roadtrip: a matched stop cannot become one", () => {
    renderMatched();
    expect(
      screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.stops" })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("radio", { name: "tripBuilder:review.area.kinds.skip" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: "tripBuilder:review.area.kinds.roadtrip" })
    ).toBeNull();
  });

  it("greys Remove on the anchor, which is the stored stop, and not on another run", () => {
    renderMatched();
    toggleRow(STOP_KEY.harbour);
    expect(removeButton()).toBeDisabled();
    toggleRow(STOP_KEY.harbour);
    toggleRow(STOP_KEY.market);
    expect(removeButton()).toBeEnabled();
  });
});
