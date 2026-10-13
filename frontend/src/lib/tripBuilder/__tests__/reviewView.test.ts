import { describe, expect, it } from "vitest";

import { applyEdit, initialReviewState, type DraftEdit } from "../draftEdits";
import {
  areaDays,
  nightChoices,
  placeNights,
  previewGeometry,
  previewStations,
  reviewProblems,
  stationsByDay,
  stopoverHours,
  unknownNightCount,
} from "../reviewView";
import {
  KEY,
  STOPOVER,
  STOPOVER_FLIGHTS,
  STOPOVER_OUT,
  reviewDraft,
  station,
  stopoverDraft,
} from "./reviewFixtures";

const draft = reviewDraft();
const start = initialReviewState(draft);

function run(...edits: DraftEdit[]) {
  return edits.reduce((state, edit) => applyEdit(draft, state, edit), start);
}

describe("areaDays", () => {
  it("lists the days of the trip that lie inside the area", () => {
    expect(areaDays(draft, start.areas[0]).map((d) => d.day)).toEqual(["2031-05-02", "2031-05-03"]);
    expect(areaDays(draft, start.areas[1]).map((d) => d.day)).toEqual(["2031-05-05", "2031-05-06"]);
  });
});

describe("stationsByDay", () => {
  const days = ["2031-05-02", "2031-05-03"];

  it("files each station under the day it starts, with its place in the area", () => {
    const byDay = stationsByDay(start.areas[0], days);
    expect([...byDay].map(([day, rows]) => [day, rows.map((r) => r.index)])).toEqual([
      ["2031-05-02", [0, 1]],
      ["2031-05-03", [2, 3]],
    ]);
  });

  it("draws a station dated outside the area's days on the nearest day it has", () => {
    const early = { stations: [station("e", "Early", "2031-05-01", "2031-05-01")] };
    const late = { stations: [station("l", "Late", "2031-05-09", "2031-05-09")] };
    expect([...stationsByDay(early, days).keys()]).toEqual(["2031-05-02"]);
    expect([...stationsByDay(late, days).keys()]).toEqual(["2031-05-03"]);
  });

  it("files nothing for an area with no days", () => {
    expect(stationsByDay(start.areas[0], []).size).toBe(0);
  });
});

