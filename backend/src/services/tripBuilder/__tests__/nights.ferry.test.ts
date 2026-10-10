import { attributeNights } from "../nights";
import type { PhotoPoint } from "../types";
import {
  area,
  KELMORE,
  KEY_KELMORE,
  KEY_NORTHVALE,
  KEY_EASTMERE,
  leg,
  nightInputs,
  NORTHVALE,
  photo,
  EASTMERE,
  STRAIT,
  station,
} from "./nightsFixtures";

// Synthetic fixtures only (public repository): invented towns, shifted years.

/**
 * Northvale on the 2nd and 3rd, a crossing on the night of the 3rd, Port
 * Carrow on the 4th and 5th. The photos are the same in every test; the deck
 * photos and the mode of the leg between the two stations are not.
 */
function crossing(opts: { sea?: PhotoPoint[]; mode?: "road" | "ferry" } = {}) {
  return area({
    startDay: "2031-05-02",
    endDay: "2031-05-05",
    stations: [
      station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-03"),
      station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-04", "2031-05-05"),
    ],
    photos: [
      photo("a1", "2031-05-02 10:00", NORTHVALE),
      photo("a2", "2031-05-03 21:30", NORTHVALE),
      photo("b1", "2031-05-04 07:10", EASTMERE),
      photo("b2", "2031-05-04 20:00", EASTMERE),
      photo("b3", "2031-05-05 15:00", EASTMERE),
    ],
    sea: opts.sea ?? [],
    placeOf: {
      a1: KEY_NORTHVALE,
      a2: KEY_NORTHVALE,
      b1: KEY_EASTMERE,
      b2: KEY_EASTMERE,
      b3: KEY_EASTMERE,
    },
    legs: [leg(KEY_NORTHVALE, KEY_EASTMERE, opts.mode ?? "ferry")],
  });
}

describe("attributeNights: a night on the water", () => {
  it("gives an overnight ferry with deck photos to the station it left from", () => {
    const deck = [
      photo("s1", "2031-05-03 23:40", STRAIT, { atSea: true }),
      photo("s2", "2031-05-04 03:10", STRAIT, { atSea: true }),
    ];

    const { nights } = attributeNights(
      nightInputs("2031-05-02", "2031-05-06", [crossing({ sea: deck })])
    );

    expect(nights["2031-05-03"]).toEqual({
      assign: KEY_NORTHVALE,
      reason: "ferry",
      suggestedStationKeys: [],
    });
    expect([nights["2031-05-02"].assign, nights["2031-05-04"].assign]).toEqual([
      KEY_NORTHVALE,
      KEY_EASTMERE,
    ]);
  });

  it("gives an overnight ferry without deck photos to the station it left from", () => {
    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-06", [crossing()]));

    expect(nights["2031-05-03"]).toEqual({
      assign: KEY_NORTHVALE,
      reason: "ferry",
      suggestedStationKeys: [],
    });
  });

  it("is not moved by a deck photo taken after 04:00, which belongs to the next night", () => {
    const morning = [photo("s1", "2031-05-04 06:10", STRAIT, { atSea: true })];

    const { nights } = attributeNights(
      nightInputs("2031-05-02", "2031-05-06", [crossing({ sea: morning })])
    );

    expect(nights["2031-05-03"].assign).toBe(KEY_NORTHVALE);
    expect(nights["2031-05-03"].reason).toBe("ferry");
  });

  it("does not make a ferry night of a leg that is only a road", () => {
    const { nights } = attributeNights(
      nightInputs("2031-05-02", "2031-05-06", [crossing({ mode: "road" })])
    );

    expect(nights["2031-05-03"].reason).not.toBe("ferry");
  });

  it("leaves a day crossing alone: the night belongs to the port of arrival", () => {
    const byDay = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-02", "2031-05-02"),
        station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-02", "2031-05-03"),
      ],
      photos: [
        photo("a1", "2031-05-02 08:30", NORTHVALE),
        photo("b1", "2031-05-02 16:45", EASTMERE),
        photo("b2", "2031-05-02 21:00", EASTMERE),
      ],
      sea: [
        photo("s1", "2031-05-02 10:30", STRAIT, { atSea: true }),
        photo("s2", "2031-05-02 12:15", STRAIT, { atSea: true }),
      ],
      placeOf: { a1: KEY_NORTHVALE, b1: KEY_EASTMERE, b2: KEY_EASTMERE },
      legs: [leg(KEY_NORTHVALE, KEY_EASTMERE, "ferry")],
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [byDay]));

    expect(nights["2031-05-02"]).toEqual({
      assign: KEY_EASTMERE,
      reason: "lastPhoto",
      suggestedStationKeys: [],
    });
  });

  it("gives a crossing that leaves from home to home, not to the home station", () => {
    const fromHome = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_KELMORE, "Kelmore", KELMORE, "2031-05-02", "2031-05-02", "home"),
        station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-03", "2031-05-03"),
      ],
      photos: [photo("h1", "2031-05-02 21:00", KELMORE), photo("b1", "2031-05-03 07:00", EASTMERE)],
      placeOf: { h1: KEY_KELMORE, b1: KEY_EASTMERE },
      legs: [leg(KEY_KELMORE, KEY_EASTMERE, "ferry")],
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [fromHome]));

    expect(nights["2031-05-02"]).toEqual({
      assign: "home",
      reason: "ferry",
      suggestedStationKeys: [],
    });
  });

  it("leaves the night unknown when the deck photo comes before any station", () => {
    const early = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-03", "2031-05-03")],
      photos: [photo("b1", "2031-05-03 09:00", EASTMERE)],
      sea: [photo("s1", "2031-05-02 22:00", STRAIT, { atSea: true })],
      placeOf: { b1: KEY_EASTMERE },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [early]));

    expect(nights["2031-05-02"]).toEqual({
      assign: "unknown",
      reason: "unknown",
      suggestedStationKeys: [KEY_EASTMERE],
    });
  });
});
