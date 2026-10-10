import { attributeNights } from "../nights";
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

describe("attributeNights: a flight that lands after the night's last photo", () => {
  it("gives the evening flight home on E−1 to home", () => {
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-05",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-05")],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("a2", "2031-05-03 10:00", NORTHVALE),
        photo("a3", "2031-05-04 10:00", NORTHVALE),
        photo("a4", "2031-05-05 14:30", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE, a3: KEY_NORTHVALE, a4: KEY_NORTHVALE },
      beforeFlightId: "f1",
    });
    const home = preciseFlight("f1", "2031-05-05 18:00", "2031-05-05 22:10", {
      dep: NORTHVALE_AIRPORT,
      arr: KELMORE_AIRPORT,
    });

    const { nights, pulls } = attributeNights(
      nightInputs("2031-05-02", "2031-05-06", [trip], { anchors: [home] })
    );

    expect(nights["2031-05-05"]).toEqual({
      assign: "home",
      reason: "afterLanding",
      suggestedStationKeys: [],
    });
    expect(nights["2031-05-04"].assign).toBe(KEY_NORTHVALE);
    expect(pulls).toEqual([]);
  });

  it("gives the night of an evening departure from home on S to the first station it reaches", () => {
    const athome = area({
      startDay: "2031-05-02",
      endDay: "2031-05-02",
      stations: [],
      photos: [photo("h1", "2031-05-02 08:00", KELMORE), photo("h2", "2031-05-02 17:30", KELMORE)],
      placeOf: { h1: "home", h2: "home" },
      beforeFlightId: "f1",
    });
    const away = area({
      startDay: "2031-05-03",
      endDay: "2031-05-04",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-03", "2031-05-04")],
      photos: [
        photo("a1", "2031-05-03 09:00", NORTHVALE),
        photo("a2", "2031-05-03 20:00", NORTHVALE),
        photo("a3", "2031-05-04 10:00", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE, a3: KEY_NORTHVALE },
      afterFlightId: "f1",
    });
    const out = preciseFlight("f1", "2031-05-02 19:00", "2031-05-02 22:30", {
      dep: KELMORE_AIRPORT,
      arr: NORTHVALE_AIRPORT,
    });

    const { nights, pulls } = attributeNights(
      nightInputs("2031-05-02", "2031-05-05", [athome, away], { anchors: [out] })
    );

    expect(nights["2031-05-02"]).toEqual({
      assign: KEY_NORTHVALE,
      reason: "afterLanding",
      suggestedStationKeys: [],
    });
    expect(pulls).toEqual([
      { areaKey: "2031-05-03#1", stationKey: KEY_NORTHVALE, firstDay: "2031-05-02" },
    ]);
  });

  it("gives the night between two areas linked by an evening flight to the second area", () => {
    const first = area({
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-03")],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("a2", "2031-05-03 15:00", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
      beforeFlightId: "f1",
    });
    const second = area({
      startDay: "2031-05-04",
      endDay: "2031-05-05",
      stations: [station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-04", "2031-05-05")],
      photos: [
        photo("b1", "2031-05-04 08:30", EASTMERE),
        photo("b2", "2031-05-05 16:00", EASTMERE),
      ],
      placeOf: { b1: KEY_EASTMERE, b2: KEY_EASTMERE },
      afterFlightId: "f1",
    });
    const hop = preciseFlight("f1", "2031-05-03 19:30", "2031-05-03 21:00", {
      dep: NORTHVALE_AIRPORT,
      arr: EASTMERE,
    });

    const { nights, pulls } = attributeNights(
      nightInputs("2031-05-02", "2031-05-06", [first, second], { anchors: [hop] })
    );

    expect([nights["2031-05-02"].assign, nights["2031-05-03"].assign]).toEqual([
      KEY_NORTHVALE,
      KEY_EASTMERE,
    ]);
    expect(nights["2031-05-03"].reason).toBe("afterLanding");
    expect(pulls).toEqual([
      { areaKey: "2031-05-04#1", stationKey: KEY_EASTMERE, firstDay: "2031-05-03" },
    ]);
  });

  it("steps aside when a photo was taken after the landing, in the area the flight opens", () => {
    const first = area({
      startDay: "2031-05-02",
      endDay: "2031-05-02",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02")],
      photos: [photo("a1", "2031-05-02 05:30", NORTHVALE)],
      placeOf: { a1: KEY_NORTHVALE },
      beforeFlightId: "f1",
    });
    const second = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      key: "2031-05-02#2",
      stations: [station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-02", "2031-05-04")],
      photos: [
        photo("b1", "2031-05-02 10:30", EASTMERE),
        photo("b2", "2031-05-02 21:00", EASTMERE),
      ],
      placeOf: { b1: KEY_EASTMERE, b2: KEY_EASTMERE },
      afterFlightId: "f1",
    });
    const morning = preciseFlight("f1", "2031-05-02 07:00", "2031-05-02 09:00", {
      dep: NORTHVALE_AIRPORT,
      arr: EASTMERE,
    });

    const { nights, pulls } = attributeNights(
      nightInputs("2031-05-02", "2031-05-03", [first, second], { anchors: [morning] })
    );

    expect(nights["2031-05-02"].reason).toBe("lastPhoto");
    expect(nights["2031-05-02"].assign).toBe(KEY_EASTMERE);
    expect(pulls).toEqual([]);
  });

  it("counts a landing before 04:00 in the night that is ending", () => {
    const first = area({
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-03")],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("a2", "2031-05-03 22:00", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
      beforeFlightId: "f1",
    });
    const second = area({
      startDay: "2031-05-04",
      endDay: "2031-05-05",
      stations: [station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-04", "2031-05-05")],
      photos: [
        photo("b1", "2031-05-04 09:00", EASTMERE),
        photo("b2", "2031-05-04 20:00", EASTMERE),
      ],
      placeOf: { b1: KEY_EASTMERE, b2: KEY_EASTMERE },
      afterFlightId: "f1",
    });
    // Takes off at 00:30 and lands at 02:10 on the 4th: it does not cross midnight,
    // but the landing belongs to the night of the 3rd.
    const small = preciseFlight("f1", "2031-05-04 00:30", "2031-05-04 02:10", {
      dep: NORTHVALE_AIRPORT,
      arr: EASTMERE,
    });

    const { nights, pulls } = attributeNights(
      nightInputs("2031-05-02", "2031-05-05", [first, second], { anchors: [small] })
    );

    expect(nights["2031-05-03"].assign).toBe(KEY_EASTMERE);
    expect(nights["2031-05-03"].reason).toBe("afterLanding");
    expect(nights["2031-05-04"].reason).toBe("lastPhoto");
    expect(pulls).toEqual([
      { areaKey: "2031-05-04#1", stationKey: KEY_EASTMERE, firstDay: "2031-05-03" },
    ]);
  });

  it("goes by the last landing when two flights land in one night", () => {
    const hop = area({
      startDay: "2031-05-02",
      endDay: "2031-05-02",
      stations: [station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-02", "2031-05-02")],
      photos: [
        photo("b1", "2031-05-02 12:30", EASTMERE),
        photo("b2", "2031-05-02 16:00", EASTMERE),
      ],
      placeOf: { b1: KEY_EASTMERE, b2: KEY_EASTMERE },
      beforeFlightId: "f2",
      afterFlightId: "f1",
    });
    const last = area({
      startDay: "2031-05-03",
      endDay: "2031-05-04",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-03", "2031-05-04")],
      photos: [
        photo("a1", "2031-05-03 09:00", NORTHVALE),
        photo("a2", "2031-05-04 10:00", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
      afterFlightId: "f2",
    });
    const f1 = preciseFlight("f1", "2031-05-02 10:00", "2031-05-02 12:00", {
      dep: KELMORE_AIRPORT,
      arr: EASTMERE,
    });
    const f2 = preciseFlight("f2", "2031-05-02 20:00", "2031-05-02 22:30", {
      dep: EASTMERE,
      arr: NORTHVALE_AIRPORT,
    });

    const { nights } = attributeNights(
      nightInputs("2031-05-02", "2031-05-05", [hop, last], { anchors: [f1, f2] })
    );

    expect(nights["2031-05-02"].assign).toBe(KEY_NORTHVALE);
    expect(nights["2031-05-02"].reason).toBe("afterLanding");
  });

  it("skips an airport or home station at the start of the area it opens", () => {
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
      stations: [
        station(
          "airport-key",
          "Northvale Airport",
          NORTHVALE_AIRPORT,
          "2031-05-03",
          "2031-05-03",
          "airport"
        ),
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-03", "2031-05-04"),
      ],
      photos: [
        photo("a1", "2031-05-03 11:00", NORTHVALE),
        photo("a2", "2031-05-04 10:00", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
      afterFlightId: "f1",
    });
    const out = preciseFlight("f1", "2031-05-02 19:00", "2031-05-02 22:30", {
      dep: KELMORE_AIRPORT,
      arr: NORTHVALE_AIRPORT,
    });

    const { nights } = attributeNights(
      nightInputs("2031-05-02", "2031-05-05", [athome, away], { anchors: [out] })
    );

    expect(nights["2031-05-02"].assign).toBe(KEY_NORTHVALE);
  });

  it("leaves the night unknown when the flight lands away from home and no area follows", () => {
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-03")],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("a2", "2031-05-03 14:00", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
      beforeFlightId: "f1",
    });
    const hop = preciseFlight("f1", "2031-05-03 19:00", "2031-05-03 22:00", {
      dep: NORTHVALE_AIRPORT,
      arr: EASTMERE,
    });

    const { nights, pulls } = attributeNights(
      nightInputs("2031-05-02", "2031-05-05", [trip], { anchors: [hop] })
    );

    expect(nights["2031-05-03"]).toEqual({
      assign: "unknown",
      reason: "unknown",
      suggestedStationKeys: [KEY_NORTHVALE],
    });
    expect(pulls).toEqual([]);
  });

  it("does not call a landing home when the residence is unknown", () => {
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-05",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-05")],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("a2", "2031-05-05 14:30", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
      beforeFlightId: "f1",
    });
    const home = preciseFlight("f1", "2031-05-05 18:00", "2031-05-05 22:10", {
      dep: NORTHVALE_AIRPORT,
      arr: KELMORE_AIRPORT,
    });

    const { nights } = attributeNights(
      nightInputs("2031-05-02", "2031-05-06", [trip], { anchors: [home], home: null })
    );

    expect(nights["2031-05-05"].assign).toBe("unknown");
  });
});
