import {
  pitstopAlbumName,
  pitstopAreas,
  pitstopCity,
  principalDestination,
  storedPitstops,
} from "../pitstops";
import type { AirportData } from "../../airportLookup";
import type { Day, NightEntry } from "../types";
import { area, flight, photo, preciseFlight, station, type AreaFixture } from "./nightsFixtures";
import { NORTHVALE, PORT_CARROW } from "./placeFixtures";

/**
 * The pitstop rules (spec 2026-10-11 pitstops §2, §6): a stay between two
 * same-airport flights on different days is its own roadtrip with its own
 * album, unless it is the trip's principal destination. The album — and the
 * roadtrip row beside it — is named after the shared airport's city, not the
 * photos' own majority city (owner ruling 2026-10-12). Synthetic fixtures only
 * (public repository).
 */

const night = (assign: string): NightEntry => ({
  assign,
  reason: "lastPhoto",
  suggestedStationKeys: [],
});

/** ZZ101 ZKE→ZNV, landing 2 May 10:05; the stay's inbound flight. */
const F1 = preciseFlight("f1", "2031-05-02 08:00", "2031-05-02 10:05");
/** ZZ102 ZNV→ZKA, leaving 4 May 18:00; the stay's outbound and the destination's inbound. */
const F2 = preciseFlight("f2", "2031-05-04 18:00", "2031-05-04 20:30", {
  depIata: "ZNV",
  arrIata: "ZKA",
});
/** ZZ103 ZKA→ZKE, leaving 8 May 18:00; the destination's outbound. */
const F3 = preciseFlight("f3", "2031-05-08 18:00", "2031-05-08 20:30", {
  depIata: "ZKA",
  arrIata: "ZKE",
});

/** Dunholme, two nights between the inbound and outbound flights. */
const STAY: AreaFixture = area({
  startDay: "2031-05-02",
  endDay: "2031-05-04",
  key: "2031-05-02#1",
  afterFlightId: F1.id,
  beforeFlightId: F2.id,
  stations: [station("k-stay", "Dunholme", NORTHVALE, "2031-05-02", "2031-05-03")],
  photos: [photo("s1", "2031-05-02 11:00", NORTHVALE), photo("s2", "2031-05-03 11:00", NORTHVALE)],
  placeOf: { s1: "k-stay", s2: "k-stay" },
});

/** Southhollow, four nights after the second flight: the principal destination, also flight-bounded by a same-airport pair. */
const DESTINATION: AreaFixture = area({
  startDay: "2031-05-04",
  endDay: "2031-05-08",
  key: "2031-05-04#1",
  afterFlightId: F2.id,
  beforeFlightId: F3.id,
  stations: [station("k-dest", "Southhollow", PORT_CARROW, "2031-05-04", "2031-05-07")],
  photos: [
    photo("d1", "2031-05-04 12:00", PORT_CARROW),
    photo("d2", "2031-05-05 12:00", PORT_CARROW),
    photo("d3", "2031-05-06 12:00", PORT_CARROW),
    photo("d4", "2031-05-07 12:00", PORT_CARROW),
  ],
  placeOf: { d1: "k-dest", d2: "k-dest", d3: "k-dest", d4: "k-dest" },
});

const NIGHTS: Readonly<Record<Day, NightEntry>> = {
  "2031-05-02": night("k-stay"),
  "2031-05-03": night("k-stay"),
  "2031-05-04": night("k-dest"),
  "2031-05-05": night("k-dest"),
  "2031-05-06": night("k-dest"),
  "2031-05-07": night("k-dest"),
};

const MAIN_CITIES = new Map([
  [STAY.plan.key, "Dunholme"],
  [DESTINATION.plan.key, "Southhollow"],
]);

/** A catalogue row; only the name is required by the real type. */
const airport = (over: Partial<AirportData> & Pick<AirportData, "name">): AirportData => ({
  lat: NORTHVALE.lat,
  lon: NORTHVALE.lon,
  ...over,
});

