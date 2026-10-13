import { isMultiNightStay } from "../../../shared/tour/builderNightPlan";
import { decideAreaKind } from "../areas";
import type { AreaHome, PlanStation } from "../types";
import { groundArea, noHome, station } from "./planFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.

/** One city, no home leg — the shape the stay test decides about. */
const oneCity = (over: Partial<PlanStation> = {}): PlanStation[] => [
  station("n1", { title: "Northvale", ...over }),
];

const homeLegs = (): AreaHome => ({
  start: { offered: true, defaultOn: true },
  end: { offered: true, defaultOn: false },
  unconfirmed: false,
});

/**
 * A stay of one city with no home leg is a trip of its own once it spans at
 * least two nights with photos on more than one day (owner ruling 2026-10-13,
 * "Sumayya's wedding": "clearly istanbul first stay and karachi stay should
 * prompt trip creation suggestion" — and "not the 5 hrs stay as nothing much
 * happened in there evident by pictures").
 */
describe("isMultiNightStay", () => {
  const nights = (startDay: string, endDay: string) => ({ startDay, endDay });
  const twoDays = [{ firstDay: "2031-05-02", lastDay: "2031-05-03" }];

  it("is a stay from two nights on, with photos on more than one day", () => {
    expect(isMultiNightStay("2031-05-02", "2031-05-04", twoDays)).toBe(true);
    expect(isMultiNightStay("2031-05-02", "2031-05-03", twoDays)).toBe(false);
  });

  it("is no stay for a same-day transit or a one-night stop", () => {
    const oneDay = [{ firstDay: "2031-05-02", lastDay: "2031-05-02" }];
    expect(isMultiNightStay("2031-05-02", "2031-05-02", oneDay)).toBe(false);
    expect(isMultiNightStay("2031-05-02", "2031-05-03", oneDay)).toBe(false);
  });

  it("is no stay when every photo sits on one day, however long the window", () => {
    const oneDay = [{ firstDay: "2031-05-02", lastDay: "2031-05-02" }];
    expect(isMultiNightStay("2031-05-02", "2031-05-09", oneDay)).toBe(false);
  });

  it("reads the stations of the area: one spanning two days is enough", () => {
    const spread = [
      { firstDay: "2031-05-02", lastDay: "2031-05-02" },
      { firstDay: "2031-05-05", lastDay: "2031-05-06" },
    ];
    expect(isMultiNightStay("2031-05-02", "2031-05-06", spread)).toBe(true);
  });
});

describe("decideAreaKind: a multi-night stay of one city", () => {
  it("is a roadtrip for the Karachi shape: one city, fifteen nights", () => {
    const stations = oneCity({ firstDay: "2031-05-02", lastDay: "2031-05-16" });
    const area = groundArea({ startDay: "2031-05-02", endDay: "2031-05-17" });
    expect(decideAreaKind({ stations, home: noHome(), area }, true)).toBe("roadtrip");
  });

  it("is a roadtrip for the Istanbul shape: one city, four nights", () => {
    const stations = oneCity({ firstDay: "2031-05-02", lastDay: "2031-05-05" });
    const area = groundArea({ startDay: "2031-05-02", endDay: "2031-05-06" });
    expect(decideAreaKind({ stations, home: noHome(), area }, true)).toBe("roadtrip");
  });

  it("stays timeline stops for the five-hour transit: one day, nothing much happened", () => {
    const stations = oneCity({ firstDay: "2031-05-02", lastDay: "2031-05-02" });
    const area = groundArea({ startDay: "2031-05-02", endDay: "2031-05-02" });
    expect(decideAreaKind({ stations, home: noHome(), area }, true)).toBe("stops");
  });

  it("stays timeline stops for the one-night stop: two nights are the cut", () => {
    const stations = oneCity({ firstDay: "2031-05-02", lastDay: "2031-05-03" });
    const area = groundArea({ startDay: "2031-05-02", endDay: "2031-05-03" });
    expect(decideAreaKind({ stations, home: noHome(), area }, true)).toBe("stops");
  });

  it("stays timeline stops when the long window holds only one day of photos", () => {
    const stations = oneCity({ firstDay: "2031-05-02", lastDay: "2031-05-02" });
    const area = groundArea({ startDay: "2031-05-02", endDay: "2031-05-09" });
    expect(decideAreaKind({ stations, home: noHome(), area }, true)).toBe("stops");
  });

  it("keeps the account's own answer: roadtrips hidden makes even a stay a stop", () => {
    const stations = oneCity({ firstDay: "2031-05-02", lastDay: "2031-05-05" });
    const area = groundArea({ startDay: "2031-05-02", endDay: "2031-05-06" });
    expect(decideAreaKind({ stations, home: noHome(), area }, false)).toBe("stops");
  });

  it("is a roadtrip for a two-city drive of one day, as before", () => {
    const stations = [station("n1"), station("p1", { title: "Port Carrow" })];
    const area = groundArea({ startDay: "2031-05-02", endDay: "2031-05-02" });
    expect(decideAreaKind({ stations, home: noHome(), area }, true)).toBe("roadtrip");
  });

  it("stays a stop for an area that is only the way home, however long", () => {
    const stations = [station("h1", { kind: "home", title: "Kelmore" })];
    const area = groundArea({ startDay: "2031-05-02", endDay: "2031-05-09" });
    expect(decideAreaKind({ stations, home: homeLegs(), area }, true)).toBe("stops");
  });
});
