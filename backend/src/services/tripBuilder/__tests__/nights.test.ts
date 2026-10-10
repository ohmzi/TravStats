import { attributeNights } from "../nights";
import {
  area,
  KEY_NORTHVALE,
  KEY_PORT_CARROW,
  NORTHVALE,
  nightInputs,
  PORT_CARROW,
  photo,
  ROADSIDE,
  station,
} from "./nightsFixtures";

// Synthetic fixtures only (public repository): invented towns, shifted years.

describe("attributeNights: the station of the night's last photo", () => {
  it("answers exactly the nights S … E−1", () => {
    const here = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-04")],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("a2", "2031-05-04 09:00", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
    });

    const { nights, pulls } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [here]));

    expect(Object.keys(nights)).toEqual(["2031-05-02", "2031-05-03"]);
    expect(pulls).toEqual([]);
  });

  it("gives a night to the station of its last photo", () => {
    const here = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-03")],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("a2", "2031-05-02 19:30", NORTHVALE),
        photo("a3", "2031-05-03 09:00", NORTHVALE),
        photo("a4", "2031-05-03 20:15", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE, a3: KEY_NORTHVALE, a4: KEY_NORTHVALE },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [here]));

    expect(nights["2031-05-02"]).toEqual({
      assign: KEY_NORTHVALE,
      reason: "lastPhoto",
      suggestedStationKeys: [],
    });
    expect(nights["2031-05-03"].assign).toBe(KEY_NORTHVALE);
  });

  it("follows the traveller from one station to the next", () => {
    const here = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02"),
        station(KEY_PORT_CARROW, "Port Carrow", PORT_CARROW, "2031-05-03", "2031-05-04"),
      ],
      photos: [
        photo("a1", "2031-05-02 19:30", NORTHVALE),
        photo("b1", "2031-05-03 09:00", PORT_CARROW),
        photo("b2", "2031-05-03 21:00", PORT_CARROW),
      ],
      placeOf: { a1: KEY_NORTHVALE, b1: KEY_PORT_CARROW, b2: KEY_PORT_CARROW },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [here]));

    expect([nights["2031-05-02"].assign, nights["2031-05-03"].assign]).toEqual([
      KEY_NORTHVALE,
      KEY_PORT_CARROW,
    ]);
  });
});

