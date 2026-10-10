import { distanceKm } from "../../photoJourneys/cluster";
import { planAreaHome } from "../home";
import type { GroundArea, HomeAtDay, NamedCluster, PlanStation } from "../types";
import { KELMORE, NORTHVALE, photo } from "./placeFixtures";
import { HOME, WINDOW, groundArea, station } from "./planFixtures";

/** About 764 km north of Kelmore: a drive of a day, or a short flight. */
const HARBOURTON = { lat: -36.85, lon: 174.76 };
/** About 2,200 km away across the sea. */
const SUNHAVEN = { lat: -33.87, lon: 151.21 };

type Spot = { lat: number; lon: number };

interface Scene {
  stations?: PlanStation[];
  first?: [local: string, at: Spot];
  last?: [local: string, at: Spot];
  area?: Partial<GroundArea>;
  home?: HomeAtDay | null;
  homeAirportName?: string | null;
  clusters?: NamedCluster[];
  stationCluster?: Record<string, string>;
  taken?: Set<string>;
}

function plan(scene: Scene = {}) {
  const [firstLocal, firstAt] = scene.first ?? ["2031-05-02 12:00", NORTHVALE];
  const [lastLocal, lastAt] = scene.last ?? ["2031-05-09 18:00", NORTHVALE];
  const photos = [photo("first", firstLocal, firstAt), photo("last", lastLocal, lastAt)];
  return planAreaHome({
    window: WINDOW,
    area: groundArea({ photoIds: ["first", "last"], ...scene.area }),
    stations: scene.stations ?? [station("n1")],
    stationCluster: new Map(Object.entries(scene.stationCluster ?? {})),
    clusters: new Map((scene.clusters ?? []).map((c) => [c.id, c] as const)),
    photosById: new Map(photos.map((p) => [p.id, p] as const)),
    homeAt: () => (scene.home === undefined ? HOME : scene.home),
    homeAirportName: scene.homeAirportName ?? null,
    taken: scene.taken ?? new Set(),
  });
}

const homeCluster = (overrides: Partial<NamedCluster> = {}): NamedCluster => ({
  id: "cK",
  photoIds: [],
  lat: KELMORE.lat,
  lon: KELMORE.lon,
  spreadKm: 2,
  immichCity: null,
  immichState: null,
  immichCountry: null,
  title: "Kelmore",
  titleSource: "immich",
  isHome: true,
  ...overrides,
});

describe("planAreaHome: where a home leg is offered", () => {
  it("offers nothing without a home on the day", () => {
    const { home, stations } = plan({ home: null });
    expect(home).toEqual({
      start: { offered: false, defaultOn: false },
      end: { offered: false, defaultOn: false },
      unconfirmed: false,
    });
    expect(stations).toEqual([station("n1")]);
  });

  it("offers nothing at an end that has a flight", () => {
    const both = plan({ area: { afterFlightId: "f1", beforeFlightId: "f2" } });
    expect([both.home.start.offered, both.home.end.offered]).toEqual([false, false]);
    const inboundOnly = plan({ area: { afterFlightId: "f1" } });
    expect([inboundOnly.home.start.offered, inboundOnly.home.end.offered]).toEqual([false, true]);
  });

  it("counts only the window's edges, a day either way", () => {
    expect(plan({ area: { startDay: "2031-05-03" } }).home.start.offered).toBe(true);
    expect(plan({ area: { startDay: "2031-05-05" } }).home.start.offered).toBe(false);
    expect(plan({ area: { endDay: "2031-05-08" } }).home.end.offered).toBe(true);
    expect(plan({ area: { endDay: "2031-05-06" } }).home.end.offered).toBe(false);
  });

  it("offers nothing for an area with no stations", () => {
    expect(plan({ stations: [] }).home.start.offered).toBe(false);
  });
});

