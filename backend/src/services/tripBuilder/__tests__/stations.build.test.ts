import { buildSegments, classifySegments } from "../segments";
import { buildStations } from "../stations";
import type { NamedCluster } from "../types";
import { NORTHVALE, PORT_CARROW, photo } from "./placeFixtures";

function named(id: string, title: string, overrides: Partial<NamedCluster> = {}): NamedCluster {
  return {
    id,
    photoIds: [],
    lat: 0,
    lon: 0,
    spreadKm: 1,
    immichCity: null,
    immichState: null,
    immichCountry: null,
    title,
    titleSource: "immich",
    isHome: false,
    ...overrides,
  };
}

const CLUSTERS = new Map([
  ["cA", named("cA", "Northvale")],
  ["cB", named("cB", "Port Carrow")],
  ["cT", named("cT", "Brookfield")],
]);

type Spot = { lat: number; lon: number };
type Spec = readonly [id: string, local: string, cluster: string, at?: Spot];

/** Photos at the specs (Northvale unless a position is given) cut and classified as one area. */
function scene(specs: readonly Spec[]) {
  const photos = specs.map(([id, local, , at]) => photo(id, local, at ?? NORTHVALE));
  const clusterOf = new Map(specs.map(([id, , cluster]) => [id, cluster] as const));
  const byId = new Map(photos.map((p) => [p.id, p] as const));
  const segments = classifySegments(buildSegments(photos, clusterOf), byId);
  return { photos, byId, segments };
}

const stationsOf = (specs: readonly Spec[], taken = new Set<string>()) => {
  const { photos, byId, segments } = scene(specs);
  const build = buildStations({ segments, clusters: CLUSTERS, photosById: byId, taken });
  return { build, photos, byId, segments };
};

describe("buildStations: one station per stop", () => {
  const specs: readonly Spec[] = [
    ["a1", "2031-05-04 16:00", "cA", { lat: -45.04, lon: 168.69 }],
    ["a2", "2031-05-04 17:00", "cA", { lat: -45.05, lon: 168.7 }],
    ["a3", "2031-05-05 08:00", "cA", { lat: -45.06, lon: 168.71 }],
  ];

  it("takes the per-axis median of the segment's photos and describes the stop", () => {
    expect(stationsOf(specs).build.stations).toEqual([
      {
        key: "-901|3374|2031-05-04",
        title: "Northvale",
        titleSource: "immich",
        kind: "visit",
        lat: -45.05,
        lon: 168.7,
        snappedKm: null,
        firstDay: "2031-05-04",
        lastDay: "2031-05-05",
        firstLocal: "2031-05-04 16:00",
        lastLocal: "2031-05-05 08:00",
        photoCount: 3,
        previewIdx: [],
        notes: "First photo 16:00 · last 08:00 · 3 photos",
      },
    ]);
  });

  it("records the span, cluster, thumbnails and the station of each photo", () => {
    const { build, photos } = stationsOf(specs);
    const key = "-901|3374|2031-05-04";
    expect(build.spanMs.get(key)).toEqual({ firstMs: photos[0].tMs, lastMs: photos[2].tMs });
    expect(build.stationCluster.get(key)).toBe("cA");
    expect(build.previewPhotoIds.get(key)).toEqual(["a1", "a2", "a3"]);
    expect([...build.photoStation]).toEqual([
      ["a1", key],
      ["a2", key],
      ["a3", key],
    ]);
  });

  it("claims keys from the scan's shared set, so a repeat gets ~2", () => {
    const taken = new Set(["-901|3374|2031-05-04"]);
    const { build } = stationsOf(specs, taken);
    expect(build.stations[0].key).toBe("-901|3374|2031-05-04~2");
    expect(taken.has("-901|3374|2031-05-04~2")).toBe(true);
  });

  it("refuses a segment whose city was never named", () => {
    const { byId, segments } = scene(specs);
    expect(() =>
      buildStations({ segments, clusters: new Map(), photosById: byId, taken: new Set() })
    ).toThrow("Segment s1 is in cluster cA, which has no name");
  });
});

describe("buildStations: excursions", () => {
  it("makes the day trip a dayTrip station that names its base, and the return a station of its own", () => {
    const { build } = stationsOf([
      ["a1", "2031-05-05 08:00", "cA"],
      ["a2", "2031-05-05 09:00", "cA"],
      ["b1", "2031-05-05 10:00", "cB", PORT_CARROW],
      ["b2", "2031-05-05 12:00", "cB", PORT_CARROW],
      ["b3", "2031-05-05 13:00", "cB", PORT_CARROW],
      ["a3", "2031-05-05 15:00", "cA"],
      ["a4", "2031-05-05 16:00", "cA"],
    ]);
    const base = "-901|3374|2031-05-05";
    expect(build.stations.map((s) => [s.key, s.kind, s.excursionOf])).toEqual([
      [base, "brief", undefined],
      ["-894|3383|2031-05-05", "dayTrip", base],
      [`${base}~2`, "brief", undefined],
    ]);
  });
});

describe("buildStations: transit noise", () => {
  const specs: readonly Spec[] = [
    ["a1", "2031-05-05 09:00", "cA"],
    ["a2", "2031-05-05 16:00", "cA"],
    ["t1", "2031-05-05 17:00", "cT"],
    ["t2", "2031-05-05 17:10", "cT"],
    ["b1", "2031-05-05 19:00", "cB", PORT_CARROW],
    ["b2", "2031-05-05 20:00", "cB", PORT_CARROW],
  ];

  it("shows the blip as a chip on its day, not as a station", () => {
    const { build } = stationsOf(specs);
    expect(build.stations.map((s) => s.title)).toEqual(["Northvale", "Port Carrow"]);
    expect([...build.passedThrough]).toEqual([
      ["2031-05-05", [{ title: "Brookfield", firstLocal: "2031-05-05 17:00", photoCount: 2 }]],
    ]);
  });

  it("maps the blip's photos to the next kept station", () => {
    const { build } = stationsOf(specs);
    const next = build.stations[1].key;
    expect(build.photoStation.get("t1")).toBe(next);
    expect(build.photoStation.get("t2")).toBe(next);
  });

  it("maps it to the previous station when nothing follows", () => {
    const { byId, segments } = scene(specs.slice(0, 4));
    const lastIsNoise = segments.map((s, i) =>
      i === segments.length - 1 ? { ...s, role: "transit" as const } : s
    );
    const build = buildStations({
      segments: lastIsNoise,
      clusters: CLUSTERS,
      photosById: byId,
      taken: new Set(),
    });
    expect(build.photoStation.get("t1")).toBe(build.stations[0].key);
  });
});

describe("buildStations: an area that is only home", () => {
  it("maps every photo to home while still making the station", () => {
    const { byId, segments } = scene([
      ["h1", "2031-05-02 09:00", "cH"],
      ["h2", "2031-05-02 18:00", "cH"],
    ]);
    const clusters = new Map([
      ["cH", named("cH", "Kelmore", { isHome: true, titleSource: "home" })],
    ]);
    const build = buildStations({ segments, clusters, photosById: byId, taken: new Set() });
    expect(build.stations).toHaveLength(1);
    expect([...build.photoStation.values()]).toEqual(["home", "home"]);
  });
});