describe("attributeNights: a night with no photo", () => {
  it("is unknown, and suggests the stations on both sides of the gap", () => {
    const here = area({
      startDay: "2031-05-02",
      endDay: "2031-05-05",
      stations: [
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02"),
        station(KEY_PORT_CARROW, "Port Carrow", PORT_CARROW, "2031-05-04", "2031-05-04"),
      ],
      photos: [
        photo("a1", "2031-05-02 19:30", NORTHVALE),
        photo("b1", "2031-05-04 20:00", PORT_CARROW),
      ],
      placeOf: { a1: KEY_NORTHVALE, b1: KEY_PORT_CARROW },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-05", [here]));

    expect(nights["2031-05-03"]).toEqual({
      assign: "unknown",
      reason: "unknown",
      suggestedStationKeys: [KEY_NORTHVALE, KEY_PORT_CARROW],
    });
    // The nights either side of it still have their photos.
    expect([nights["2031-05-02"].assign, nights["2031-05-04"].assign]).toEqual([
      KEY_NORTHVALE,
      KEY_PORT_CARROW,
    ]);
  });

  it("suggests, for each night of a longer gap, only the station it could be given to", () => {
    const here = area({
      startDay: "2031-05-02",
      endDay: "2031-05-06",
      stations: [
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02"),
        station(KEY_PORT_CARROW, "Port Carrow", PORT_CARROW, "2031-05-05", "2031-05-06"),
      ],
      photos: [
        photo("a1", "2031-05-02 19:30", NORTHVALE),
        photo("b1", "2031-05-05 19:00", PORT_CARROW),
      ],
      placeOf: { a1: KEY_NORTHVALE, b1: KEY_PORT_CARROW },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-06", [here]));

    // Northvale's last photo day is the 2nd, so it can have the 3rd and no later night;
    // Port Carrow's first is the 5th, so it can have the 4th and no earlier one.
    expect(nights["2031-05-03"].suggestedStationKeys).toEqual([KEY_NORTHVALE]);
    expect(nights["2031-05-04"].suggestedStationKeys).toEqual([KEY_PORT_CARROW]);
    expect([nights["2031-05-03"].assign, nights["2031-05-04"].assign]).toEqual([
      "unknown",
      "unknown",
    ]);
  });

  it("suggests the one station once when it is on both sides of the gap", () => {
    const here = area({
      startDay: "2031-05-02",
      endDay: "2031-05-06",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-05")],
      photos: [
        photo("a1", "2031-05-02 19:30", NORTHVALE),
        photo("a2", "2031-05-05 19:30", NORTHVALE),
      ],
      placeOf: { a1: KEY_NORTHVALE, a2: KEY_NORTHVALE },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-06", [here]));

    expect(nights["2031-05-03"].suggestedStationKeys).toEqual([KEY_NORTHVALE]);
    expect(nights["2031-05-04"].suggestedStationKeys).toEqual([KEY_NORTHVALE]);
    expect(nights["2031-05-05"].assign).toBe(KEY_NORTHVALE);
  });

  it("is unknown for every night when there is no photo at all", () => {
    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-05", []));

    expect(Object.values(nights).map((n) => [n.assign, n.reason, n.suggestedStationKeys])).toEqual([
      ["unknown", "unknown", []],
      ["unknown", "unknown", []],
      ["unknown", "unknown", []],
    ]);
  });
});

describe("attributeNights: the station a last photo belongs to", () => {
  it("gives a transit-noise photo's night to the next kept station, as buildStations mapped it", () => {
    const here = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02"),
        station(KEY_PORT_CARROW, "Port Carrow", PORT_CARROW, "2031-05-03", "2031-05-03"),
      ],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("t1", "2031-05-02 21:40", ROADSIDE),
        photo("b1", "2031-05-03 09:00", PORT_CARROW),
      ],
      placeOf: { a1: KEY_NORTHVALE, t1: KEY_PORT_CARROW, b1: KEY_PORT_CARROW },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [here]));

    expect(nights["2031-05-02"].assign).toBe(KEY_PORT_CARROW);
  });

  it("gives the night of a photo in a home-only area to home", () => {
    const home = area({
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      stations: [],
      photos: [photo("h1", "2031-05-02 18:00", { lat: -43.53, lon: 172.64 })],
      placeOf: { h1: "home" },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-03", [home]));

    expect(nights["2031-05-02"]).toEqual({
      assign: "home",
      reason: "home",
      suggestedStationKeys: [],
    });
  });

  it("gives a night whose last photo belongs to a day trip to the station it left from", () => {
    const KEY_DAY_TRIP = "-890|3401|2031-05-03";
    const here = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-03"),
        station(KEY_DAY_TRIP, "Roadside", ROADSIDE, "2031-05-03", "2031-05-03", "dayTrip", {
          excursionOf: KEY_NORTHVALE,
        }),
      ],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("d1", "2031-05-03 21:00", ROADSIDE),
      ],
      placeOf: { a1: KEY_NORTHVALE, d1: KEY_DAY_TRIP },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [here]));

    expect(nights["2031-05-03"]).toEqual({
      assign: KEY_NORTHVALE,
      reason: "lastPhoto",
      suggestedStationKeys: [],
    });
  });

  it("leaves the night unknown when no station owns the last photo", () => {
    const here = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-03")],
      photos: [
        photo("a1", "2031-05-02 10:00", NORTHVALE),
        photo("x1", "2031-05-02 22:00", ROADSIDE),
      ],
      placeOf: { a1: KEY_NORTHVALE },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [here]));

    expect(nights["2031-05-02"].assign).toBe("unknown");
  });
});
