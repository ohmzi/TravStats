import { mergeAreaPlans, routeScopeOf, withoutStations } from "../routeScope";
import type { AreaPlan, DraftArea, PlanStation, ScanInput } from "../types";

// Synthetic fixtures only (public repository): invented places, shifted years.
const TRIP = "3f1c2a4e-8b7d-4c1e-9a2b-1d3e5f7a9b0c";
const ROUTE = "b4c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e";

const station = (key: string, lat: number, lon: number, day: string): PlanStation => ({
  key,
  title: key,
  titleSource: "geocode",
  kind: "visit",
  lat,
  lon,
  snappedKm: null,
  firstDay: day,
  lastDay: day,
  firstLocal: `${day} 09:00`,
  lastLocal: `${day} 18:00`,
  photoCount: 4,
  previewIdx: [0],
  notes: null,
});

function plan(
  key: string,
  startDay: string,
  endDay: string,
  startMs: number,
  endMs: number,
  stations: PlanStation[]
): AreaPlan {
  return {
    key,
    area: {
      photoIds: [`${key}-photo`],
      seaPhotoIds: [],
      afterFlightId: `${key}-in`,
      beforeFlightId: `${key}-out`,
      startMs,
      endMs,
      startDay,
      endDay,
    },
    segments: [],
    legs: stations.slice(1).map((s, i) => ({
      fromKey: stations[i].key,
      toKey: s.key,
      chordKm: 30,
      routedKm: null,
      mode: "road" as const,
      ferryEvidence: null,
    })),
    home: {
      start: { offered: true, defaultOn: true, station: stations[0] },
      end: { offered: false, defaultOn: false },
      unconfirmed: false,
    },
    stations,
    photoStation: new Map(stations.map((s) => [s.key, s.key] as const)),
    stationCluster: new Map(stations.map((s) => [s.key, `${s.key}-cluster`] as const)),
    spanMs: new Map(stations.map((s) => [s.key, { firstMs: startMs, lastMs: endMs }] as const)),
    previewPhotoIds: new Map(stations.map((s) => [s.key, [`${s.key}-asset`]] as const)),
    passedThrough: new Map(),
  };
}

describe("routeScopeOf", () => {
  const input = (target: ScanInput["target"]): ScanInput => ({
    name: "Northvale loop",
    startDay: "2031-05-02",
    endDay: "2031-05-09",
    inspect: true,
    createAlbum: false,
    target,
  });

  it("is the route of a route-scoped existing target", () => {
    expect(routeScopeOf(input({ kind: "existing", tripId: TRIP, routeId: ROUTE }))).toEqual({
      tripId: TRIP,
      routeId: ROUTE,
    });
  });

  it("is null for a new trip and for the journey-wide re-sync", () => {
    expect(routeScopeOf(input({ kind: "new" }))).toBeNull();
    expect(routeScopeOf(input({ kind: "existing", tripId: TRIP }))).toBeNull();
  });
});

