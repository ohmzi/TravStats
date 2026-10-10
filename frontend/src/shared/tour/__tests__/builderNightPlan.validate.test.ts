import { describe, expect, it } from "vitest";

import {
  NIGHT_FLIGHT,
  NIGHT_HOME,
  NIGHT_UNKNOWN,
  validateNightPlan,
  type NightPlanArea,
  type NightPlanError,
  type NightPlanStation,
} from "../builderNightPlan";

// Synthetic fixtures only (public repository): invented places, shifted years.
const NORTHVALE: NightPlanStation = {
  key: "-901|3374|2031-05-02",
  title: "Northvale",
  lat: -45.05,
  lon: 168.7,
  firstDay: "2031-05-02",
  lastDay: "2031-05-03",
};
const PORT_CARROW: NightPlanStation = {
  key: "-888|3425|2031-05-04",
  title: "Port Carrow",
  lat: -44.4,
  lon: 171.25,
  firstDay: "2031-05-04",
  lastDay: "2031-05-06",
};
const NOWHERE = "-1|-1|2031-05-03";
// Nights 2031-05-02 … 2031-05-05.
const WINDOW = { startDay: "2031-05-02", endDay: "2031-05-06" };
const AREA: NightPlanArea = {
  key: "2031-05-02#1",
  startDay: "2031-05-02",
  endDay: "2031-05-06",
  stationKeys: [NORTHVALE.key, PORT_CARROW.key],
};
const TWIN: NightPlanStation = { ...NORTHVALE, title: "Northvale again" };

interface Case {
  name: string;
  nights: Record<string, string>;
  stations?: NightPlanStation[];
  areas?: NightPlanArea[];
  expected: NightPlanError[];
}

const CASES: Case[] = [
  {
    name: "accepts nights next to the photos of the stations they name",
    nights: {
      "2031-05-02": NORTHVALE.key,
      "2031-05-03": NORTHVALE.key,
      "2031-05-04": PORT_CARROW.key,
      "2031-05-05": PORT_CARROW.key,
    },
    expected: [],
  },
  {
    name: "accepts home, unknown and flight on any night, and an empty plan",
    nights: {
      "2031-05-02": NIGHT_HOME,
      "2031-05-03": NIGHT_UNKNOWN,
      "2031-05-04": NIGHT_FLIGHT,
    },
    expected: [],
  },
  {
    name: "accepts the evening after a station's last day and the night before its first",
    nights: { "2031-05-04": NORTHVALE.key, "2031-05-03": PORT_CARROW.key },
    expected: [],
  },
  {
    name: "refuses two stations with one key",
    nights: {},
    stations: [NORTHVALE, PORT_CARROW, TWIN],
    expected: [{ code: "duplicateStation", stationKey: NORTHVALE.key, day: null }],
  },
  {
    name: "refuses a night that is not one of S … E−1",
    nights: { "2031-05-06": PORT_CARROW.key },
    expected: [
      { code: "nightOutsideWindow", stationKey: PORT_CARROW.key, day: "2031-05-06" },
      { code: "sleptRowOutsideWindow", stationKey: PORT_CARROW.key, day: "2031-05-07" },
    ],
  },
  {
    name: "refuses a slept row that starts before S",
    nights: { "2031-05-01": NORTHVALE.key },
    expected: [
      { code: "nightOutsideWindow", stationKey: NORTHVALE.key, day: "2031-05-01" },
      { code: "sleptRowOutsideWindow", stationKey: NORTHVALE.key, day: "2031-05-01" },
    ],
  },
  {
    name: "refuses an answer that is neither a station of the draft nor a word",
    nights: { "2031-05-03": NOWHERE },
    expected: [{ code: "unknownStation", stationKey: NOWHERE, day: "2031-05-03" }],
  },
  {
    name: "refuses a night after the end of the area that holds the station",
    nights: { "2031-05-04": NORTHVALE.key },
    areas: [{ ...AREA, endDay: "2031-05-03" }],
    expected: [{ code: "nightOutsideArea", stationKey: NORTHVALE.key, day: "2031-05-04" }],
  },
  {
    name: "refuses a night more than one day before the start of the area",
    nights: { "2031-05-02": PORT_CARROW.key },
    areas: [{ ...AREA, startDay: "2031-05-04" }],
    expected: [
      { code: "nightOutsideArea", stationKey: PORT_CARROW.key, day: "2031-05-02" },
      { code: "nightNotAdjacent", stationKey: PORT_CARROW.key, day: "2031-05-02" },
    ],
  },
  {
    name: "accepts a night on the area's last day and one on the day before its first",
    nights: { "2031-05-04": NORTHVALE.key, "2031-05-03": PORT_CARROW.key },
    areas: [{ ...AREA, startDay: "2031-05-04", endDay: "2031-05-04" }],
    expected: [],
  },
  {
    name: "refuses a night for a station that belongs to no area",
    nights: { "2031-05-03": NORTHVALE.key },
    areas: [],
    expected: [{ code: "nightOutsideArea", stationKey: NORTHVALE.key, day: "2031-05-03" }],
  },
  {
    name: "refuses a night that would stretch a station over its neighbours' nights",
    nights: { "2031-05-05": NORTHVALE.key, "2031-05-02": PORT_CARROW.key },
    expected: [
      { code: "nightNotAdjacent", stationKey: PORT_CARROW.key, day: "2031-05-02" },
      { code: "nightNotAdjacent", stationKey: NORTHVALE.key, day: "2031-05-05" },
    ],
  },
  {
    name: "refuses two slept rows that share a night, which only a repeated key can write",
    nights: { "2031-05-02": NORTHVALE.key },
    stations: [NORTHVALE, TWIN, PORT_CARROW],
    expected: [
      { code: "duplicateStation", stationKey: NORTHVALE.key, day: null },
      { code: "overlappingSleptRows", stationKey: NORTHVALE.key, day: "2031-05-02" },
    ],
  },
  {
    name: "lists the errors by check, then by day within a check",
    nights: {
      "2031-05-09": PORT_CARROW.key,
      "2031-05-03": NOWHERE,
      "2031-05-02": "-2|-2|2031-05-02",
    },
    expected: [
      { code: "nightOutsideWindow", stationKey: PORT_CARROW.key, day: "2031-05-09" },
      { code: "unknownStation", stationKey: "-2|-2|2031-05-02", day: "2031-05-02" },
      { code: "unknownStation", stationKey: NOWHERE, day: "2031-05-03" },
      { code: "sleptRowOutsideWindow", stationKey: PORT_CARROW.key, day: "2031-05-10" },
    ],
  },
];

