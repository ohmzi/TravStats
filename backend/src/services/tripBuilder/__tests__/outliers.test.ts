import { distanceKm } from "../../photoJourneys/cluster";
import { clusterCities, clusterOfPhoto } from "../cityClusters";
import { dropFarOutliers } from "../outliers";
import { OUTLIER_MAX_SHARE, OUTLIER_MIN_KM } from "../thresholds";
import type { CityCluster, PhotoPoint } from "../types";
import { NORTHVALE, makePhoto } from "./photoFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.

/** Degrees of latitude one kilometre is worth, on `distanceKm`'s sphere. */
const DEG_PER_KM = 180 / (Math.PI * 6371);

/** A place `km` due north of Northvale: the distance is exact on a meridian. */
const northOf = (km: number) => ({ lat: NORTHVALE.lat + km * DEG_PER_KM, lon: NORTHVALE.lon });

/** `count` photos at `place`, one hour apart from 10:00 NZST on 3 May 2031. */
function photosAt(id: string, place: { lat: number; lon: number }, count: number): PhotoPoint[] {
  return Array.from({ length: count }, (_, i) =>
    makePhoto({
      id: `${id}-${i + 1}`,
      lat: place.lat,
      lon: place.lon,
      local: `2031-05-03 ${String(10 + i).padStart(2, "0")}:00`,
    })
  );
}

function clustersOf(photos: readonly PhotoPoint[]): {
  clusters: CityCluster[];
  clusterOf: ReadonlyMap<string, string>;
  byId: ReadonlyMap<string, CityCluster>;
} {
  const clusters = clusterCities(photos);
  return {
    clusters,
    clusterOf: clusterOfPhoto(clusters),
    byId: new Map(clusters.map((c) => [c.id, c] as const)),
  };
}

const run = (photos: readonly PhotoPoint[]) => {
  const { clusterOf, byId } = clustersOf(photos);
  return dropFarOutliers(photos, clusterOf, byId);
};

const ids = (photos: readonly PhotoPoint[]) => photos.map((p) => p.id);

describe("dropFarOutliers", () => {
  it("ignores a handful of photos in a far city, and keeps the stay's own bulk", () => {
    const bulk = photosAt("home", NORTHVALE, 40);
    const handful = photosAt("far", northOf(OUTLIER_MIN_KM + 100), 2);
    const photos = [...bulk, ...handful];

    const { kept, dropped } = run(photos);

    expect(ids(kept)).toEqual(ids(bulk));
    expect(ids(dropped)).toEqual(ids(handful));
  });

  it("keeps two comparable clusters of a real drive untouched", () => {
    const first = photosAt("first", NORTHVALE, 12);
    const second = photosAt("second", northOf(OUTLIER_MIN_KM + 400), 8);
    // The far cluster is comparably sized: a stop, not an outlier.
    const photos = [...first, ...second];

    const { kept, dropped } = run(photos);

    expect(ids(kept)).toEqual(ids(photos));
    expect(dropped).toEqual([]);
  });

  it("leaves an area with no far cluster alone", () => {
    const near = [...photosAt("a", NORTHVALE, 6), ...photosAt("b", northOf(20), 5)];

    const { kept, dropped } = run(near);

    expect(ids(kept)).toEqual(ids(near));
    expect(dropped).toEqual([]);
  });

  it("keeps a small far cluster once its share reaches the threshold", () => {
    // 5 of 100 photos is exactly OUTLIER_MAX_SHARE: a stop.
    const bulk = photosAt("home", NORTHVALE, 95);
    const far = photosAt("far", northOf(OUTLIER_MIN_KM + 100), 5);
    expect(far.length / (bulk.length + far.length)).toBe(OUTLIER_MAX_SHARE);

    const { kept, dropped } = run([...bulk, ...far]);

    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(100);
  });

  it("drops a far cluster just under the share threshold", () => {
    const bulk = photosAt("home", NORTHVALE, 96);
    const far = photosAt("far", northOf(OUTLIER_MIN_KM + 100), 4);

    const { kept, dropped } = run([...bulk, ...far]);

    expect(ids(dropped)).toEqual(ids(far));
    expect(ids(kept)).toEqual(ids(bulk));
  });

  it("keeps a small cluster just inside the distance threshold", () => {
    const bulk = photosAt("home", NORTHVALE, 98);
    const near = photosAt("near", northOf(OUTLIER_MIN_KM - 0.2), 2);
    expect(distanceKm(NORTHVALE, near[0])).toBeLessThan(OUTLIER_MIN_KM);

    const { kept, dropped } = run([...bulk, ...near]);

    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(100);
  });

  it("drops a small cluster just beyond the distance threshold", () => {
    const bulk = photosAt("home", NORTHVALE, 98);
    const far = photosAt("far", northOf(OUTLIER_MIN_KM + 0.2), 2);
    expect(distanceKm(NORTHVALE, far[0])).toBeGreaterThan(OUTLIER_MIN_KM);

    const { kept, dropped } = run([...bulk, ...far]);

    expect(ids(dropped)).toEqual(ids(far));
    expect(ids(kept)).toEqual(ids(bulk));
  });

  it("measures the far cluster against the area's main cluster, not the whole globe", () => {
    // Two mid-sized clusters near each other, one handful far from both: only
    // the handful goes.
    const a = photosAt("a", NORTHVALE, 30);
    const b = photosAt("b", northOf(60), 20);
    const far = photosAt("far", northOf(OUTLIER_MIN_KM + 300), 2);

    const { kept, dropped } = run([...a, ...b, ...far]);

    expect(ids(kept)).toEqual(ids([...a, ...b]));
    expect(ids(dropped)).toEqual(ids(far));
  });

  it("returns everything when every photo sits in one cluster", () => {
    const photos = photosAt("only", NORTHVALE, 7);

    const { kept, dropped } = run(photos);

    expect(ids(kept)).toEqual(ids(photos));
    expect(dropped).toEqual([]);
  });
});
