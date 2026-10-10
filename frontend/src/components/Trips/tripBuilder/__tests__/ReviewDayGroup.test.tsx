import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { initialReviewState } from "../../../../lib/tripBuilder/draftEdits";
import { sleptKeys } from "../../../../lib/tripBuilder/planRules";
import { stationsByDay } from "../../../../lib/tripBuilder/reviewView";
import { FLIGHT_OUT, KEY, reviewDraft } from "../../../../lib/tripBuilder/__tests__/reviewFixtures";
import type { DraftDay } from "../../../../types/tripBuilder";
import ReviewDayGroup from "../ReviewDayGroup";

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
const state = initialReviewState(draft);
const [area] = state.areas;

function renderDay(day: DraftDay, night: string | null = null, onEdit = vi.fn()) {
  const rows = stationsByDay(area, ["2031-05-02", "2031-05-03"]).get(day.day) ?? [];
  render(
    <ReviewDayGroup
      draft={draft}
      state={state}
      area={area}
      day={day}
      rows={rows}
      night={night}
      slept={sleptKeys(state)}
      onEdit={onEdit}
    />
  );
  return onEdit;
}

describe("ReviewDayGroup", () => {
  const second = draft.days[1];

  it("heads the day with its date and how many photos it has", () => {
    renderDay(second);
    expect(screen.getByRole("heading", { name: /03\.05\.2031/ })).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:review.day.photos {"photos":22,"located":22}')
    ).toBeInTheDocument();
  });

  it("draws each station that starts on the day, with the leg that led to it", () => {
    renderDay(second);
    expect(document.querySelectorAll("[data-station]")).toHaveLength(2);
    expect(screen.getAllByText(/review\.leg\.between/)).toHaveLength(2);
    expect(
      screen.getByText('tripBuilder:review.leg.between {"from":"Northvale","to":"Port Carrow"}')
    ).toBeInTheDocument();
  });

  it("draws no leg before the first station of an area", () => {
    renderDay(draft.days[0]);
    expect(document.querySelectorAll("[data-station]")).toHaveLength(2);
    expect(screen.getAllByText(/review\.leg\.between/)).toHaveLength(1);
  });

  it("offers a station only the actions the reducer would accept", () => {
    renderDay(second);
    const excursion = document.querySelector(`[data-station="${KEY.portCarrow}"]`) as HTMLElement;
    fireEvent.click(within(excursion).getByRole("button", { expanded: false }));
    expect(
      within(excursion).getByRole("button", { name: "tripBuilder:review.station.fold" })
    ).toBeEnabled();
    const last = document.querySelector(`[data-station="${KEY.northvaleAgain}"]`) as HTMLElement;
    fireEvent.click(within(last).getByRole("button", { expanded: false }));
    expect(
      within(last).getByRole("button", { name: "tripBuilder:review.station.merge" })
    ).toBeDisabled();
  });

  it("passes a station's edit up", () => {
    const onEdit = renderDay(second);
    const excursion = document.querySelector(`[data-station="${KEY.portCarrow}"]`) as HTMLElement;
    fireEvent.click(within(excursion).getByRole("button", { expanded: false }));
    fireEvent.click(
      within(excursion).getByRole("button", { name: "tripBuilder:review.station.fold" })
    );
    expect(onEdit).toHaveBeenCalledWith({ type: "foldDayTrip", stationKey: KEY.portCarrow });
  });

  it("passes a leg's new mode up with the two stations it joins", () => {
    const onEdit = renderDay(second);
    fireEvent.click(screen.getAllByRole("radio", { name: "tripBuilder:review.leg.ferry" })[0]);
    expect(onEdit).toHaveBeenCalledWith({
      type: "setLegMode",
      fromKey: KEY.northvale,
      toKey: KEY.portCarrow,
      mode: "ferry",
    });
  });

  it("draws the chip of the night that follows, and answers it", () => {
    const onEdit = renderDay(second, "2031-05-03");
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue(KEY.northvaleAgain);
    fireEvent.change(select, { target: { value: "home" } });
    expect(onEdit).toHaveBeenCalledWith({ type: "assignNight", day: "2031-05-03", assign: "home" });
  });

  it("draws no night chip when none belongs to the day", () => {
    renderDay(second);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("names the flights that left on the day, and the places only passed through", () => {
    const day: DraftDay = {
      ...second,
      flightIds: [FLIGHT_OUT],
      passedThrough: [{ title: "Brookfield", firstLocal: "2031-05-03 17:10", photoCount: 2 }],
    };
    renderDay(day);
    expect(
      screen.getByText('tripBuilder:review.day.flight {"label":"ZZ101 ZNV→ZSB"}')
    ).toBeInTheDocument();
    expect(
      screen.getByText('tripBuilder:review.day.passedThrough {"title":"Brookfield","time":"17:10"}')
    ).toBeInTheDocument();
  });

  it("says where the photos of a day were taken when no station begins on it", () => {
    const day: DraftDay = { ...second, day: "2031-05-04", stationKeys: [KEY.northvale] };
    renderDay(day);
    expect(
      screen.getByText('tripBuilder:review.day.continuesAt {"places":"Northvale"}')
    ).toBeInTheDocument();
  });

  it("says so when a day has no photos", () => {
    renderDay({ ...second, photos: 0, located: 0, stationKeys: [] });
    expect(screen.getByText("tripBuilder:review.day.noPhotos")).toBeInTheDocument();
  });
});
