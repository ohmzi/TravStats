import { coordOf, corridorFix, isStationary } from "../flightGeometry";

describe("corridorFix", () => {
  // A track along the equator makes the expected numbers exact: 1° is 111.195 km.
  const start = { lat: 0, lon: 0 };
  const end = { lat: 0, lon: 10 };

  it("measures how far a point lies off the track and how far along it", () => {
    const fix = corridorFix(start, end, { lat: 0.2, lon: 5 });
    expect(fix.crossKm).toBeCloseTo(22.24, 1);
    expect(fix.alongKm).toBeCloseTo(555.97, 1);
    expect(fix.lengthKm).toBeCloseTo(1111.95, 1);
  });

  it("measures the same distance off the track on either side", () => {
    expect(corridorFix(start, end, { lat: -0.2, lon: 5 }).crossKm).toBeCloseTo(22.24, 1);
  });

  it("puts a point behind the departure at a negative distance along", () => {
    const fix = corridorFix(start, end, { lat: 0, lon: -1 });
    expect(fix.alongKm).toBeCloseTo(-111.19, 1);
    expect(fix.crossKm).toBeCloseTo(0, 1);
  });

  it("puts a point beyond the arrival further along than the track is long", () => {
    const fix = corridorFix(start, end, { lat: 0, lon: 12 });
    expect(fix.alongKm).toBeCloseTo(1334.34, 1);
    expect(fix.alongKm).toBeGreaterThan(fix.lengthKm);
  });

  it("puts the departure itself at the start of the track", () => {
    const fix = corridorFix(start, end, start);
    expect(fix.crossKm).toBeCloseTo(0, 6);
    expect(fix.alongKm).toBeCloseTo(0, 6);
  });
});

describe("coordOf", () => {
  it("returns the position of a located photo", () => {
    expect(coordOf({ lat: -45.05, lon: 168.7 })).toEqual({ lat: -45.05, lon: 168.7 });
  });

  it("returns null when either coordinate is missing", () => {
    expect(coordOf({ lat: null, lon: 168.7 })).toBeNull();
    expect(coordOf({ lat: -45.05, lon: null })).toBeNull();
  });
});

describe("isStationary", () => {
  const MINUTE = 60_000;
  const origin = Date.parse("2031-05-03T00:00:00Z");
  const shot = (minutes: number, lat: number, lon: number) => ({
    tMs: origin + minutes * MINUTE,
    lat,
    lon,
  });

  // Half a kilometre apart, half an hour long: someone standing in a town.
  const a = shot(0, -44.25, 170.63);
  const b = shot(15, -44.255, 170.635);
  const c = shot(30, -44.252, 170.632);

  it("recognises three photos within 2 km over at least 20 minutes", () => {
    expect(isStationary(a, [a, b, c])).toBe(true);
    expect(isStationary(b, [a, b, c])).toBe(true);
    expect(isStationary(c, [a, b, c])).toBe(true);
  });

  it("needs three photos", () => {
    expect(isStationary(a, [a, b])).toBe(false);
  });

  it("needs the photos to span 20 minutes", () => {
    const quick = shot(10, -44.252, 170.632);
    expect(isStationary(a, [a, b, quick])).toBe(false);
  });

  it("does not count a photo more than 2 km away", () => {
    const far = shot(30, -44.22, 170.63);
    expect(isStationary(a, [a, b, far])).toBe(false);
  });

  it("never calls an unlocated photo stationary", () => {
    expect(isStationary({ tMs: origin, lat: null, lon: null }, [a, b, c])).toBe(false);
  });
});
