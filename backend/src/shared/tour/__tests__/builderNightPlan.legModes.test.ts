import {
  deriveStationRows,
  NIGHT_UNKNOWN,
  rowLegModes,
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
  lastDay: "2031-05-04",
};
const PORT_CARROW: NightPlanStation = {
  key: "-888|3425|2031-05-05",
  title: "Port Carrow",
  lat: -44.4,
  lon: 171.25,
  firstDay: "2031-05-05",
  lastDay: "2031-05-06",
};
const ELMSTEAD: NightPlanStation = {
  key: "-890|3401|2031-05-07",
  title: "Elmstead",
  lat: -44.5,
  lon: 170.05,
  firstDay: "2031-05-07",
  lastDay: "2031-05-08",
};
const KEYS = [NORTHVALE.key, PORT_CARROW.key, ELMSTEAD.key];

function row(stationKey: string, key = stationKey): StationRow {
  return {
    key,
    stationKey,
    title: stationKey,
    lat: 0,
    lon: 0,
    startDate: "2031-05-02",
    endDate: "2031-05-03",
    slept: true,
  };
}

describe("rowLegModes", () => {
  it("has one mode fewer than there are rows, and none for fewer than two rows", () => {
    expect(rowLegModes(KEYS, ["road", "ferry"], [])).toEqual([]);
    expect(rowLegModes(KEYS, ["road", "ferry"], [row(NORTHVALE.key)])).toEqual([]);
    const three = [row(NORTHVALE.key), row(PORT_CARROW.key), row(ELMSTEAD.key)];
    expect(rowLegModes(KEYS, ["road", "ferry"], three)).toHaveLength(2);
  });

  it("gives each pair of rows the mode of the draft leg that joins their stations", () => {
    const three = [row(NORTHVALE.key), row(PORT_CARROW.key), row(ELMSTEAD.key)];
    expect(rowLegModes(KEYS, ["road", "ferry"], three)).toEqual(["road", "ferry"]);
    expect(rowLegModes(KEYS, ["ferry", "road"], three)).toEqual(["ferry", "road"]);
  });

  it("joins the rows of one split station by road", () => {
    // Northvale slept the 2nd and the 4th with an unknown night between: two
    // rows, then Port Carrow. The ferry belongs to the Northvale → Port Carrow leg.
    const nights = {
      "2031-05-02": NORTHVALE.key,
      "2031-05-03": NIGHT_UNKNOWN,
      "2031-05-04": NORTHVALE.key,
      "2031-05-05": PORT_CARROW.key,
    };
    const rows = deriveStationRows([NORTHVALE, PORT_CARROW], nights);
    expect(rows.map((r) => r.key)).toEqual([NORTHVALE.key, `${NORTHVALE.key}@2`, PORT_CARROW.key]);
    expect(rowLegModes([NORTHVALE.key, PORT_CARROW.key], ["ferry"], rows)).toEqual([
      "road",
      "ferry",
    ]);
  });

  it("uses road for a pair of stations no draft leg joins", () => {
    // Elmstead was deleted from the draft's legs: Northvale → Elmstead is not a leg.
    const rows = [row(NORTHVALE.key), row(ELMSTEAD.key)];
    expect(rowLegModes([NORTHVALE.key, PORT_CARROW.key], ["ferry"], rows)).toEqual(["road"]);
  });

  it("uses road when the draft has no mode for the leg", () => {
    const rows = [row(NORTHVALE.key), row(PORT_CARROW.key)];
    expect(rowLegModes(KEYS, [], rows)).toEqual(["road"]);
  });
});
