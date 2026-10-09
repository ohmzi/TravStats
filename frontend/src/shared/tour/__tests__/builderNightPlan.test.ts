import { describe, expect, it } from "vitest";

import { addDays, NIGHT_SPECIALS, nightsOf } from "../builderNightPlan";

describe("builderNightPlan vocabulary", () => {
  it("answers a night with a station key or one of three words", () => {
    expect(NIGHT_SPECIALS).toEqual(["home", "unknown", "flight"]);
  });

  it("moves a day across month, year and leap-day ends", () => {
    expect(addDays("2031-05-31", 1)).toBe("2031-06-01");
    expect(addDays("2031-12-31", 1)).toBe("2032-01-01");
    expect(addDays("2032-02-28", 1)).toBe("2032-02-29");
    expect(addDays("2031-03-01", -1)).toBe("2031-02-28");
    expect(addDays("2031-05-02", 0)).toBe("2031-05-02");
  });

  it("lists the nights S … E−1 of a window", () => {
    expect(nightsOf({ startDay: "2031-05-30", endDay: "2031-06-02" })).toEqual([
      "2031-05-30",
      "2031-05-31",
      "2031-06-01",
    ]);
  });

  it("has no night in a one-day window", () => {
    expect(nightsOf({ startDay: "2031-05-02", endDay: "2031-05-02" })).toEqual([]);
  });
});
