import { attributeNights } from "../nights";
import {
  area,
  KELMORE,
  KELMORE_HOME,
  KEY_KELMORE,
  KEY_NORTHVALE,
  KEY_EASTMERE,
  nightInputs,
  NORTHVALE,
  photo,
  EASTMERE,
  station,
} from "./nightsFixtures";

// Synthetic fixtures only (public repository): invented towns, shifted years.

/** A suburb of Kelmore, 15 km from the residence. */
const OUTSKIRTS = { lat: -43.4, lon: 172.7 };
const KEY_OUTSKIRTS = "-868|3454|2031-05-02";

describe("attributeNights: a night in the home cluster", () => {
  it("gives the night to home when P is at a station the area marked home", () => {
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_KELMORE, "Kelmore", KELMORE, "2031-05-02", "2031-05-02", "home"),
        station(KEY_NORTHVALE, "Northvale", NORTHVALE, "2031-05-03", "2031-05-03"),
      ],
      photos: [
        photo("h1", "2031-05-02 17:30", KELMORE),
        photo("a1", "2031-05-03 09:00", NORTHVALE),
      ],
      placeOf: { h1: KEY_KELMORE, a1: KEY_NORTHVALE },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-04", [trip]));

    expect(nights["2031-05-02"]).toEqual({
      assign: "home",
      reason: "home",
      suggestedStationKeys: [],
    });
    expect(nights["2031-05-03"].assign).toBe(KEY_NORTHVALE);
  });

  it("gives the night to home when P is at a station within 30 km of the residence", () => {
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      stations: [
        station(KEY_OUTSKIRTS, "Kelmore outskirts", OUTSKIRTS, "2031-05-02", "2031-05-02"),
      ],
      photos: [photo("o1", "2031-05-02 19:00", OUTSKIRTS)],
      placeOf: { o1: KEY_OUTSKIRTS },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-03", [trip]));

    expect(nights["2031-05-02"].assign).toBe("home");
    expect(nights["2031-05-02"].reason).toBe("home");
  });

  it("leaves a station further than 30 km from the residence a station", () => {
    // Eastmere is 147 km from Kelmore.
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      stations: [station(KEY_EASTMERE, "Eastmere", EASTMERE, "2031-05-02", "2031-05-02")],
      photos: [photo("p1", "2031-05-02 19:00", EASTMERE)],
      placeOf: { p1: KEY_EASTMERE },
    });

    const { nights } = attributeNights(nightInputs("2031-05-02", "2031-05-03", [trip]));

    expect(nights["2031-05-02"].assign).toBe(KEY_EASTMERE);
  });

  it("knows no home cluster without a residence, but still trusts a station marked home", () => {
    const near = area({
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      stations: [
        station(KEY_OUTSKIRTS, "Kelmore outskirts", OUTSKIRTS, "2031-05-02", "2031-05-02"),
      ],
      photos: [photo("o1", "2031-05-02 19:00", OUTSKIRTS)],
      placeOf: { o1: KEY_OUTSKIRTS },
    });
    const marked = area({
      startDay: "2031-05-02",
      endDay: "2031-05-03",
      stations: [station(KEY_KELMORE, "Kelmore", KELMORE, "2031-05-02", "2031-05-02", "home")],
      photos: [photo("h1", "2031-05-02 19:00", KELMORE)],
      placeOf: { h1: KEY_KELMORE },
    });

    const withoutHome = { home: null };
    const a = attributeNights(nightInputs("2031-05-02", "2031-05-03", [near], withoutHome));
    const b = attributeNights(nightInputs("2031-05-02", "2031-05-03", [marked], withoutHome));

    expect(a.nights["2031-05-02"].assign).toBe(KEY_OUTSKIRTS);
    expect(b.nights["2031-05-02"].assign).toBe("home");
  });

  it("measures from the residence the traveller had on that night", () => {
    const trip = area({
      startDay: "2031-05-02",
      endDay: "2031-05-04",
      stations: [
        station(KEY_OUTSKIRTS, "Kelmore outskirts", OUTSKIRTS, "2031-05-02", "2031-05-03"),
      ],
      photos: [
        photo("o1", "2031-05-02 19:00", OUTSKIRTS),
        photo("o2", "2031-05-03 19:00", OUTSKIRTS),
      ],
      placeOf: { o1: KEY_OUTSKIRTS, o2: KEY_OUTSKIRTS },
    });
    // The residence is Kelmore until the 2nd, and unknown from the 3rd.
    const inputs = {
      ...nightInputs("2031-05-02", "2031-05-04", [trip]),
      homeAt: (day: string) => (day <= "2031-05-02" ? KELMORE_HOME : null),
    };

    const { nights } = attributeNights(inputs);

    expect([nights["2031-05-02"].assign, nights["2031-05-03"].assign]).toEqual([
      "home",
      KEY_OUTSKIRTS,
    ]);
  });
});