/**
 * ZNV, the airport both of the stay's flights use: it serves Northvale, while
 * the stay's photos sit in Dunholme — the two cities the ruling picks between.
 */
const AIRPORTS = new Map<string, AirportData>([
  ["ZNV", airport({ name: "Northvale International Airport", municipalityName: "Northvale" })],
]);

const photosById = (): Map<string, (typeof STAY.photos)[number]> =>
  new Map([...STAY.photos, ...DESTINATION.photos].map((p) => [p.id, p] as const));

const find = (
  over: {
    anchors?: readonly ReturnType<typeof preciseFlight>[];
    airports?: ReadonlyMap<string, AirportData>;
  } = {}
) =>
  pitstopAreas({
    areas: [STAY.plan, DESTINATION.plan],
    nights: NIGHTS,
    anchors: over.anchors ?? [F1, F2, F3],
    photosById: photosById(),
    mainCities: MAIN_CITIES,
    airports: over.airports ?? AIRPORTS,
    tripName: "Southern loop",
  });

describe("pitstopAreas", () => {
  it("offers the stay its own album, and leaves the destination's area to the trip's own", () => {
    const found = find();
    expect([...found.pitstops.keys()]).toEqual(["2031-05-02#1"]);
    expect(found.pitstops.get("2031-05-02#1")).toEqual({
      albumName: "Northvale 2031 Road Trip (Southern loop)",
    });
    // The city the roadtrip row must take after the `·` is the album's own
    // (owner ruling 2026-10-12): the scan hands it out beside the DTO piece.
    expect(found.cities.get("2031-05-02#1")).toBe("Northvale");
  });

  it("falls back to the area's own main city when the airport cannot name one", () => {
    const found = find({ airports: new Map() });
    expect(found.pitstops.get("2031-05-02#1")).toEqual({
      albumName: "Dunholme 2031 Road Trip (Southern loop)",
    });
    expect(found.cities.get("2031-05-02#1")).toBe("Dunholme");
  });

  it("drops the parenthetical when the airport's city is the trip's own name", () => {
    const named = new Map<string, AirportData>([
      [
        "ZNV",
        airport({ name: "Northvale International Airport", municipalityName: "Southern loop" }),
      ],
    ]);
    const found = find({ airports: named });
    expect(found.pitstops.get("2031-05-02#1")).toEqual({
      albumName: "Southern loop 2031 Road Trip",
    });
  });

  it("offers nothing when the two flights fall on one local day", () => {
    const sameDay = preciseFlight("f2", "2031-05-02 22:00", "2031-05-03 00:30", {
      depIata: "ZNV",
      arrIata: "ZKA",
    });
    expect([...find({ anchors: [F1, sameDay, F3] }).pitstops.keys()]).toEqual([]);
  });

  it("offers nothing when the two flights do not share an airport", () => {
    const away = preciseFlight("f2", "2031-05-04 18:00", "2031-05-04 20:30", {
      depIata: "ZKM",
      arrIata: "ZKA",
    });
    expect([...find({ anchors: [F1, away, F3] }).pitstops.keys()]).toEqual([]);
  });

  it("reads a pair without times at the day level: two days qualify, one day does not", () => {
    const dayIn = flight("f1", { depIata: "ZKE", arrIata: "ZNV", arrDay: "2031-05-02" });
    const dayOut = flight("f2", { depIata: "ZNV", arrIata: "ZKA", depDay: "2031-05-04" });
    expect([...find({ anchors: [dayIn, dayOut] }).pitstops.keys()]).toEqual(["2031-05-02#1"]);
    const sameDayOut = flight("f2", { depIata: "ZNV", arrIata: "ZKA", depDay: "2031-05-02" });
    expect([...find({ anchors: [dayIn, sameDayOut] }).pitstops.keys()]).toEqual([]);
  });

  it("leaves the trip's first and last areas alone — no two flights bound them", () => {
    const homeStart = area({
      startDay: "2031-05-01",
      endDay: "2031-05-02",
      key: "2031-05-01#1",
      beforeFlightId: F1.id,
      stations: [station("k-first", "Kelmore", NORTHVALE, "2031-05-01", "2031-05-02")],
      photos: [photo("h1", "2031-05-01 11:00", NORTHVALE)],
      placeOf: { h1: "k-first" },
    });
    const homeEnd = area({
      startDay: "2031-05-08",
      endDay: "2031-05-09",
      key: "2031-05-08#1",
      afterFlightId: F3.id,
      stations: [station("k-last", "Kelmore", NORTHVALE, "2031-05-08", "2031-05-09")],
      photos: [photo("h2", "2031-05-08 11:00", NORTHVALE)],
      placeOf: { h2: "k-last" },
    });
    const found = pitstopAreas({
      areas: [homeStart.plan, STAY.plan, DESTINATION.plan, homeEnd.plan],
      nights: NIGHTS,
      anchors: [F1, F2, F3],
      photosById: photosById(),
      mainCities: MAIN_CITIES,
      airports: AIRPORTS,
      tripName: "Southern loop",
    });
    expect([...found.pitstops.keys()]).toEqual(["2031-05-02#1"]);
  });
});