describe("nightChoices", () => {
  it("offers the places next to the night, then home and unknown, with the scan's suggestion marked", () => {
    expect(nightChoices(draft, start, "2031-05-06")).toEqual([
      { value: KEY.southbridge, title: "Southbridge", suggested: false },
      { value: KEY.tarnside, title: "Tarnside", suggested: true },
      { value: "home", title: null, suggested: false },
      { value: "unknown", title: null, suggested: false },
    ]);
  });

  it("marks the place an open night resolved to, even when the scan suggested nothing", () => {
    // The night of the 6th has no suggestion; the previous night's place (Southbridge) answers it.
    const noSuggestion = reviewDraft({
      nights: {
        ...draft.nights,
        "2031-05-06": { assign: "unknown", reason: "unknown", suggestedStationKeys: [] },
      },
    });
    const state = initialReviewState(noSuggestion);
    expect(nightChoices(noSuggestion, state, "2031-05-06")).toEqual([
      { value: KEY.southbridge, title: "Southbridge", suggested: true },
      { value: KEY.tarnside, title: "Tarnside", suggested: false },
      { value: "home", title: null, suggested: false },
      { value: "unknown", title: null, suggested: false },
    ]);
  });

  it("leaves out anchors and excursions, and the places of another area", () => {
    expect(nightChoices(draft, start, "2031-05-03").map((c) => c.value)).toEqual([
      KEY.northvale,
      KEY.northvaleAgain,
      "home",
      "unknown",
    ]);
  });

  it("keeps the night's present answer among the choices, even an excursion that was assigned", () => {
    const moved = run({ type: "assignNight", day: "2031-05-03", assign: KEY.portCarrow });
    expect(nightChoices(draft, moved, "2031-05-03")[0]).toEqual({
      value: KEY.portCarrow,
      title: "Port Carrow",
      suggested: false,
    });
  });

  it("leaves out the places of a skipped area", () => {
    const skipped = run({ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" });
    expect(nightChoices(draft, skipped, "2031-05-06").map((c) => c.value)).toEqual([
      "home",
      "unknown",
    ]);
  });
});

describe("placeNights", () => {
  it("draws a night in the area of its station, or of the days that hold it, or of the evening before it", () => {
    const { byArea, loose } = placeNights(draft, start);
    expect(byArea.get("2031-05-02#1")).toEqual(["2031-05-02", "2031-05-03"]);
    expect(byArea.get("2031-05-05#1")).toEqual(["2031-05-04", "2031-05-05", "2031-05-06"]);
    expect(loose).toEqual([]);
  });

  it("leaves a night loose when no saved area claims it", () => {
    const skipped = run({ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" });
    const { byArea, loose } = placeNights(draft, skipped);
    expect(byArea.get("2031-05-05#1")).toBeUndefined();
    expect(loose).toEqual(["2031-05-04", "2031-05-05", "2031-05-06"]);
  });
});

describe("unknownNightCount", () => {
  it("counts only the nights neither the scan's suggestion nor the previous place answers", () => {
    expect(unknownNightCount(draft, start)).toBe(0);
    // A skipped area's two nights: its stations are gone, so nothing may hold them.
    expect(
      unknownNightCount(draft, run({ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" }))
    ).toBe(2);
  });

  it("counts the night a dead area leaves with nowhere to go", () => {
    const stranded = reviewDraft({
      nights: {
        ...draft.nights,
        "2031-05-05": { assign: "flight", reason: "flight", suggestedStationKeys: [] },
        "2031-05-06": { assign: "unknown", reason: "unknown", suggestedStationKeys: [] },
      },
    });
    expect(unknownNightCount(stranded, initialReviewState(stranded))).toBe(1);
  });
});

describe("reviewProblems", () => {
  it("finds none in the draft as scanned", () => {
    expect(reviewProblems(draft, start)).toEqual([]);
  });

  it("holds a new trip to a name", () => {
    expect(reviewProblems(draft, run({ type: "setTripName", name: "  " }))).toEqual([
      { code: "blankTripName" },
    ]);
  });

  it("holds a roadtrip to two rows, and lets a skipped or stop area off", () => {
    const emptied = run(
      { type: "delete", stationKey: KEY.southbridge },
      { type: "delete", stationKey: KEY.tarnside }
    );
    // The stations that held the 5th and the 6th are gone: those two nights now
    // have no place at all, so the plan refuses (ruling 2026-10-13) — the one
    // refusal that survives, next to the row count the area still owes.
    expect(reviewProblems(draft, emptied)).toEqual([
      { code: "roadtripTooShort", areaKey: "2031-05-05#1" },
      { code: "nightPlanInvalid" },
    ]);
    const skipped = applyEdit(draft, emptied, {
      type: "setAreaKind",
      areaKey: "2031-05-05#1",
      as: "skip",
    });
    expect(reviewProblems(draft, skipped)).toEqual([{ code: "nightPlanInvalid" }]);
  });

  it("holds the trip until a night nothing may hold is answered, and lets it go after", () => {
    const stranded = reviewDraft({
      nights: {
        ...draft.nights,
        "2031-05-05": { assign: "flight", reason: "flight", suggestedStationKeys: [] },
        "2031-05-06": { assign: "unknown", reason: "unknown", suggestedStationKeys: [] },
      },
    });
    const state = initialReviewState(stranded);
    expect(reviewProblems(stranded, state)).toEqual([{ code: "nightPlanInvalid" }]);
    const answered = applyEdit(stranded, state, {
      type: "assignNight",
      day: "2031-05-06",
      assign: KEY.tarnside,
    });
    expect(reviewProblems(stranded, answered)).toEqual([]);
  });

  it("does not hold an existing trip to a name or to two rows", () => {
    const existing = reviewDraft({
      target: {
        kind: "existing",
        tripId: "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c",
        tripName: "Southern loop",
      },
    });
    let state = initialReviewState(existing);
    state = applyEdit(existing, state, { type: "setTripName", name: "" });
    state = applyEdit(existing, state, { type: "delete", stationKey: KEY.tarnside });
    state = applyEdit(existing, state, { type: "delete", stationKey: KEY.southbridge });
    // Still not held to a name or to two rows; the only reason left is the two
    // nights the deleted stations took with them (ruling 2026-10-13).
    expect(reviewProblems(existing, state)).toEqual([{ code: "nightPlanInvalid" }]);
  });
});

describe("the map preview", () => {
  it("lists the stations of the saved areas", () => {
    expect(previewStations(draft, start)).toHaveLength(6);
    const skipped = run({ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" });
    expect(previewStations(draft, skipped)).toHaveLength(4);
  });

  it("draws one straight line per leg of a saved area, as longitude then latitude", () => {
    const geometry = previewGeometry(draft, start);
    expect(geometry.features).toHaveLength(4);
    expect(geometry.features[0].geometry.coordinates).toEqual([
      [172.64, -43.53],
      [168.7, -45.05],
    ]);
    expect(geometry.features[0].properties).toMatchObject({ source: "straight", mode: "road" });
  });

  it("draws a ferry leg as a ferry, and leaves a skipped area out", () => {
    const ferry = run(
      { type: "setLegMode", fromKey: KEY.southbridge, toKey: KEY.tarnside, mode: "ferry" },
      { type: "setAreaKind", areaKey: "2031-05-02#1", as: "skip" }
    );
    expect(previewGeometry(draft, ferry).features.map((f) => f.properties.mode)).toEqual(["ferry"]);
  });

  it("adds a stopover's tour once its roadtrip switch is on, and not before", () => {
    const withStopover = stopoverDraft();
    const off = initialReviewState(withStopover);
    expect(previewStations(withStopover, off)).toHaveLength(6);
    expect(previewGeometry(withStopover, off).features).toHaveLength(4);
    const on = applyEdit(withStopover, off, {
      type: "setStopoverTick",
      key: STOPOVER.key,
      roadtrip: true,
      album: false,
    });
    expect(previewStations(withStopover, on)).toHaveLength(9);
    expect(previewGeometry(withStopover, on).features).toHaveLength(6);
  });
});

describe("stopoverHours", () => {
  it("counts the whole hours from the arrival to the departure", () => {
    expect(stopoverHours(STOPOVER_FLIGHTS, STOPOVER)).toBe(7);
  });

  it("is null when a flight is missing from the draft or known only by its day", () => {
    expect(stopoverHours([], STOPOVER)).toBeNull();
    const dayOnly = STOPOVER_FLIGHTS.map((flight) =>
      flight.id === STOPOVER_OUT ? { ...flight, depLocal: "2031-05-04", precise: false } : flight
    );
    expect(stopoverHours(dayOnly, STOPOVER)).toBeNull();
  });
});