describe("planAreaHome: a Home station is added", () => {
  it("at both ends, dated S and E, when the photos begin and end within reach of home", () => {
    const taken = new Set<string>();
    const { home, stations } = plan({ taken });
    expect(stations.map((s) => [s.kind, s.title, s.firstDay])).toEqual([
      ["home", "Kelmore", "2031-05-02"],
      ["visit", "Northvale", "2031-05-02"],
      ["home", "Kelmore", "2031-05-09"],
    ]);
    expect(stations[0]).toEqual({
      key: "-871|3453|2031-05-02",
      title: "Kelmore",
      titleSource: "home",
      kind: "home",
      lat: KELMORE.lat,
      lon: KELMORE.lon,
      snappedKm: null,
      firstDay: "2031-05-02",
      lastDay: "2031-05-02",
      firstLocal: null,
      lastLocal: null,
      photoCount: 0,
      previewIdx: [],
      notes: null,
    });
    expect(home.start).toEqual({ offered: true, defaultOn: true, station: stations[0] });
    expect(home.end).toEqual({ offered: true, defaultOn: true, station: stations[2] });
    expect(stations[2].key).toBe("-871|3453|2031-05-09");
    expect([...taken]).toEqual(["-871|3453|2031-05-02", "-871|3453|2031-05-09"]);
  });

  it("offers the leg but leaves it off beyond 900 km, and still claims its key", () => {
    const taken = new Set<string>();
    const { home, stations } = plan({ first: ["2031-05-02 12:00", SUNHAVEN], taken });
    expect(distanceKm(SUNHAVEN, KELMORE)).toBeGreaterThan(900);
    expect(home.start.offered).toBe(true);
    expect(home.start.defaultOn).toBe(false);
    expect(stations.map((s) => s.kind)).toEqual(["visit", "home"]);
    expect(taken.has(home.start.station?.key ?? "")).toBe(true);
  });

  it("leaves the start off when home to the first photo would have taken a flight", () => {
    expect(distanceKm(HARBOURTON, KELMORE)).toBeGreaterThan(700);
    // 764 km in 2 hours from midnight is 380 km/h; in 5 hours it is 153 km/h.
    const flown = plan({ first: ["2031-05-02 02:00", HARBOURTON] });
    expect(flown.home.start).toMatchObject({ offered: true, defaultOn: false });
    const driven = plan({ first: ["2031-05-02 05:00", HARBOURTON] });
    expect(driven.home.start).toMatchObject({ offered: true, defaultOn: true });
  });

  it("asks the same of the way back, measured to the end of the last day", () => {
    const flown = plan({ last: ["2031-05-09 22:00", HARBOURTON] });
    expect(flown.home.end).toMatchObject({ offered: true, defaultOn: false });
    const driven = plan({ last: ["2031-05-09 19:00", HARBOURTON] });
    expect(driven.home.end).toMatchObject({ offered: true, defaultOn: true });
  });
});

describe("planAreaHome: the home cluster is relabelled", () => {
  const stations = () => [station("n1"), station("k1", { title: "Kelmore East" })];

  it("takes the title from Immich's city and keeps its key", () => {
    const result = plan({
      stations: stations(),
      stationCluster: { k1: "cK" },
      clusters: [homeCluster({ immichCity: "Kelmore East" })],
    });
    expect(result.stations.map((s) => [s.key, s.kind])).toEqual([
      ["-871|3453|2031-05-02", "home"],
      ["n1", "visit"],
      ["k1", "home"],
    ]);
    expect(result.stations[2]).toMatchObject({ title: "Kelmore East", titleSource: "immich" });
    expect(result.home.end).toEqual({
      offered: true,
      defaultOn: true,
      station: result.stations[2],
    });
  });

  it("falls back to the town of the residence", () => {
    const result = plan({
      stations: stations(),
      stationCluster: { k1: "cK" },
      clusters: [homeCluster()],
    });
    expect(result.stations[2]).toMatchObject({
      title: "Kelmore",
      titleSource: "home",
      kind: "home",
    });
  });

  it("does not add a second station to an area that is only home", () => {
    const taken = new Set<string>();
    const result = plan({
      stations: [station("k1")],
      stationCluster: { k1: "cK" },
      clusters: [homeCluster()],
      taken,
    });
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]).toMatchObject({ key: "k1", kind: "home" });
    expect([result.home.start.station?.key, result.home.end.station?.key]).toEqual(["k1", "k1"]);
    expect(taken.size).toBe(0);
  });
});

describe("planAreaHome: an unconfirmed residence", () => {
  const migrated: HomeAtDay = { ...HOME, confirmed: false, name: "Kelmore Airport" };

  it("raises the chip, and titles an added station with the home airport's name", () => {
    const result = plan({ home: migrated, homeAirportName: "Kelmore" });
    expect(result.home.unconfirmed).toBe(true);
    expect(result.stations[0].title).toBe("Kelmore");
  });

  it("uses the residence's own name when no airport name is known", () => {
    expect(plan({ home: migrated }).stations[0].title).toBe("Kelmore Airport");
  });

  it("raises no chip for a confirmed residence, or when no end was offered", () => {
    expect(plan().home.unconfirmed).toBe(false);
    expect(
      plan({ home: migrated, area: { afterFlightId: "f1", beforeFlightId: "f2" } }).home.unconfirmed
    ).toBe(false);
  });
});
