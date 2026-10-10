import { applyDayPulls, attributeNights } from "../nights";
import {
  area,
  KELMORE,
  KELMORE_AIRPORT,
  KEY_NORTHVALE,
  KEY_EASTMERE,
  nightInputs,
  NORTHVALE,
  NORTHVALE_AIRPORT,
  photo,
  EASTMERE,
  preciseFlight,
  station,
} from "./nightsFixtures";

// Synthetic fixtures only (public repository): invented towns, flight ZZ101, shifted years.

function twoStations() {
  return area({
    startDay: "2031-05-03",
    endDay: "2031-05-05",
    stations: [
      station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-03", "2031-05-03"),
      station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-04", "2031-05-05"),
    ],
    photos: [photo("a1", "2031-05-03 10:00", NORTHVALE), photo("b1", "2031-05-04 10:00", EASTMERE)],
    placeOf: { a1: KEY_NORTHVALE, b1: KEY_EASTMERE },
  }).plan;
}

describe("applyDayPulls", () => {
  it("moves a pulled station's first day, and its area's first day, back to the night", () => {
    const plan = twoStations();

    const [pulled] = applyDayPulls(
      [plan],
      [{ areaKey: plan.key, stationKey: KEY_NORTHVALE, firstDay: "2031-05-02" }]
    );

    expect(pulled.area.startDay).toBe("2031-05-02");
    expect(pulled.stations.map((s) => s.firstDay)).toEqual(["2031-05-02", "2031-05-04"]);
    // Everything else about the area is as it was.
    expect(pulled.area.endDay).toBe("2031-05-05");
    expect(pulled.photoStation).toBe(plan.photoStation);
  });

  it("leaves the input plans as they were and returns an untouched plan as it is", () => {
    const plan = twoStations();
    const other = area({
      startDay: "2031-05-10",
      endDay: "2031-05-10",
      stations: [],
      photos: [photo("h1", "2031-05-10 10:00", KELMORE)],
      placeOf: { h1: "home" },
    }).plan;

    const [pulled, untouched] = applyDayPulls(
      [plan, other],
      [{ areaKey: plan.key, stationKey: KEY_NORTHVALE, firstDay: "2031-05-02" }]
    );

    expect(plan.area.startDay).toBe("2031-05-03");
    expect(plan.stations[0].firstDay).toBe("2031-05-03");
    expect(pulled).not.toBe(plan);
    expect(untouched).toBe(other);
  });

  it("takes the earliest of several pulls and never moves a first day later", () => {
    const plan = twoStations();

    const [pulled] = applyDayPulls(
      [plan],
      [
        { areaKey: plan.key, stationKey: KEY_EASTMERE, firstDay: "2031-05-03" },
        { areaKey: plan.key, stationKey: KEY_EASTMERE, firstDay: "2031-05-02" },
        { areaKey: plan.key, stationKey: KEY_NORTHVALE, firstDay: "2031-05-09" },
      ]
    );

    expect(pulled.stations.map((s) => s.firstDay)).toEqual(["2031-05-03", "2031-05-02"]);
    expect(pulled.area.startDay).toBe("2031-05-02");
  });

  it("ignores a pull for an area or a station it does not know", () => {
    const plan = twoStations();

    const [same] = applyDayPulls(
      [plan],
      [
        { areaKey: "2031-05-09#1", stationKey: KEY_NORTHVALE, firstDay: "2031-05-01" },
        { areaKey: plan.key, stationKey: "-1|-1|2031-05-01", firstDay: "2031-05-01" },
      ]
    );

    expect(same.stations.map((s) => s.firstDay)).toEqual(["2031-05-03", "2031-05-04"]);
    expect(same.area.startDay).toBe("2031-05-03");
  });

  it("applies what attributeNights pulled for an evening departure from home", () => {
    const athome = area({
      startDay: "2031-05-02",
      endDay: "2031-05-02",
      stations: [],
      photos: [photo("h1", "2031-05-02 17:30", KELMORE)],
      placeOf: { h1: "home" },
      beforeFlightId: "f1",
    });
    const away = area({
      startDay: "2031-05-03",
      endDay: "2031-05-04",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-03", "2031-05-04")],
      photos: [
        photo("a1", "2031-05-03 09:00", NORTHVALE),
        photo("a2", "2031-05-04 10:00", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
      afterFlightId: "f1",
    });
    const out = preciseFlight("f1", "2031-05-02 19:00", "2031-05-02 22:30", {
      dep: KELMORE_AIRPORT,
      arr: NORTHVALE_AIRPORT,
    });
    const inputs = nightInputs("2031-05-02", "2031-05-05", [athome, away], { anchors: [out] });

    const { pulls } = attributeNights(inputs);
    const [, pulled] = applyDayPulls(inputs.areas, pulls);

    expect(pulled.area.startDay).toBe("2031-05-02");
    expect(pulled.stations[0].firstDay).toBe("2031-05-02");
  });
});
