import { roadtripAreaNames } from "../../../shared/tour/builderNightPlan";
import { decideAreaKind, mainCityOf } from "../areas";
import type { AreaHome, NightEntry } from "../types";
import { noHome, station } from "./planFixtures";

const portCarrow = (key: string, extra = {}) =>
  station(key, { title: "Port Carrow", photoCount: 5, ...extra });

const homeLegs = (startOn: boolean, endOn = false): AreaHome => ({
  start: { offered: true, defaultOn: startOn },
  end: { offered: true, defaultOn: endOn },
  unconfirmed: false,
});

const entry = (assign: string): NightEntry => ({
  assign,
  reason: "lastPhoto",
  suggestedStationKeys: [],
});

describe("decideAreaKind", () => {
  it("is one timeline stop for one city with no home leg, however often it was visited", () => {
    const stations = [station("n1"), station("n2", { title: " northvale " })];
    expect(decideAreaKind({ stations, home: noHome() }, true)).toBe("stops");
  });

  it("is a roadtrip for two cities, but a stop when roadtrips are hidden", () => {
    const stations = [station("n1"), portCarrow("p1")];
    expect(decideAreaKind({ stations, home: noHome() }, true)).toBe("roadtrip");
    expect(decideAreaKind({ stations, home: noHome() }, false)).toBe("stops");
  });

  it("is a roadtrip for one city when a home leg is switched on", () => {
    const stations = [station("h1", { kind: "home", title: "Kelmore" }), station("n1")];
    expect(decideAreaKind({ stations, home: homeLegs(true) }, true)).toBe("roadtrip");
    expect(decideAreaKind({ stations, home: homeLegs(false, true) }, true)).toBe("roadtrip");
    expect(decideAreaKind({ stations, home: homeLegs(true) }, false)).toBe("stops");
  });

  it("does not count a home or an airport station as a city", () => {
    const stations = [
      station("a1", { kind: "airport", title: "Northvale Airport" }),
      station("n1"),
      station("h1", { kind: "home", title: "Kelmore" }),
    ];
    expect(decideAreaKind({ stations, home: homeLegs(false) }, true)).toBe("stops");
  });

  it("counts a day trip's city: a base and its excursion are two cities", () => {
    const stations = [station("n1"), portCarrow("p1", { kind: "dayTrip" }), station("n2")];
    expect(decideAreaKind({ stations, home: noHome() }, true)).toBe("roadtrip");
  });

  it("is a stop for an area that is only the way home, home legs or not", () => {
    const stations = [station("h1", { kind: "home", title: "Kelmore" })];
    expect(decideAreaKind({ stations, home: homeLegs(true, true) }, true)).toBe("stops");
  });
});

describe("mainCityOf", () => {
  const stations = [
    station("n1"),
    portCarrow("p1"),
    station("n2", { photoCount: 3 }),
    station("h1", { kind: "home", title: "Kelmore", photoCount: 400 }),
  ];

  it("is the city with the most nights, counting every station of that title", () => {
    const nights = {
      "2031-05-02": entry("n1"),
      "2031-05-03": entry("p1"),
      "2031-05-04": entry("n2"),
    };
    expect(mainCityOf(stations, nights)).toBe("Northvale");
  });

  it("breaks a tie on nights by photos", () => {
    const nights = { "2031-05-02": entry("n1"), "2031-05-03": entry("p1") };
    // Northvale: 10 + 3 photos, Port Carrow: 5.
    expect(mainCityOf(stations, nights)).toBe("Northvale");
    expect(mainCityOf([station("n1", { photoCount: 2 }), portCarrow("p1")], nights)).toBe(
      "Port Carrow"
    );
  });

  it("goes by photos alone when nobody slept, and ignores home, unknown and flight nights", () => {
    const nights = {
      "2031-05-02": entry("home"),
      "2031-05-03": entry("unknown"),
      "2031-05-04": entry("flight"),
    };
    expect(mainCityOf(stations, nights)).toBe("Northvale");
  });

  it("adds up the nights of every station of one title, which can outweigh a single other station", () => {
    // Per station each has one night and Port Carrow's 5 photos beat 4; per city Northvale has 2 nights.
    const split = [
      station("n1", { photoCount: 4 }),
      station("n2", { photoCount: 4 }),
      portCarrow("p1"),
    ];
    const nights = {
      "2031-05-02": entry("n1"),
      "2031-05-03": entry("p1"),
      "2031-05-04": entry("n2"),
    };
    expect(mainCityOf(split, nights)).toBe("Northvale");
  });

  it("adds up the photos of every station of one title when nobody slept", () => {
    // Per station Port Carrow's 5 photos beat 3; per city Northvale has 3 + 3. The titles differ in case and spacing.
    const split = [
      station("n1", { photoCount: 3 }),
      station("n2", { title: " northvale ", photoCount: 3 }),
      portCarrow("p1"),
    ];
    expect(mainCityOf(split, {})).toBe("Northvale");
  });

  it("returns the first city when nights and photos are level", () => {
    const nights = { "2031-05-02": entry("n1"), "2031-05-03": entry("p1") };
    const level = [station("n1", { photoCount: 5 }), portCarrow("p1")];
    expect(mainCityOf(level, nights)).toBe("Northvale");
    expect(mainCityOf([...level].reverse(), nights)).toBe("Port Carrow");
    expect(mainCityOf(level, {})).toBe("Northvale");
    expect(mainCityOf([...level].reverse(), {})).toBe("Port Carrow");
  });

  it("is null when the area has no city", () => {
    const onlyAnchors = [
      station("h1", { kind: "home", title: "Kelmore" }),
      station("a1", { kind: "airport", title: "Northvale" }),
    ];
    expect(mainCityOf(onlyAnchors, { "2031-05-02": entry("h1") })).toBeNull();
    expect(mainCityOf([], {})).toBeNull();
  });

  it("gives the roadtrip naming rule what it needs", () => {
    const names = roadtripAreaNames(
      [
        { key: "2031-05-02#1", mainCity: mainCityOf([station("n1")], {}), startDay: "2031-05-02" },
        {
          key: "2031-05-06#1",
          mainCity: mainCityOf([portCarrow("p1")], {}),
          startDay: "2031-05-06",
        },
      ],
      "Southern loop",
      new Set()
    );
    expect(names).toEqual({
      "2031-05-02#1": "Southern loop · Northvale",
      "2031-05-06#1": "Southern loop · Port Carrow",
    });
  });
});
