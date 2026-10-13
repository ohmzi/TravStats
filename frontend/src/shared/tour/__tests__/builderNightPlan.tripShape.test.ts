import { describe, expect, it } from "vitest";

import { isTripShape } from "../builderNightPlan";

/**
 * The frontend copy of the one predicate for "this area's stations are a
 * legitimate trip shape" — the backend file
 * (`backend/src/shared/tour/__tests__/builderNightPlan.tripShape.test.ts`) is
 * the same table, and `builderNightPlan.mirror.test.ts` holds the two source
 * files byte-identical. The review's own read of it is pinned in
 * `lib/tripBuilder/__tests__/reviewView.test.ts`.
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