describe("mergeAreaPlans", () => {
  const first = plan("2031-05-02#1", "2031-05-02", "2031-05-03", 100, 200, [
    station("a1", -45.05, 168.7, "2031-05-02"),
    station("a2", -44.7, 169.15, "2031-05-03"),
  ]);
  const second = plan("2031-05-05#1", "2031-05-05", "2031-05-06", 300, 400, [
    station("b1", -45.42, 168.52, "2031-05-05"),
    station("b2", -45.2, 169.4, "2031-05-06"),
  ]);

  it("is the stations of every plan in travel order, with a straight road leg joining the boundary", () => {
    const merged = mergeAreaPlans([second, first]);
    expect(merged.key).toBe("2031-05-02#1");
    expect(merged.stations.map((s) => s.key)).toEqual(["a1", "a2", "b1", "b2"]);
    expect(merged.legs.map((leg) => [leg.fromKey, leg.toKey])).toEqual([
      ["a1", "a2"],
      ["a2", "b1"],
      ["b1", "b2"],
    ]);
    const boundary = merged.legs[1];
    expect(boundary.mode).toBe("road");
    expect(boundary.routedKm).toBeNull();
    expect(boundary.ferryEvidence).toBeNull();
    expect(boundary.chordKm).toBeGreaterThan(0);
  });

  it("spans the first plan's start to the last plan's end, with the outer flight edges and home ends", () => {
    const merged = mergeAreaPlans([first, second]);
    expect(merged.area.startMs).toBe(100);
    expect(merged.area.endMs).toBe(400);
    expect(merged.area.startDay).toBe("2031-05-02");
    expect(merged.area.endDay).toBe("2031-05-06");
    expect(merged.area.afterFlightId).toBe("2031-05-02#1-in");
    expect(merged.area.beforeFlightId).toBe("2031-05-05#1-out");
    expect(merged.area.photoIds).toEqual(["2031-05-02#1-photo", "2031-05-05#1-photo"]);
    expect(merged.home.start.station?.key).toBe("a1");
    expect(merged.home.end.offered).toBe(false);
  });

  it("carries every plan's lookup maps, and concatenates same-day passed-through chips", () => {
    const withChips = {
      ...second,
      passedThrough: new Map([
        ["2031-05-05", [{ title: "Kelmore", firstLocal: "2031-05-05 09:00", photoCount: 2 }]],
      ]),
    };
    const merged = mergeAreaPlans([
      {
        ...first,
        passedThrough: new Map([
          ["2031-05-05", [{ title: "Northvale", firstLocal: "2031-05-05 08:00", photoCount: 1 }]],
        ]),
      },
      withChips,
    ]);
    expect([...merged.photoStation.keys()]).toEqual(["a1", "a2", "b1", "b2"]);
    expect([...merged.spanMs.keys()]).toEqual(["a1", "a2", "b1", "b2"]);
    expect(merged.passedThrough.get("2031-05-05")?.map((chip) => chip.title)).toEqual([
      "Northvale",
      "Kelmore",
    ]);
  });

  it("refuses nothing to merge", () => {
    expect(() => mergeAreaPlans([])).toThrow("Cannot merge no plans");
  });
});

describe("withoutStations", () => {
  const stations = [
    station("nv", -45.05, 168.7, "2031-05-02"),
    station("sb", -45.45, 169.1, "2031-05-05"),
    station("ts", -45.2, 169.4, "2031-05-07"),
  ];
  const legs = stations.slice(1).map((s, i) => ({
    fromKey: stations[i].key,
    toKey: s.key,
    chordKm: 12 + i,
    routedKm: 15 + i,
    mode: "ferry" as const,
    ferryEvidence: "seaPhotos" as const,
  }));
  const area = (): DraftArea => ({
    key: "2031-05-02#1",
    defaultAs: "roadtrip",
    suggestedName: "Northvale loop",
    mainCity: "Northvale",
    startDay: "2031-05-02",
    endDay: "2031-05-09",
    home: {
      start: { offered: false, defaultOn: false },
      end: { offered: false, defaultOn: false },
      unconfirmed: false,
    },
    stations,
    legs,
  });

  it("is the area unchanged when nothing is dropped", () => {
    const before = area();
    expect(withoutStations(before, new Set())).toBe(before);
  });

  it("joins the neighbours a dropped middle stop left adjacent by a straight road leg", () => {
    const kept = withoutStations(area(), new Set(["sb"]));
    expect(kept.stations.map((s) => s.key)).toEqual(["nv", "ts"]);
    expect(kept.legs).toHaveLength(1);
    expect(kept.legs[0]).toMatchObject({
      fromKey: "nv",
      toKey: "ts",
      routedKm: null,
      mode: "road",
      ferryEvidence: null,
    });
    expect(kept.legs[0].chordKm).toBeGreaterThan(0);
  });

  it("keeps the legs between stations that stay adjacent, and drops the one a last stop carried", () => {
    const kept = withoutStations(area(), new Set(["ts"]));
    expect(kept.stations.map((s) => s.key)).toEqual(["nv", "sb"]);
    expect(kept.legs).toEqual([legs[0]]);
  });
});
