import { isTripShape } from "../builderNightPlan";

/**
 * The one predicate for "this area's stations are a legitimate trip shape"
 * (owner directive 2026-10-13, after the "Sumayya's wedding" re-sync blocker):
 * two dated station rows, or exactly one when the area is the multi-night
 * stay that row is. The create guard, the re-sync guard, the review's report
 * and the scan's offer all read it; the matrix in
 * `services/tripBuilder/__tests__/tripShape.test.ts` proves they cannot drift
 * apart.
 */

/** The Karachi shape: one station, the whole area's nights, photos on many days. */
const STAY = {
  startDay: "2031-05-02",
  endDay: "2031-05-16",
  stations: [{ firstDay: "2031-05-02", lastDay: "2031-05-15" }],
};

/** The five-hour transit / one-night stop: no stay, whatever the window. */
const NO_STAY = {
  startDay: "2031-05-02",
  endDay: "2031-05-03",
  stations: [{ firstDay: "2031-05-02", lastDay: "2031-05-03" }],
};

describe("isTripShape", () => {
  it("accepts the one row a multi-night stay writes", () => {
    expect(isTripShape(1, STAY)).toBe(true);
  });

  it("refuses one row for an area that is no stay", () => {
    expect(isTripShape(1, NO_STAY)).toBe(false);
    // A long window whose every photo sits on one day is no stay either:
    // nothing much happened, and one row is still too few.
    expect(
      isTripShape(1, {
        startDay: "2031-05-02",
        endDay: "2031-05-16",
        stations: [{ firstDay: "2031-05-02", lastDay: "2031-05-02" }],
      })
    ).toBe(false);
  });

  it("refuses an area left with no row at all, stay or not", () => {
    expect(isTripShape(0, STAY)).toBe(false);
    expect(isTripShape(0, NO_STAY)).toBe(false);
  });

  it("accepts two rows or more of any area", () => {
    expect(isTripShape(2, NO_STAY)).toBe(true);
    expect(isTripShape(3, { ...NO_STAY, stations: [] })).toBe(true);
  });
});