describe("validateNightPlan", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const errors = validateNightPlan(
        c.stations ?? [NORTHVALE, PORT_CARROW],
        c.nights,
        c.areas ?? [AREA],
        WINDOW
      );
      expect(errors).toEqual(c.expected);
    });
  }

  it("accepts an empty plan", () => {
    expect(validateNightPlan([NORTHVALE, PORT_CARROW], {}, [AREA], WINDOW)).toEqual([]);
  });

  // The nights come from the request body, so a day key can be anything.
  const NOT_DAYS = ["garbage", "2031-13-45", "2031-02-30", "2031-5-2", "2031-05-02T00:00", ""];

  it("reports a day key that is not a calendar date instead of throwing", () => {
    for (const bad of NOT_DAYS) {
      const errors = validateNightPlan(
        [NORTHVALE, PORT_CARROW],
        { [bad]: NORTHVALE.key },
        [AREA],
        WINDOW
      );
      expect(errors).toEqual([{ code: "nightOutsideWindow", stationKey: NORTHVALE.key, day: bad }]);
    }
  });

  it("writes no row for a malformed day key and still checks the real nights beside it", () => {
    const nights = {
      "2031-05-02": NORTHVALE.key,
      "2031-13-45": NORTHVALE.key,
      "2031-05-03": NORTHVALE.key,
      "2031-05-05": NORTHVALE.key,
    };
    expect(validateNightPlan([NORTHVALE, PORT_CARROW], nights, [AREA], WINDOW)).toEqual([
      { code: "nightOutsideWindow", stationKey: NORTHVALE.key, day: "2031-13-45" },
      { code: "nightNotAdjacent", stationKey: NORTHVALE.key, day: "2031-05-05" },
    ]);
  });
});
