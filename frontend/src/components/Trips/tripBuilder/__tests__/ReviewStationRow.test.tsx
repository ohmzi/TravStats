import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { DraftStation } from "../../../../types/tripBuilder";
import ReviewStationRow from "../ReviewStationRow";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("../../../../lib/api/tripBuilder", () => ({
  tripBuilderApi: {
    previewUrl: (draftId: string, index: number, size: string) =>
      `/thumb/${draftId}/${index}/${size}`,
  },
}));

// Synthetic fixtures only (public repository): invented places, shifted years.
const STATION: DraftStation = {
  key: "-901|3374|2031-05-02",
  title: "Northvale",
  titleSource: "geocode",
  kind: "visit",
  lat: -45.05,
  lon: 168.7,
  snappedKm: 1.4,
  firstDay: "2031-05-02",
  lastDay: "2031-05-03",
  firstLocal: "2031-05-02 09:00",
  lastLocal: "2031-05-03 17:30",
  photoCount: 30,
  previewIdx: [3, 4],
  notes: "First photo 09:00 · last 17:30 · 30 photos",
};

function renderRow(
  over: Partial<DraftStation> = {},
  props: Partial<Parameters<typeof ReviewStationRow>[0]> = {}
) {
  const onEdit = vi.fn();
  render(
    <ReviewStationRow
      station={{ ...STATION, ...over }}
      draftId="d-1"
      slept
      canSleep={false}
      canMerge
      canFold={false}
      onEdit={onEdit}
      {...props}
    />
  );
  return onEdit;
}

const open = () => fireEvent.click(screen.getByRole("button", { expanded: false }));

describe("ReviewStationRow, closed", () => {
  it("is a line with the name, the days, the photos and whether the night was spent there", () => {
    renderRow();
    expect(screen.getByText("Northvale")).toBeInTheDocument();
    expect(screen.getByText("02.05.2031 – 03.05.2031")).toBeInTheDocument();
    expect(screen.getByText('tripBuilder:review.station.photos {"count":30}')).toBeInTheDocument();
    expect(screen.getByText("tripBuilder:review.station.slept")).toBeInTheDocument();
  });

  it("loads no thumbnail and shows no field until it is opened", () => {
    renderRow();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("names what kind of stop it is when that is not a visit", () => {
    renderRow({ kind: "dayTrip" });
    expect(screen.getByText("tripBuilder:review.station.kind.dayTrip")).toBeInTheDocument();
  });
});

describe("ReviewStationRow, open", () => {
  it("shows the thumbnails by index, lazily, and how far the stop was moved onto the road", () => {
    renderRow();
    open();
    const images = Array.from(document.querySelectorAll("img"));
    expect(images.map((img) => img.getAttribute("src"))).toEqual([
      "/thumb/d-1/3/thumbnail",
      "/thumb/d-1/4/thumbnail",
    ]);
    expect(images.every((img) => img.getAttribute("loading") === "lazy")).toBe(true);
    expect(screen.getByText('tripBuilder:review.station.snapped {"km":"1.4"}')).toBeInTheDocument();
  });

  it("renames on leaving the field, trimmed", () => {
    const onEdit = renderRow();
    open();
    const name = screen.getByLabelText("tripBuilder:review.station.name");
    fireEvent.change(name, { target: { value: "  Northvale Lodge " } });
    fireEvent.blur(name);
    expect(onEdit).toHaveBeenCalledWith({
      type: "rename",
      stationKey: STATION.key,
      title: "Northvale Lodge",
    });
  });

  it("puts a blank name back instead of sending it, and sends nothing for an unchanged one", () => {
    const onEdit = renderRow();
    open();
    const name = screen.getByLabelText("tripBuilder:review.station.name");
    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.blur(name);
    expect(name).toHaveValue("Northvale");
    fireEvent.blur(name);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("saves the note on leaving the field", () => {
    const onEdit = renderRow();
    open();
    const note = screen.getByLabelText("tripBuilder:review.station.note");
    fireEvent.change(note, { target: { value: "Slept in the van" } });
    fireEvent.blur(note);
    expect(onEdit).toHaveBeenCalledWith({
      type: "setNote",
      stationKey: STATION.key,
      notes: "Slept in the van",
    });
  });

  it("switches 'slept here' off", () => {
    const onEdit = renderRow();
    open();
    fireEvent.click(screen.getByRole("switch"));
    expect(onEdit).toHaveBeenCalledWith({
      type: "toggleSlept",
      stationKey: STATION.key,
      slept: false,
    });
  });

  it("will not switch it on when no unknown night is within reach, and says why", () => {
    renderRow({}, { slept: false, canSleep: false });
    open();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText("tripBuilder:review.station.sleptNone")).toBeInTheDocument();
  });

  it("switches 'slept here' on when an unknown night is within reach", () => {
    const onEdit = renderRow({}, { slept: false, canSleep: true });
    open();
    fireEvent.click(screen.getByRole("switch"));
    expect(onEdit).toHaveBeenCalledWith({
      type: "toggleSlept",
      stationKey: STATION.key,
      slept: true,
    });
  });

  it("joins with the next, when it can, and removes", () => {
    const onEdit = renderRow();
    open();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.station.merge" }));
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.station.delete" }));
    expect(onEdit).toHaveBeenNthCalledWith(1, { type: "merge", stationKey: STATION.key });
    expect(onEdit).toHaveBeenNthCalledWith(2, { type: "delete", stationKey: STATION.key });
  });

  it("will not join the last station", () => {
    renderRow({}, { canMerge: false });
    open();
    expect(screen.getByRole("button", { name: "tripBuilder:review.station.merge" })).toBeDisabled();
  });

  it("folds an excursion back, and only an excursion", () => {
    const onEdit = renderRow({ kind: "dayTrip" }, { canFold: true });
    open();
    fireEvent.click(screen.getByRole("button", { name: "tripBuilder:review.station.fold" }));
    expect(onEdit).toHaveBeenCalledWith({ type: "foldDayTrip", stationKey: STATION.key });
  });

  it("offers no fold for an ordinary stop", () => {
    renderRow();
    open();
    expect(screen.queryByRole("button", { name: "tripBuilder:review.station.fold" })).toBeNull();
  });

  it("treats home as an anchor: no night switch, no join, no remove", () => {
    renderRow({ kind: "home" }, { slept: false });
    open();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "tripBuilder:review.station.merge" })).toBeNull();
    expect(screen.queryByRole("button", { name: "tripBuilder:review.station.delete" })).toBeNull();
  });
});
