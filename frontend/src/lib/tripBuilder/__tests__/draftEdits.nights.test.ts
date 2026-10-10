import { describe, expect, it } from "vitest";

import { applyEdit, initialReviewState, type DraftEdit } from "../draftEdits";
import { nightFits, sleepNight } from "../nightRules";
import { effectiveNights, planErrors, sleptKeys } from "../planRules";
import { KEY, reviewDraft } from "./reviewFixtures";

const draft = reviewDraft();
const start = initialReviewState(draft);

function run(...edits: DraftEdit[]) {
  return edits.reduce((state, edit) => applyEdit(draft, state, edit), start);
}

describe("the draft as scanned", () => {
  it("is a plan the commit would accept", () => {
    expect(planErrors(draft, start)).toEqual([]);
  });

  it("sleeps at the three stations that hold a night", () => {
    expect([...sleptKeys(start)].sort()).toEqual(
      [KEY.northvale, KEY.northvaleAgain, KEY.southbridge].sort()
    );
  });
});

describe("assignNight", () => {
  it("gives an unknown night to a station next to it, in its own area", () => {
    const next = run({ type: "assignNight", day: "2031-05-06", assign: KEY.tarnside });
    expect(next.nights["2031-05-06"]).toBe(KEY.tarnside);
  });

  it("gives it to home or leaves it unknown, and moves a night that was assigned", () => {
    expect(
      run({ type: "assignNight", day: "2031-05-06", assign: "home" }).nights["2031-05-06"]
    ).toBe("home");
    const moved = run({ type: "assignNight", day: "2031-05-03", assign: KEY.portCarrow });
    expect(moved.nights["2031-05-03"]).toBe(KEY.portCarrow);
    const unknown = run({ type: "assignNight", day: "2031-05-05", assign: "unknown" });
    expect(unknown.nights["2031-05-05"]).toBe("unknown");
  });

  it("refuses a station of another area, however near the day", () => {
    const edit = { type: "assignNight", day: "2031-05-06", assign: KEY.northvale } as const;
    expect(applyEdit(draft, start, edit)).toBe(start);
  });

  it("refuses a station the night is too far from", () => {
    const edit = { type: "assignNight", day: "2031-05-02", assign: KEY.tarnside } as const;
    expect(applyEdit(draft, start, edit)).toBe(start);
  });

  it("refuses a day that is not a night of the trip, and a station that is not there", () => {
    expect(
      applyEdit(draft, start, { type: "assignNight", day: "2031-06-01", assign: "home" })
    ).toBe(start);
    expect(
      applyEdit(draft, start, {
        type: "assignNight",
        day: "2031-05-06",
        assign: "-1|-1|2031-05-06",
      })
    ).toBe(start);
  });

  it("refuses a station of a skipped area", () => {
    const skipped = run({ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" });
    const edit = { type: "assignNight", day: "2031-05-06", assign: KEY.tarnside } as const;
    expect(applyEdit(draft, skipped, edit)).toBe(skipped);
  });

  it("keeps one entry in the log for a night answered twice in a row", () => {
    const next = run(
      { type: "assignNight", day: "2031-05-06", assign: "home" },
      { type: "assignNight", day: "2031-05-06", assign: KEY.tarnside }
    );
    expect(next.edits).toEqual([{ type: "assignNight", day: "2031-05-06", assign: KEY.tarnside }]);
  });
});

describe("what a station could sleep", () => {
  it("fits the nights between a day before its first photo day and a day after its last", () => {
    expect(nightFits(draft, start, "2031-05-06", KEY.tarnside)).toBe(true);
    expect(nightFits(draft, start, "2031-05-05", KEY.tarnside)).toBe(true);
    expect(nightFits(draft, start, "2031-05-04", KEY.tarnside)).toBe(false);
    expect(nightFits(draft, start, "2031-05-03", KEY.tarnside)).toBe(false);
    expect(nightFits(draft, start, "2031-05-06", "nope")).toBe(false);
  });

  it("offers the evening of the last photo day as the night 'slept here' would claim", () => {
    expect(sleepNight(draft, start, KEY.tarnside)).toBe("2031-05-06");
    expect(sleepNight(draft, start, KEY.portCarrow)).toBeNull();
    expect(sleepNight(draft, start, "nope")).toBeNull();
  });
});

describe("setAreaKind", () => {
  it("does nothing for a skipped area, whose stations keep no night", () => {
    const skipped = run({ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" });
    const edit = { type: "toggleSlept", stationKey: KEY.tarnside, slept: true } as const;
    expect(applyEdit(draft, skipped, edit)).toBe(skipped);
  });

  it("names the one roadtrip that is left exactly like the trip", () => {
    const next = run({ type: "setAreaKind", areaKey: "2031-05-05#1", as: "stops" });
    expect(next.areas.map((a) => [a.as, a.name])).toEqual([
      ["roadtrip", "Southern loop"],
      ["stops", "Southern loop · Southbridge"],
    ]);
  });

  it("names them after their cities again when a second roadtrip returns", () => {
    const next = run(
      { type: "setAreaKind", areaKey: "2031-05-05#1", as: "stops" },
      { type: "setAreaKind", areaKey: "2031-05-05#1", as: "roadtrip" }
    );
    expect(next.areas.map((a) => a.name)).toEqual([
      "Southern loop · Northvale",
      "Southern loop · Southbridge",
    ]);
  });

  it("leaves a name the user typed alone", () => {
    const next = run(
      { type: "setAreaName", areaKey: "2031-05-02#1", name: "The long way" },
      { type: "setAreaKind", areaKey: "2031-05-05#1", as: "stops" }
    );
    expect(next.areas[0].name).toBe("The long way");
  });

  it("reads the nights of a skipped area as unknown, and gives them back when it returns", () => {
    const skipped = run({ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" });
    expect(effectiveNights(skipped)["2031-05-05"]).toBe("unknown");
    expect(skipped.nights["2031-05-05"]).toBe(KEY.southbridge);
    expect([...sleptKeys(skipped)]).not.toContain(KEY.southbridge);
    const back = applyEdit(draft, skipped, {
      type: "setAreaKind",
      areaKey: "2031-05-05#1",
      as: "roadtrip",
    });
    expect(effectiveNights(back)["2031-05-05"]).toBe(KEY.southbridge);
  });

  it("refuses an area that is not there", () => {
    expect(applyEdit(draft, start, { type: "setAreaKind", areaKey: "x", as: "skip" })).toBe(start);
  });
});
