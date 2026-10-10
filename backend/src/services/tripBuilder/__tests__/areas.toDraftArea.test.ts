import { toDraftArea } from "../areas";
import type { PlanLeg } from "../types";
import { groundArea, noHome, planOf, station } from "./planFixtures";

const leg = (fromKey: string, toKey: string): PlanLeg => ({
  fromKey,
  toKey,
  chordKm: 52.7,
  routedKm: null,
  mode: "road",
  ferryEvidence: null,
});

describe("toDraftArea", () => {
  const stations = [station("n1"), station("p1", { title: "Port Carrow" })];

  it("carries the plan's span, stations, legs and home, with the name and main city given", () => {
    const plan = planOf(stations, {
      legs: [leg("n1", "p1")],
      area: groundArea({ startDay: "2031-05-02", endDay: "2031-05-06" }),
    });
    const draft = toDraftArea(plan, "roadtrip", "Southern loop", "Northvale");
    expect(draft).toEqual({
      key: "2031-05-02#1",
      defaultAs: "roadtrip",
      suggestedName: "Southern loop",
      mainCity: "Northvale",
      startDay: "2031-05-02",
      endDay: "2031-05-06",
      home: noHome(),
      stations,
      legs: [leg("n1", "p1")],
    });
    expect(Object.keys(draft)).not.toContain("afterFlightId");
    expect(Object.keys(draft)).not.toContain("beforeFlightId");
  });

  it("names the flights on either side of the area", () => {
    const plan = planOf(stations, {
      legs: [leg("n1", "p1")],
      area: groundArea({ afterFlightId: "f1", beforeFlightId: "f2" }),
    });
    expect(toDraftArea(plan, "stops", "Southern loop", null)).toMatchObject({
      defaultAs: "stops",
      mainCity: null,
      afterFlightId: "f1",
      beforeFlightId: "f2",
    });
  });

  it("refuses legs that do not join the stations", () => {
    expect(() => toDraftArea(planOf(stations), "roadtrip", "Southern loop", null)).toThrow(
      "Area 2031-05-02#1 has 0 legs for 2 stations"
    );
  });

  it("accepts an area with one station and no legs, or none at all", () => {
    expect(toDraftArea(planOf([station("n1")]), "stops", "Southern loop", null).legs).toEqual([]);
    expect(toDraftArea(planOf([]), "stops", "Southern loop", null).stations).toEqual([]);
  });
});
