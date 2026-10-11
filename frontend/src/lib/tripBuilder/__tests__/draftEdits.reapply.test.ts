import { describe, expect, it } from "vitest";

import {
  applyEdit,
  initialReviewState,
  reapplyEdits,
  type DraftEdit,
  type ReviewState,
} from "../draftEdits";
import { FLIGHT_OUT, JOURNEY, KEY, PITSTOP_KEY, pitstopDraft, reviewDraft } from "./reviewFixtures";

const draft = pitstopDraft();

const EDITS: DraftEdit[] = [
  { type: "rename", stationKey: KEY.northvale, title: "Northvale Lodge" },
  { type: "assignNight", day: "2031-05-06", assign: KEY.tarnside },
  { type: "setLegMode", fromKey: KEY.southbridge, toKey: KEY.tarnside, mode: "ferry" },
  { type: "foldDayTrip", stationKey: KEY.portCarrow },
  { type: "setFlightTick", flightId: FLIGHT_OUT, ticked: false },
  { type: "togglePhotoJourney", id: JOURNEY, ticked: false },
  { type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: false },
  { type: "setTripName", name: "Autumn loop" },
];

function played(edits: readonly DraftEdit[]): ReviewState {
  return edits.reduce((state, edit) => applyEdit(draft, state, edit), initialReviewState(draft));
}

describe("reapplyEdits", () => {
  it("rebuilds the state the edits made, edit log included", () => {
    const original = played(EDITS);
    const again = reapplyEdits(draft, original.edits);
    expect(again.state).toEqual(original);
    expect(again).toMatchObject({ kept: EDITS.length, total: EDITS.length });
  });

  it("survives the trip through sessionStorage", () => {
    const original = played(EDITS);
    const stored = JSON.parse(JSON.stringify(original.edits)) as DraftEdit[];
    expect(reapplyEdits(draft, stored).state).toEqual(original);
  });

  it("starts from the draft when there is nothing to replay", () => {
    expect(reapplyEdits(draft, [])).toEqual({
      state: initialReviewState(draft),
      kept: 0,
      total: 0,
    });
  });

  it("drops an edit whose station the new draft no longer has, and counts the rest", () => {
    const without = reviewDraft({
      areas: draft.areas.map((area) => ({
        ...area,
        stations: area.stations.filter((s) => s.key !== KEY.tarnside),
        legs: area.legs.filter((l) => l.toKey !== KEY.tarnside),
      })),
    });
    const { state, kept, total } = reapplyEdits(without, [
      { type: "rename", stationKey: KEY.tarnside, title: "Gone" },
      { type: "rename", stationKey: KEY.northvale, title: "Still here" },
    ]);
    expect([kept, total]).toEqual([1, 2]);
    expect(state.areas[0].stations[1].title).toBe("Still here");
    expect(state.edits).toHaveLength(1);
  });

  it("drops a night answer the new draft's window cannot hold", () => {
    const shorter = reviewDraft({
      window: { ...draft.window, endDay: "2031-05-05" },
      nights: Object.fromEntries(Object.entries(draft.nights).slice(0, 3)),
    });
    const { kept } = reapplyEdits(shorter, [
      { type: "assignNight", day: "2031-05-06", assign: "home" },
    ]);
    expect(kept).toBe(0);
  });

  it("drops what depended on an edit that was dropped", () => {
    const { kept, total } = reapplyEdits(reviewDraft({ areas: [], nights: {} }), [
      { type: "merge", stationKey: KEY.northvale },
      { type: "rename", stationKey: KEY.northvale, title: "x" },
    ]);
    expect([kept, total]).toEqual([0, 2]);
  });

  it("drops an edit of a kind it does not know, as an older page might have stored", () => {
    const unknown = { type: "reorderEverything" } as unknown as DraftEdit;
    expect(reapplyEdits(draft, [unknown, EDITS[0]])).toMatchObject({ kept: 1, total: 2 });
  });

  it("drops a pitstop album edit a re-scan no longer offers", () => {
    const { kept, total } = reapplyEdits(reviewDraft(), [
      { type: "setAreaAlbum", areaKey: PITSTOP_KEY, album: false },
      { type: "setFlightTick", flightId: FLIGHT_OUT, ticked: false },
    ]);
    expect([kept, total]).toEqual([1, 2]);
  });
});
