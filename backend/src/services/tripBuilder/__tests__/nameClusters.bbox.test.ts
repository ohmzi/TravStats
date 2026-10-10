import { bboxOf } from "../nameClusters";
import type { CityCluster } from "../types";
import { NORTHVALE, PORT_CARROW } from "./placeFixtures";

const cluster = (id: string, at: { lat: number; lon: number }): CityCluster => ({
  id,
  photoIds: [`${id}-1`],
  lat: at.lat,
  lon: at.lon,
  spreadKm: 1,
  immichCity: null,
  immichState: null,
  immichCountry: null,
});

describe("bboxOf", () => {
  it("holds every median with the padding added on each side", () => {
    const box = bboxOf([cluster("c1", NORTHVALE), cluster("c2", PORT_CARROW)], 5);
    expect(box.minLat).toBeCloseTo(-45.095, 3);
    expect(box.maxLat).toBeCloseTo(-44.655, 3);
    expect(box.minLon).toBeCloseTo(168.636, 3);
    expect(box.maxLon).toBeCloseTo(169.214, 3);
  });

  it("is an inverted box, which contains nothing, for no clusters", () => {
    const box = bboxOf([], 5);
    expect(box.minLat).toBeGreaterThan(box.maxLat);
    expect(box.minLon).toBeGreaterThan(box.maxLon);
  });

  it("never leaves the globe", () => {
    const box = bboxOf([cluster("c1", { lat: 89.99, lon: 179.99 })], 50);
    expect([box.maxLat, box.maxLon]).toEqual([90, 180]);
  });
});
