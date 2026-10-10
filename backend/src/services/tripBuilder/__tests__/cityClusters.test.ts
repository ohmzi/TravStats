import { distanceKm } from "../../photoJourneys/cluster";
import { cellWidthKm, clusterCities, clusterOfPhoto } from "../cityClusters";
import { NORTHVALE, PORT_CARROW, photo } from "./placeFixtures";

const at = (lat: number, lon: number) => ({ lat, lon });

describe("cellWidthKm", () => {
  it("measures a 0.27° longitude cell at its own latitude", () => {
    expect(cellWidthKm(0)).toBeCloseTo(30.02, 1);
    expect(cellWidthKm(47)).toBeCloseTo(20.48, 1);
    expect(cellWidthKm(-47)).toBeCloseTo(20.48, 1);
  });
});

describe("clusterCities: single linkage", () => {
  it("chains photos 25 km apart into one city although the ends are 50 km apart", () => {
    const clusters = clusterCities([
      photo("a", "2031-05-05 09:00", at(-45.05, 168.7)),
      photo("b", "2031-05-05 10:00", at(-44.825, 168.7)),
      photo("c", "2031-05-05 11:00", at(-44.6, 168.7)),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].photoIds).toEqual(["a", "b", "c"]);
    expect(clusters[0].spreadKm).toBeCloseTo(50.04, 0);
  });

  it("keeps Northvale and Port Carrow apart and numbers clusters by first appearance", () => {
    const clusters = clusterCities([
      photo("a", "2031-05-05 09:00", NORTHVALE),
      photo("b", "2031-05-05 12:00", PORT_CARROW),
      photo("c", "2031-05-05 18:00", NORTHVALE),
    ]);
    expect(clusters.map((c) => [c.id, c.photoIds])).toEqual([
      ["c1", ["a", "c"]],
      ["c2", ["b"]],
    ]);
  });

  it("looks more than one cell sideways at 47°N, where a cell is only 20 km wide", () => {
    // Cells 707 and 709 (11.12° and 11.46°) are two columns apart, 25.8 km away.
    const west = at(47, 11.12);
    const east = at(47, 11.46);
    expect(distanceKm(west, east)).toBeCloseTo(25.8, 0);
    expect(
      clusterCities([photo("a", "2031-05-05 09:00", west), photo("b", "2031-05-05 10:00", east)])
    ).toHaveLength(1);
  });

  it("still separates photos 37.9 km apart at 47°N", () => {
    const far = at(47, 11.62);
    expect(distanceKm(at(47, 11.12), far)).toBeCloseTo(37.9, 0);
    expect(
      clusterCities([
        photo("a", "2031-05-05 09:00", at(47, 11.12)),
        photo("b", "2031-05-05 10:00", far),
      ])
    ).toHaveLength(2);
  });

  it("links photos either side of the antimeridian and keeps the median on that side", () => {
    const clusters = clusterCities([
      photo("a", "2031-05-05 09:00", at(-16.8, 179.95)),
      photo("b", "2031-05-05 10:00", at(-16.8, -179.95)),
    ]);
    expect(clusters).toHaveLength(1);
    expect(Math.abs(clusters[0].lon)).toBeGreaterThan(179.9);
  });

  it("ignores photos with no usable position", () => {
    const clusters = clusterCities([
      photo("nogps", "2031-05-05 09:00", { lat: null, lon: null }),
      photo("zero", "2031-05-05 09:30", at(0, 0), { flags: { located: false } }),
      photo("a", "2031-05-05 10:00", NORTHVALE),
    ]);
    expect(clusters.map((c) => c.photoIds)).toEqual([["a"]]);
    expect(clusterCities([])).toEqual([]);
  });

  it("collapses a dense lattice of 1,200 photos into one city", () => {
    const lattice = Array.from({ length: 1200 }, (_, i) =>
      photo(
        `p${i}`,
        "2031-05-05 10:00",
        at(NORTHVALE.lat + Math.floor(i / 40) * 0.002, NORTHVALE.lon + (i % 40) * 0.002)
      )
    );
    expect(clusterCities(lattice)).toHaveLength(1);
  });
});

describe("clusterCities: what a cluster says about itself", () => {
  it("reports the per-axis median and Immich's majority names", () => {
    const named = (id: string, lat: number, lon: number, city: string | null) =>
      photo(id, "2031-05-05 09:00", at(lat, lon), {
        city,
        state: city === null ? null : "Westshire",
        country: "NZ",
      });
    const [cluster] = clusterCities([
      named("a", -45.04, 168.7, "Northvale"),
      named("b", -45.05, 168.71, "Northvale"),
      named("c", -45.06, 168.69, "Northvale"),
      named("d", -45.07, 168.72, "Hillside"),
      named("e", -45.03, 168.68, null),
    ]);
    expect(cluster.lat).toBeCloseTo(-45.05, 6);
    expect(cluster.lon).toBeCloseTo(168.7, 6);
    expect([cluster.immichCity, cluster.immichState, cluster.immichCountry]).toEqual([
      "Northvale",
      "Westshire",
      "NZ",
    ]);
  });

  it("averages the two middle values of an even count and has no name to report", () => {
    const [cluster] = clusterCities([
      photo("a", "2031-05-05 09:00", at(-45.0, 168.7)),
      photo("b", "2031-05-05 10:00", at(-45.1, 168.8)),
    ]);
    expect(cluster.lat).toBeCloseTo(-45.05, 6);
    expect(cluster.lon).toBeCloseTo(168.75, 6);
    expect([cluster.immichCity, cluster.immichState, cluster.immichCountry]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("maps every photo to its cluster", () => {
    const clusters = clusterCities([
      photo("a", "2031-05-05 09:00", NORTHVALE),
      photo("b", "2031-05-05 12:00", PORT_CARROW),
    ]);
    expect([...clusterOfPhoto(clusters)]).toEqual([
      ["a", "c1"],
      ["b", "c2"],
    ]);
  });
});
