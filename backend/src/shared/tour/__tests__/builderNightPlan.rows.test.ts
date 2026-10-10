import { countRoadtripNights, type CountableStation } from "../roadtrip";
import {
  deriveStationRows,
  NIGHT_FLIGHT,
  NIGHT_HOME,
  NIGHT_UNKNOWN,
  type NightPlanStation,
  type StationRow,
} from "../builderNightPlan";

// Synthetic fixtures only (public repository): invented places, shifted years.
const NORTHVALE: NightPlanStation = {
  key: "-901|3374|2031-05-02",
  title: "Northvale",
  lat: -45.05,
  lon: 168.7,
  firstDay: "2031-05-02",
  lastDay: "2031-05-03",
  notes: "First photo 08:10 · last photo 19:40 · 31 photos",
};
const PORT_CARROW: NightPlanStation = {
  key: "-888|3425|2031-05-04",
  title: "Port Carrow",
  lat: -44.4,
  lon: 171.25,
  firstDay: "2031-05-04",
  lastDay: "2031-05-05",
};
const KELMORE_HOME: NightPlanStation = {
  key: "-871|3453|2031-05-02",
  title: "Kelmore",
  lat: -43.53,
  lon: 172.64,
  firstDay: "2031-05-02",
  lastDay: "2031-05-02",
};

describe("deriveStationRows", () => {
  it("gives a station with no night one pass row from its first to its last day", () => {
    expect(deriveStationRows([PORT_CARROW], {})).toEqual([
      {
        key: PORT_CARROW.key,
        stationKey: PORT_CARROW.key,
        title: "Port Carrow",
        lat: -44.4,
        lon: 171.25,
        startDate: "2031-05-04",
        endDate: "2031-05-05",
        slept: false,
      },
    ]);
  });

  it("gives a slept station one row from its first night to its last night plus one", () => {
    const nights = { "2031-05-02": NORTHVALE.key, "2031-05-03": NORTHVALE.key };
    expect(deriveStationRows([NORTHVALE], nights)).toEqual([
      {
        key: NORTHVALE.key,
        stationKey: NORTHVALE.key,
        title: "Northvale",
        lat: -45.05,
        lon: 168.7,
        startDate: "2031-05-02",
        endDate: "2031-05-04",
        slept: true,
        notes: "First photo 08:10 · last photo 19:40 · 31 photos",
      },
    ]);
  });

  it("starts a slept row at its first night, not at its first photo day", () => {
    // Photos from the 4th, but the first night spent there is the 5th.
    const rows = deriveStationRows([PORT_CARROW], { "2031-05-05": PORT_CARROW.key });
    expect([rows[0].startDate, rows[0].endDate]).toEqual(["2031-05-05", "2031-05-06"]);
  });

  it("splits a station's nights into one row per run and keys the later ones @2, @3", () => {
    const nights = {
      "2031-05-02": NORTHVALE.key,
      "2031-05-04": NORTHVALE.key,
      "2031-05-05": NORTHVALE.key,
      "2031-05-07": NORTHVALE.key,
    };
    const rows = deriveStationRows([NORTHVALE], nights);
    expect(rows.map((r) => [r.key, r.startDate, r.endDate, r.slept])).toEqual([
      [NORTHVALE.key, "2031-05-02", "2031-05-03", true],
      [`${NORTHVALE.key}@2`, "2031-05-04", "2031-05-06", true],
      [`${NORTHVALE.key}@3`, "2031-05-07", "2031-05-08", true],
    ]);
    expect(rows.map((r) => r.stationKey)).toEqual([NORTHVALE.key, NORTHVALE.key, NORTHVALE.key]);
    expect(rows.every((r) => r.lat === -45.05 && r.lon === 168.7 && r.title === "Northvale")).toBe(
      true
    );
  });

  it("ignores the nights spent at home, unknown or in the air", () => {
    const nights = {
      "2031-05-02": NIGHT_HOME,
      "2031-05-03": NIGHT_UNKNOWN,
      "2031-05-04": NIGHT_FLIGHT,
    };
    const rows = deriveStationRows([NORTHVALE, PORT_CARROW], nights);
    expect(rows.map((r) => r.slept)).toEqual([false, false]);
  });

  it("orders rows by start day, then by the stations' order", () => {
    // The home pass station and Northvale both begin on the 2nd; the home
    // station comes first in travel order, so it comes first here.
    const nights = { "2031-05-02": NORTHVALE.key, "2031-05-04": PORT_CARROW.key };
    const rows = deriveStationRows([KELMORE_HOME, NORTHVALE, PORT_CARROW], nights);
    expect(rows.map((r) => r.stationKey)).toEqual([
      KELMORE_HOME.key,
      NORTHVALE.key,
      PORT_CARROW.key,
    ]);
  });

  it("keeps a revisited station's rows in the order the nights happened", () => {
    // Northvale, then Port Carrow, then Northvale again: three rows by date.
    const nights = {
      "2031-05-02": NORTHVALE.key,
      "2031-05-03": PORT_CARROW.key,
      "2031-05-04": NORTHVALE.key,
    };
    const rows = deriveStationRows([NORTHVALE, PORT_CARROW], nights);
    expect(rows.map((r) => r.key)).toEqual([NORTHVALE.key, PORT_CARROW.key, `${NORTHVALE.key}@2`]);
  });
});

