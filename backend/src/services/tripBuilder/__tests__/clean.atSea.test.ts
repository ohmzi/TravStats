import { distanceKm } from "../../photoJourneys/cluster";
import { flagAtSea, ringAround } from "../clean";
import { makePhoto } from "./photoFixtures";

// Synthetic fixtures only (public repository): an invented straight coastline at 45° S.

/** Land south of the coast, sea north of it: a stand-in for the 1:10m boundaries. */
const COAST_LAT = -45;
const coastline = () => jest.fn((lat: number, _lon: number) => (lat < COAST_LAT ? "NZ" : null));

describe("ringAround", () => {
  it("puts eight points 3 km out, the first due north", () => {
    const centre = { lat: -45.05, lon: 168.7 };
    const ring = ringAround(centre.lat, centre.lon, 3, 8);
    expect(ring).toHaveLength(8);
    for (const point of ring) expect(distanceKm(centre, point)).toBeCloseTo(3, 6);
    expect(ring[0].lat).toBeGreaterThan(centre.lat);
    expect(ring[0].lon).toBeCloseTo(centre.lon, 9);
  });

  it("stays on the globe across the antimeridian", () => {
    const centre = { lat: 0.5, lon: 179.99 };
    const ring = ringAround(centre.lat, centre.lon, 3, 8);
    for (const point of ring) {
      expect(point.lon).toBeGreaterThanOrEqual(-180);
      expect(point.lon).toBeLessThanOrEqual(180);
      expect(distanceKm(centre, point)).toBeCloseTo(3, 6);
    }
    expect(ring.some((point) => point.lon < 0)).toBe(true);
  });
});

describe("flagAtSea", () => {
  it("keeps a photo the boundaries put on land, after one question", () => {
    const countryAt = coastline();
    expect(flagAtSea([makePhoto({ id: "town", lat: -45.05 })], countryAt).size).toBe(0);
    expect(countryAt).toHaveBeenCalledTimes(1);
  });

  it("keeps a harbour-front photo that falls just off its country's polygon", () => {
    // 0.55 km out by the data; the ring's southern point, 3 km on, lies on land.
    expect(flagAtSea([makePhoto({ id: "quay", lat: -44.995 })], coastline()).size).toBe(0);
  });

  it("flags a deck photo with no land within 3 km, after nine questions", () => {
    const countryAt = coastline();
    expect([...flagAtSea([makePhoto({ id: "deck", lat: -44.9 })], countryAt)]).toEqual(["deck"]);
    expect(countryAt).toHaveBeenCalledTimes(9);
  });

  it("never asks about a photo without GPS", () => {
    const countryAt = coastline();
    const indoors = makePhoto({ id: "indoors", lat: null, lon: null, flags: { located: false } });
    expect(flagAtSea([indoors], countryAt).size).toBe(0);
    expect(countryAt).not.toHaveBeenCalled();
  });
});