describe("pitstopCity", () => {
  it("takes the served city, and a slash list as its first name", () => {
    const row = airport({
      name: "Northvale International Airport",
      municipalityName: "Northvale/Seeb",
    });
    expect(pitstopCity(row, "Dunholme")).toBe("Northvale");
  });

  it("takes a plain city as it stands, from either catalogue field", () => {
    const served = airport({ name: "Dunmere International Airport", municipalityName: "Dunmere" });
    expect(pitstopCity(served, "Southhollow")).toBe("Dunmere");
    const plain = airport({ name: "Port Carrow Airport", city: "Port Carrow" });
    expect(pitstopCity(plain, "Dunholme")).toBe("Port Carrow");
  });

  it("falls back to the display name when the municipality is the runway's own town", () => {
    // A province-code row the airport's own name does not repeat is the town
    // the runway sits in (`airportCityName`), so the airport names the pitstop.
    const row = airport({ name: "Carrow International Airport", city: "Dunmere (WS)" });
    expect(pitstopCity(row, "Dunholme")).toBe("Carrow");
  });

  it("falls back to the area's main city without an airport row", () => {
    expect(pitstopCity(null, "Dunholme")).toBe("Dunholme");
    expect(pitstopCity(null, null)).toBeNull();
  });

  it("names a row with no city at all by the airport's display name", () => {
    const row = airport({ name: "Kelmore Airport", city: null });
    expect(pitstopCity(row, "Dunholme")).toBe("Kelmore");
  });
});