/** The stored form `countRoadtripNights` reads: UTC-midnight day anchors, no linked stay. */
function asCountable(rows: readonly StationRow[]): CountableStation[] {
  return rows.map((row) => ({
    lodgingStayId: null,
    overnight: row.slept,
    startDate: new Date(`${row.startDate}T00:00:00Z`),
    endDate: new Date(`${row.endDate}T00:00:00Z`),
    stay: null,
  }));
}

describe("deriveStationRows against countRoadtripNights", () => {
  const DAYS = ["2031-05-02", "2031-05-03", "2031-05-04", "2031-05-05"];
  const ANSWERS = [NORTHVALE.key, PORT_CARROW.key, NIGHT_HOME, NIGHT_UNKNOWN, NIGHT_FLIGHT];

  it("counts exactly the nights that were given to a station, for every possible plan", () => {
    // 5 answers over 4 nights: all 625 plans, so a run split or a run end
    // that is off by one cannot hide in a hand-picked case.
    let plans = 0;
    for (let code = 0; code < ANSWERS.length ** DAYS.length; code++) {
      const nights: Record<string, string> = {};
      DAYS.forEach((day, i) => {
        nights[day] = ANSWERS[Math.floor(code / ANSWERS.length ** i) % ANSWERS.length];
      });
      const given = DAYS.filter(
        (day) => nights[day] === NORTHVALE.key || nights[day] === PORT_CARROW.key
      ).length;
      const counted = countRoadtripNights(
        asCountable(deriveStationRows([NORTHVALE, PORT_CARROW], nights))
      );
      if (counted.freeNights !== given || counted.nights !== given) {
        throw new Error(
          `plan ${JSON.stringify(nights)}: counted ${counted.nights}, given ${given}`
        );
      }
      plans++;
    }
    expect(plans).toBe(625);
  });

  it("counts a split station's nights once per night, not once per row", () => {
    const nights = {
      "2031-05-02": NORTHVALE.key,
      "2031-05-03": NIGHT_UNKNOWN,
      "2031-05-04": NORTHVALE.key,
      "2031-05-05": NORTHVALE.key,
    };
    const rows = deriveStationRows([NORTHVALE], nights);
    expect(rows).toHaveLength(2);
    const counted = countRoadtripNights(asCountable(rows));
    expect(counted.nights).toBe(3);
    expect(counted.placesSlept).toBe(2);
  });

  it("counts none of a pass station's days", () => {
    const counted = countRoadtripNights(asCountable(deriveStationRows([KELMORE_HOME], {})));
    expect(counted.nights).toBe(0);
  });
});
