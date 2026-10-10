import type { HomePeriod } from "../../../utils/homeAirport";
import { homeAt, isHomeCluster, townOf } from "../home";
import type { HomeAtDay } from "../types";
import { KELMORE } from "./placeFixtures";

const periods: HomePeriod[] = [
  {
    fromDate: "2029-01-01",
    toDate: "2031-06-01",
    residence: { name: "Kelmore, Westshire", lat: KELMORE.lat, lon: KELMORE.lon },
    residenceConfirmed: true,
    airports: [
      { code: "kmr", primary: true },
      { code: "KMW", primary: false },
    ],
  },
  {
    fromDate: "2031-06-01",
    toDate: null,
    residence: { name: "Northvale", lat: -45.05, lon: 168.7 },
    residenceConfirmed: false,
    airports: [{ code: "NVL", primary: true }],
  },
];

describe("homeAt", () => {
  it("names the residence, its zone and its airports on a day inside a period", () => {
    expect(homeAt(periods, "2031-05-10")).toEqual({
      name: "Kelmore, Westshire",
      lat: KELMORE.lat,
      lon: KELMORE.lon,
      confirmed: true,
      zone: "Pacific/Auckland",
      airports: new Set(["KMR", "KMW"]),
    });
  });

  it("follows the move: the next period starts on its own first day", () => {
    expect(homeAt(periods, "2031-05-31")?.name).toBe("Kelmore, Westshire");
    const later = homeAt(periods, "2031-06-01");
    expect(later?.name).toBe("Northvale");
    expect(later?.confirmed).toBe(false);
  });

  it("is null before the first period", () => {
    expect(homeAt(periods, "2028-12-31")).toBeNull();
  });

  it("is null for a period with no residence to measure from", () => {
    const unplaced: HomePeriod[] = [{ ...periods[0], residence: null, residenceConfirmed: false }];
    expect(homeAt(unplaced, "2031-05-10")).toBeNull();
  });
});

describe("isHomeCluster", () => {
  const home = homeAt(periods, "2031-05-10") as HomeAtDay;

  it("is home within 30 km of the residence", () => {
    expect(isHomeCluster({ lat: KELMORE.lat + 0.2, lon: KELMORE.lon }, home)).toBe(true);
  });

  it("is not home 33 km away", () => {
    expect(isHomeCluster({ lat: KELMORE.lat + 0.3, lon: KELMORE.lon }, home)).toBe(false);
  });

  it("is never home without a home", () => {
    expect(isHomeCluster(KELMORE, null)).toBe(false);
  });
});

describe("townOf", () => {
  const at = (name: string): HomeAtDay => ({
    name,
    lat: KELMORE.lat,
    lon: KELMORE.lon,
    confirmed: true,
    zone: "Pacific/Auckland",
    airports: new Set(),
  });

  it("keeps the town of a 'Town, Province' residence", () => {
    expect(townOf(at("Kelmore, Westshire"))).toBe("Kelmore");
  });

  it("keeps a residence with no province whole", () => {
    expect(townOf(at("Northvale"))).toBe("Northvale");
  });

  it("falls back to the whole name when nothing precedes the comma", () => {
    expect(townOf(at(", Westshire"))).toBe(", Westshire");
  });
});