describe("principalDestination", () => {
  const named = (key: string, startDay: string, title: string): AreaFixture =>
    area({
      startDay,
      endDay: "2031-05-08",
      key,
      stations: [station(`k-${key}`, title, NORTHVALE, startDay, "2031-05-08")],
      photos: [photo(`${key}-1`, `${startDay} 11:00`, NORTHVALE)],
      placeOf: { [`${key}-1`]: `k-${key}` },
    });

  it("elects the area with the most nights", () => {
    const short = named("short", "2031-05-02", "Dunholme");
    const long = named("long", "2031-05-03", "Southhollow");
    const nights = {
      "2031-05-02": night("k-short"),
      "2031-05-03": night("k-long"),
      "2031-05-04": night("k-long"),
    };
    expect(principalDestination([short.plan, long.plan], nights, photosById())?.key).toBe("long");
  });

  it("breaks a nights tie by the most photo-days", () => {
    const fewDays = named("few", "2031-05-02", "Dunholme");
    const manyDays = area({
      startDay: "2031-05-03",
      endDay: "2031-05-08",
      key: "2031-05-03#2",
      stations: [station("k-many", "Southhollow", NORTHVALE, "2031-05-03", "2031-05-08")],
      photos: [
        photo("many-1", "2031-05-03 11:00", NORTHVALE),
        photo("many-2", "2031-05-04 11:00", NORTHVALE),
        photo("many-3", "2031-05-05 11:00", NORTHVALE),
      ],
      placeOf: { "many-1": "k-many", "many-2": "k-many", "many-3": "k-many" },
    });
    const nights = {
      "2031-05-02": night("k-few"),
      "2031-05-03": night("k-many"),
    };
    const all = new Map([...photosById(), ...manyDays.photos.map((p) => [p.id, p] as const)]);
    expect(principalDestination([fewDays.plan, manyDays.plan], nights, all)?.key).toBe(
      "2031-05-03#2"
    );
  });

  it("breaks a photo-days tie by the earliest first day, whatever the scan order", () => {
    const later = area({
      startDay: "2031-05-03",
      endDay: "2031-05-08",
      key: "2031-05-03#2",
      stations: [station("k-later", "Southhollow", NORTHVALE, "2031-05-03", "2031-05-08")],
      photos: [
        photo("later-1", "2031-05-03 11:00", NORTHVALE),
        photo("later-2", "2031-05-04 11:00", NORTHVALE),
      ],
      placeOf: { "later-1": "k-later", "later-2": "k-later" },
    });
    const earlier = area({
      startDay: "2031-05-02",
      endDay: "2031-05-08",
      key: "2031-05-02#1",
      stations: [station("k-earlier", "Dunholme", NORTHVALE, "2031-05-02", "2031-05-08")],
      photos: [
        photo("earlier-1", "2031-05-02 11:00", NORTHVALE),
        photo("earlier-2", "2031-05-03 11:00", NORTHVALE),
      ],
      placeOf: { "earlier-1": "k-earlier", "earlier-2": "k-earlier" },
    });
    const nights = {
      "2031-05-02": night("k-earlier"),
      "2031-05-03": night("k-later"),
    };
    const all = new Map([
      ...photosById(),
      ...later.photos.map((p) => [p.id, p] as const),
      ...earlier.photos.map((p) => [p.id, p] as const),
    ]);
    // The later area comes first in scan order; the earliest first day still wins.
    expect(principalDestination([later.plan, earlier.plan], nights, all)?.key).toBe("2031-05-02#1");
  });
});

describe("pitstopAlbumName", () => {
  it("names the album `<City> <Year> Road Trip (<Trip Name>)`", () => {
    expect(pitstopAlbumName("Dunholme", "2031-05-02", "Southern loop")).toBe(
      "Dunholme 2031 Road Trip (Southern loop)"
    );
  });

  it("drops the parenthetical when the city and the trip name are the same", () => {
    expect(pitstopAlbumName("Dunholme", "2031-05-02", "Dunholme")).toBe("Dunholme 2031 Road Trip");
  });

  it("reads the year from the area's first day", () => {
    expect(pitstopAlbumName("Dunholme", "2032-01-02", "Southern loop")).toBe(
      "Dunholme 2032 Road Trip (Southern loop)"
    );
  });
});

describe("storedPitstops", () => {
  const found = () =>
    pitstopAreas({
      areas: [STAY.plan, DESTINATION.plan],
      nights: NIGHTS,
      anchors: [F1, F2, F3],
      photosById: photosById(),
      mainCities: MAIN_CITIES,
      airports: AIRPORTS,
      tripName: "Southern loop",
    }).pitstops;

  it("keeps each pitstop's own photo set, under its key, name and day", () => {
    expect(storedPitstops([STAY.plan, DESTINATION.plan], found())).toEqual([
      {
        key: "2031-05-02#1",
        albumName: "Northvale 2031 Road Trip (Southern loop)",
        day: "2031-05-02",
        assetIds: ["s1", "s2"],
      },
    ]);
  });

  it("lists nothing for an area no scan offered", () => {
    expect(storedPitstops([DESTINATION.plan], found())).toEqual([]);
  });
});
