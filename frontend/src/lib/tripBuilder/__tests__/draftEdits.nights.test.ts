import { describe, expect, it } from "vitest";

import type { NightEntry } from "../../../types/tripBuilder";
import { applyEdit, initialReviewState, type DraftEdit } from "../draftEdits";
import { sleepNight } from "../nightRules";
import {
  effectiveNights,
  nightFits,
  planErrors,
  resolvedNights,
  sleptKeys,
  stillOpenNights,
} from "../planRules";
import { AREAS, KEY, reviewDraft, station } from "./reviewFixtures";

const draft = reviewDraft();
const start = initialReviewState(draft);

/** A night the scan left open with nothing to suggest. */
const openNight: NightEntry = { assign: "unknown", reason: "unknown", suggestedStationKeys: [] };

function run(...edits: DraftEdit[]) {
  return edits.reduce((state, edit) => applyEdit(draft, state, edit), start);
}

describe("the draft as scanned", () => {
  it("is a plan the commit would accept", () => {
    expect(planErrors(draft, start)).toEqual([]);
  });

  it("sleeps at the stations that hold a night, the answered open night's default included", () => {
    expect([...sleptKeys(draft, start)].sort()).toEqual(
      [KEY.northvale, KEY.northvaleAgain, KEY.southbridge, KEY.tarnside].sort()
    );
  });
});

describe("an open night resolves to the app's default", () => {
  it("takes the scan's suggestion, keeps the raw answer, and lets an answer from the user win", () => {
    expect(resolvedNights(draft, start)).toEqual({
      "2031-05-02": KEY.northvale,
      "2031-05-03": KEY.northvaleAgain,
      "2031-05-04": "flight",
      "2031-05-05": KEY.southbridge,
      "2031-05-06": KEY.tarnside,
    });
    // The raw answer stays the open question it was; the default is what the plan reads.
    expect(start.nights["2031-05-06"]).toBe("unknown");
    expect(planErrors(draft, start)).toEqual([]);
    const answered = run({ type: "assignNight", day: "2031-05-06", assign: "home" });
    expect(resolvedNights(draft, answered)["2031-05-06"]).toBe("home");
  });

  it("takes the previous night's place when the night has no suggestion", () => {
    const noSuggestion = reviewDraft({
      nights: { ...draft.nights, "2031-05-06": openNight },
    });
    const state = initialReviewState(noSuggestion);
    expect(resolvedNights(noSuggestion, state)["2031-05-06"]).toBe(KEY.southbridge);
    expect(planErrors(noSuggestion, state)).toEqual([]);
  });

  it("chains the place through a night that resolved by its suggestion", () => {
    const chained = reviewDraft({
      nights: {
        ...draft.nights,
        "2031-05-05": {
          assign: "unknown",
          reason: "unknown",
          suggestedStationKeys: [KEY.southbridge],
        },
        "2031-05-06": openNight,
      },
    });
    const state = initialReviewState(chained);
    expect(resolvedNights(chained, state)["2031-05-06"]).toBe(KEY.southbridge);
  });

  it("takes home when the previous night was spent at home", () => {
    const away = reviewDraft({
      nights: {
        ...draft.nights,
        "2031-05-05": { assign: "home", reason: "home", suggestedStationKeys: [] },
        "2031-05-06": openNight,
      },
    });
    const state = initialReviewState(away);
    expect(resolvedNights(away, state)["2031-05-06"]).toBe("home");
  });

  it("keeps a night with no place to go open: the one case that still refuses", () => {
    const stranded = reviewDraft({
      nights: {
        ...draft.nights,
        "2031-05-05": { assign: "flight", reason: "flight", suggestedStationKeys: [] },
        "2031-05-06": openNight,
      },
    });
    const state = initialReviewState(stranded);
    expect(resolvedNights(stranded, state)["2031-05-06"]).toBe("unknown");
    expect(stillOpenNights(stranded, state)).toEqual(["2031-05-06"]);
    // The commit's own validator accepts an open night; it is the review that must not send one.
    expect(planErrors(stranded, state)).toEqual([]);
  });

  it("reads a skipped area's answers as open, and resolves what may hold them", () => {
    const skipped = run({ type: "setAreaKind", areaKey: "2031-05-05#1", as: "skip" });
    expect(effectiveNights(skipped)["2031-05-05"]).toBe("unknown");
    expect(resolvedNights(draft, skipped)["2031-05-05"]).toBe("unknown");
    expect(stillOpenNights(draft, skipped)).toEqual(["2031-05-05", "2031-05-06"]);
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
    expect([...sleptKeys(draft, skipped)]).not.toContain(KEY.southbridge);
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

describe("two areas on consecutive days", () => {
  // Northvale's area ends on the 3rd and Southbridge's starts on the 4th, so
  // the night of the 3rd is within reach of the last stop of one and the first
  // stop of the other. Southbridge's own evening is taken (the 4th is home).
  const southbridge = station(KEY.southbridge, "Southbridge", "2031-05-04", "2031-05-04", {
    lat: -45.4,
    lon: 169.1,
  });
  const adjacent = reviewDraft({
    areas: [
      AREAS[0],
      {
        ...AREAS[1],
        startDay: "2031-05-04",
        endDay: "2031-05-04",
        stations: [southbridge],
        legs: [],
      },
    ],
  });
  const base = initialReviewState(adjacent);
  const nights = {
    ...base.nights,
    "2031-05-03": KEY.northvaleAgain,
    "2031-05-04": "home",
    "2031-05-05": "unknown",
  };
  const skipFirst = applyEdit(
    adjacent,
    { ...base, nights },
    { type: "setAreaKind", areaKey: "2031-05-02#1", as: "skip" }
  );

  it("offers the night of a skipped area to the stop it is next to", () => {
    expect(effectiveNights(skipFirst)["2031-05-03"]).toBe("unknown");
    expect(sleepNight(adjacent, skipFirst, KEY.southbridge)).toBe("2031-05-03");
  });

  it("lets 'slept here' take it, as the night picker would", () => {
    const slept = applyEdit(adjacent, skipFirst, {
      type: "toggleSlept",
      stationKey: KEY.southbridge,
      slept: true,
    });
    expect(slept).not.toBe(skipFirst);
    expect(slept.nights["2031-05-03"]).toBe(KEY.southbridge);
    const picked = applyEdit(adjacent, skipFirst, {
      type: "assignNight",
      day: "2031-05-03",
      assign: KEY.southbridge,
    });
    expect(slept.nights).toEqual(picked.nights);
  });

  it("does not offer it while the first area still holds it", () => {
    const held = { ...skipFirst, areas: base.areas, nights };
    expect(sleepNight(adjacent, held, KEY.southbridge)).toBeNull();
  });
});
