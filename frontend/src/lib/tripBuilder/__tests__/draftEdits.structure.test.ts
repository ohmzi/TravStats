import { describe, expect, it } from "vitest";

import { applyEdit, initialReviewState, type DraftEdit } from "../draftEdits";
import { legsFitStations } from "../stationOps";
import { KEY, reviewDraft } from "./reviewFixtures";

const draft = reviewDraft();
const start = initialReviewState(draft);

function run(...edits: DraftEdit[]) {
  return edits.reduce((state, edit) => applyEdit(draft, state, edit), start);
}

const keysOf = (areaIndex: number) => (state: typeof start) =>
  state.areas[areaIndex].stations.map((s) => s.key);

describe("merge", () => {
  it("joins a station with the next one under its own key and keeps the legs in step", () => {
    const next = run({ type: "merge", stationKey: KEY.northvale });
    const [area] = next.areas;
    expect(keysOf(0)(next)).toEqual([KEY.home, KEY.northvale, KEY.northvaleAgain]);
    expect(area.stations[1]).toMatchObject({
      lastDay: "2031-05-03",
      photoCount: 36,
      kind: "visit",
    });
    expect(area.legs.map((l) => [l.fromKey, l.toKey])).toEqual([
      [KEY.home, KEY.northvale],
      [KEY.northvale, KEY.northvaleAgain],
    ]);
    expect(area.legModes).toEqual(["road", "road"]);
    expect(legsFitStations(area)).toBe(true);
    expect(next.edits).toEqual([{ type: "merge", stationKey: KEY.northvale }]);
  });

  it("moves the night of the station that goes to the one that stays", () => {
    const next = run({ type: "merge", stationKey: KEY.portCarrow });
    expect(next.nights["2031-05-03"]).toBe(KEY.portCarrow);
  });

  it("refuses an anchor, the last station of an area and a station that is not there", () => {
    expect(applyEdit(draft, start, { type: "merge", stationKey: KEY.home })).toBe(start);
    expect(applyEdit(draft, start, { type: "merge", stationKey: KEY.northvaleAgain })).toBe(start);
    expect(applyEdit(draft, start, { type: "merge", stationKey: "nope" })).toBe(start);
  });
});

describe("delete", () => {
  it("does not fold structural edits into one another", () => {
    const next = run(
      { type: "delete", stationKey: KEY.tarnside },
      { type: "delete", stationKey: KEY.southbridge }
    );
    expect(next.edits).toHaveLength(2);
  });

  it("takes the station out, joins its neighbours and leaves its nights unknown", () => {
    const next = run({ type: "delete", stationKey: KEY.northvale });
    expect(keysOf(0)(next)).toEqual([KEY.home, KEY.portCarrow, KEY.northvaleAgain]);
    expect(next.nights["2031-05-02"]).toBe("unknown");
    expect(legsFitStations(next.areas[0])).toBe(true);
    expect(next.areas[0].stations[1].excursionOf).toBeUndefined();
  });

  it("clears the home flag when the home station goes", () => {
    const next = run({ type: "delete", stationKey: KEY.home });
    expect(next.areas[0].homeStart).toBe(false);
  });

  it("can empty an area, and refuses a station that is not there", () => {
    const next = run(
      { type: "delete", stationKey: KEY.southbridge },
      { type: "delete", stationKey: KEY.tarnside }
    );
    expect(next.areas[1]).toMatchObject({ stations: [], legs: [], legModes: [] });
    expect(next.nights["2031-05-05"]).toBe("unknown");
    expect(applyEdit(draft, start, { type: "delete", stationKey: "nope" })).toBe(start);
  });
});

describe("foldDayTrip", () => {
  it("removes the excursion and takes the return into the stop it left from", () => {
    const next = run({ type: "foldDayTrip", stationKey: KEY.portCarrow });
    expect(keysOf(0)(next)).toEqual([KEY.home, KEY.northvale]);
    expect(next.areas[0].stations[1]).toMatchObject({ lastDay: "2031-05-03", photoCount: 35 });
    expect(next.nights["2031-05-03"]).toBe(KEY.northvale);
    expect(legsFitStations(next.areas[0])).toBe(true);
  });

  it("is refused for a station that is not an excursion", () => {
    expect(applyEdit(draft, start, { type: "foldDayTrip", stationKey: KEY.northvale })).toBe(start);
  });
});

describe("toggleSlept", () => {
  it("gives an unknown night within reach to the station", () => {
    const next = run({ type: "toggleSlept", stationKey: KEY.tarnside, slept: true });
    expect(next.nights["2031-05-06"]).toBe(KEY.tarnside);
  });

  it("is accepted without change for a station that already sleeps", () => {
    const next = run({ type: "toggleSlept", stationKey: KEY.northvale, slept: true });
    expect(next).not.toBe(start);
    expect(next.nights).toEqual(start.nights);
  });

  it("is refused when no unknown night is within the station's reach", () => {
    expect(
      applyEdit(draft, start, { type: "toggleSlept", stationKey: KEY.portCarrow, slept: true })
    ).toBe(start);
  });

  it("turns the station's nights unknown when switched off", () => {
    const next = run({ type: "toggleSlept", stationKey: KEY.southbridge, slept: false });
    expect(next.nights["2031-05-05"]).toBe("unknown");
  });
});

describe("toggleHome", () => {
  it("drops the home station at the start, with its leg", () => {
    const next = run({ type: "toggleHome", areaKey: "2031-05-02#1", end: "start", on: false });
    expect(keysOf(0)(next)).toEqual([KEY.northvale, KEY.portCarrow, KEY.northvaleAgain]);
    expect(next.areas[0]).toMatchObject({ homeStart: false, legModes: ["road", "road"] });
  });

  it("puts it back, joined by a road", () => {
    const next = run(
      { type: "toggleHome", areaKey: "2031-05-02#1", end: "start", on: false },
      { type: "toggleHome", areaKey: "2031-05-02#1", end: "start", on: true }
    );
    expect(keysOf(0)(next)).toEqual([KEY.home, KEY.northvale, KEY.portCarrow, KEY.northvaleAgain]);
    expect(next.areas[0].homeStart).toBe(true);
    expect(legsFitStations(next.areas[0])).toBe(true);
    expect(next.edits).toHaveLength(1);
  });

  it("is accepted without change when the end already is as asked", () => {
    const next = run({ type: "toggleHome", areaKey: "2031-05-02#1", end: "start", on: true });
    expect(next).not.toBe(start);
    expect(keysOf(0)(next)).toEqual(keysOf(0)(start));
  });

  it("is refused for an end the scan did not offer, and for an area that is not there", () => {
    const end = { type: "toggleHome", areaKey: "2031-05-02#1", end: "end", on: true } as const;
    expect(applyEdit(draft, start, end)).toBe(start);
    const other = { type: "toggleHome", areaKey: "x", end: "start", on: true } as const;
    expect(applyEdit(draft, start, other)).toBe(start);
  });
});
