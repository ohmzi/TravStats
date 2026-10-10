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

function check(
  nights: Record<string, string>,
  over: { stations?: NightPlanStation[]; areas?: NightPlanArea[] } = {}
): NightPlanError[] {
  return validateNightPlan(
    over.stations ?? [NORTHVALE, PORT_CARROW],
    nights,
    over.areas ?? [AREA],
    WINDOW
  );
}

describe("validateNightPlan", () => {
  it("accepts a plan whose nights sit next to the photos of the stations they name", () => {
    const nights = {
      "2031-05-02": NORTHVALE.key,
      "2031-05-03": NORTHVALE.key,
      "2031-05-04": PORT_CARROW.key,
      "2031-05-05": PORT_CARROW.key,
    };
    expect(check(nights)).toEqual([]);
  });

  it("accepts home, unknown and flight on any night, and an empty plan", () => {
    const nights = {
      "2031-05-02": NIGHT_HOME,
      "2031-05-03": NIGHT_UNKNOWN,
      "2031-05-04": NIGHT_FLIGHT,
    };
    expect(check(nights)).toEqual([]);
    expect(check({})).toEqual([]);
  });

  it("accepts the evening after a station's last day and the night before its first", () => {
    expect(check({ "2031-05-04": NORTHVALE.key })).toEqual([]);
    expect(check({ "2031-05-03": PORT_CARROW.key })).toEqual([]);
  });

  it("refuses two stations with one key", () => {
    const twin: NightPlanStation = { ...NORTHVALE, title: "Northvale again" };
    expect(check({}, { stations: [NORTHVALE, PORT_CARROW, twin] })).toEqual([
      { code: "duplicateStation", stationKey: NORTHVALE.key, day: null },
    ]);
  });

  it("refuses a night that is not one of S … E−1, named by a word or by a station", () => {
    expect(check({ "2031-05-06": NIGHT_HOME })).toEqual([
      { code: "nightOutsideWindow", stationKey: null, day: "2031-05-06" },
    ]);
    // A slept row on the last day also leaves [S, E]: the row check says so too.
    expect(check({ "2031-05-06": PORT_CARROW.key })).toEqual([
      { code: "nightOutsideWindow", stationKey: PORT_CARROW.key, day: "2031-05-06" },
      { code: "sleptRowOutsideWindow", stationKey: PORT_CARROW.key, day: "2031-05-07" },
    ]);
    expect(check({ "2031-05-01": NORTHVALE.key })).toEqual([
      { code: "nightOutsideWindow", stationKey: NORTHVALE.key, day: "2031-05-01" },
      { code: "sleptRowOutsideWindow", stationKey: NORTHVALE.key, day: "2031-05-01" },
    ]);
  });

  it("refuses an answer that is neither a station of the draft nor a word", () => {
    expect(check({ "2031-05-03": NOWHERE })).toEqual([
      { code: "unknownStation", stationKey: NOWHERE, day: "2031-05-03" },
    ]);
  });

  it("refuses a night after the end of the area that holds the station", () => {
    const short: NightPlanArea = { ...AREA, endDay: "2031-05-03" };
    expect(check({ "2031-05-04": NORTHVALE.key }, { areas: [short] })).toEqual([
      { code: "nightOutsideArea", stationKey: NORTHVALE.key, day: "2031-05-04" },
    ]);
  });

  it("refuses a night more than one day before the start of the area", () => {
    const late: NightPlanArea = { ...AREA, startDay: "2031-05-04" };
    // Port Carrow's first photo day is the 4th: the 2nd is outside the area
    // (it starts on the 3rd at the earliest) and not next to the photos.
    expect(check({ "2031-05-02": PORT_CARROW.key }, { areas: [late] })).toEqual([
      { code: "nightOutsideArea", stationKey: PORT_CARROW.key, day: "2031-05-02" },
      { code: "nightNotAdjacent", stationKey: PORT_CARROW.key, day: "2031-05-02" },
    ]);
  });

  it("accepts a night on the area's last day and one on the day before its first", () => {
    // The area's reach is [start − 1, end], both ends included.
    const tight: NightPlanArea = { ...AREA, startDay: "2031-05-04", endDay: "2031-05-04" };
    expect(check({ "2031-05-04": NORTHVALE.key }, { areas: [tight] })).toEqual([]);
    expect(check({ "2031-05-03": PORT_CARROW.key }, { areas: [tight] })).toEqual([]);
  });

  it("refuses a night for a station that belongs to no area", () => {
    expect(check({ "2031-05-03": NORTHVALE.key }, { areas: [] })).toEqual([
      { code: "nightOutsideArea", stationKey: NORTHVALE.key, day: "2031-05-03" },
    ]);
  });

  it("refuses a night that would stretch a station over its neighbours' nights", () => {
    expect(check({ "2031-05-05": NORTHVALE.key })).toEqual([
      { code: "nightNotAdjacent", stationKey: NORTHVALE.key, day: "2031-05-05" },
    ]);
    expect(check({ "2031-05-02": PORT_CARROW.key })).toEqual([
      { code: "nightNotAdjacent", stationKey: PORT_CARROW.key, day: "2031-05-02" },
    ]);
  });

  it("refuses two slept rows that share a night, which only a repeated key can write", () => {
    const twin: NightPlanStation = { ...NORTHVALE, title: "Northvale again" };
    expect(
      check({ "2031-05-02": NORTHVALE.key }, { stations: [NORTHVALE, twin, PORT_CARROW] })
    ).toEqual([
      { code: "duplicateStation", stationKey: NORTHVALE.key, day: null },
      { code: "overlappingSleptRows", stationKey: NORTHVALE.key, day: "2031-05-02" },
    ]);
  });

  it("lists the errors by check, in the contract's order, and by day within a check", () => {
    const nights = {
      "2031-05-09": PORT_CARROW.key,
      "2031-05-03": NOWHERE,
      "2031-05-02": "-2|-2|2031-05-02",
    };
    expect(check(nights).map((e) => [e.code, e.day])).toEqual([
      ["nightOutsideWindow", "2031-05-09"],
      ["unknownStation", "2031-05-02"],
      ["unknownStation", "2031-05-03"],
      ["sleptRowOutsideWindow", "2031-05-10"],
    ]);
  });
});
