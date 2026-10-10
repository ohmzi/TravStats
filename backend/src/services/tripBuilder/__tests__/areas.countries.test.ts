import { draftCountries, draftLabels } from "../areas";
import type { CountryAt, DraftArea } from "../types";
import { KELMORE } from "./placeFixtures";
import { anchor, noHome, station } from "./planFixtures";

const SUNHAVEN = { lat: -33.87, lon: 151.21 };
const OPEN_SEA = { lat: -17.7, lon: 178.0 };

// Australia west of 160°E, New Zealand to 175°E, open sea beyond. Lower case on purpose.
const countryAt: CountryAt = (_lat, lon) => (lon < 160 ? "au" : lon < 175 ? "nz" : null);

describe("draftCountries", () => {
  it("unions where the stations stand and where the ticked flights land, each once", () => {
    const stations = [
      station("n1"),
      station("s1", { title: "Sunhaven", lat: SUNHAVEN.lat, lon: SUNHAVEN.lon }),
      station("o1", { title: "Mid-ocean", lat: OPEN_SEA.lat, lon: OPEN_SEA.lon }),
    ];
    const tickedFlights = [
      anchor({ id: "f1", arr: SUNHAVEN }),
      anchor({ id: "f2", arr: OPEN_SEA }),
      anchor({ id: "f3", arr: KELMORE }),
    ];
    expect(draftCountries({ stations, tickedFlights, countryAt, existing: [] })).toEqual([
      "NZ",
      "AU",
    ]);
  });

  it("adds a country only a ticked flight reaches, after the stations' countries", () => {
    expect(
      draftCountries({
        stations: [station("n1")],
        tickedFlights: [anchor({ id: "f1", arr: SUNHAVEN })],
        countryAt,
        existing: [],
      })
    ).toEqual(["NZ", "AU"]);
  });

  it("takes the countries from the ticked flights alone when there are no stations", () => {
    expect(
      draftCountries({
        stations: [],
        tickedFlights: [anchor({ id: "f1", arr: SUNHAVEN })],
        countryAt,
        existing: [],
      })
    ).toEqual(["AU"]);
  });

  it("leaves out home and airport stations", () => {
    const stations = [
      station("h1", { kind: "home", lat: KELMORE.lat, lon: KELMORE.lon }),
      station("a1", { kind: "airport", lat: SUNHAVEN.lat, lon: SUNHAVEN.lon }),
    ];
    expect(draftCountries({ stations, tickedFlights: [], countryAt, existing: [] })).toEqual([]);
  });

  it("keeps an existing trip's countries first", () => {
    expect(
      draftCountries({
        stations: [station("n1")],
        tickedFlights: [],
        countryAt,
        existing: ["FJ", "nz"],
      })
    ).toEqual(["FJ", "NZ"]);
  });

  it("ignores anything that is not a two-letter code", () => {
    const odd: CountryAt = (lat) => (lat < -45 ? "NZL" : lat < -44 ? "" : null);
    expect(
      draftCountries({
        stations: [station("n1"), station("n2", { lat: -44.5 }), station("n3", { lat: -40 })],
        tickedFlights: [],
        countryAt: odd,
        existing: [],
      })
    ).toEqual([]);
  });
});

describe("draftLabels", () => {
  const area = (overrides: Partial<DraftArea> = {}): DraftArea => ({
    key: "2031-05-02#1",
    defaultAs: "roadtrip",
    suggestedName: "Southern loop",
    mainCity: "Northvale",
    startDay: "2031-05-02",
    endDay: "2031-05-09",
    home: noHome(),
    stations: [station("n1")],
    legs: [],
    ...overrides,
  });

  it("goes from the home city to the main city", () => {
    expect(draftLabels([area()], "Kelmore")).toEqual({
      originLabel: "Kelmore",
      destinationLabel: "Northvale",
    });
  });

  it("starts from the first city of the trip without a home, skipping home and airport stations", () => {
    const stations = [
      station("a1", { kind: "airport", title: "Sunhaven" }),
      station("h1", { kind: "home", title: "Kelmore" }),
      station("p1", { title: "Port Carrow" }),
      station("n1"),
    ];
    expect(draftLabels([area({ stations })], null)).toEqual({
      originLabel: "Port Carrow",
      destinationLabel: "Northvale",
    });
  });

  it("leaves the origin out when it would be the destination", () => {
    expect(draftLabels([area()], null)).toEqual({
      originLabel: null,
      destinationLabel: "Northvale",
    });
  });

  it("names the destination from the longest area, the first one on a tie", () => {
    const short = area({ key: "2031-05-02#1", endDay: "2031-05-04", mainCity: "Port Carrow" });
    const long = area({ key: "2031-05-06#1", startDay: "2031-05-06", endDay: "2031-05-12" });
    expect(draftLabels([short, long], "Kelmore").destinationLabel).toBe("Northvale");
    const same = area({ key: "2031-05-06#1", startDay: "2031-05-06", endDay: "2031-05-08" });
    expect(draftLabels([short, same], "Kelmore").destinationLabel).toBe("Port Carrow");
  });

  it("has a destination only if an area has a main city, and ignores a blank home title", () => {
    expect(draftLabels([area({ mainCity: null })], "Kelmore")).toEqual({
      originLabel: "Kelmore",
      destinationLabel: null,
    });
    expect(draftLabels([], "  ")).toEqual({ originLabel: null, destinationLabel: null });
    expect(draftLabels([], "Kelmore")).toEqual({ originLabel: "Kelmore", destinationLabel: null });
  });
});
