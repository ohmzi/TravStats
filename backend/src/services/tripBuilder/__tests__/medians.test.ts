import { median, medianLongitude, medianPoint } from "../medians";

describe("median", () => {
  it("takes the middle of an odd count and the mean of the middle two of an even one", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("is not dragged by a stray value", () => {
    expect(median([1, 2, 3, 4, 1000])).toBe(3);
  });

  it("refuses an empty list rather than answer NaN", () => {
    expect(() => median([])).toThrow("median of no values");
    expect(() => medianLongitude([])).toThrow("median of no values");
  });
});

describe("medianLongitude", () => {
  it("is the plain median away from the antimeridian", () => {
    expect(medianLongitude([168.7, 168.71, 168.69])).toBe(168.7);
  });

  it("meets at 180° when the values straddle the antimeridian", () => {
    const lon = medianLongitude([179.9, 179.95, -179.95, -179.9]);
    expect(Math.abs(lon)).toBeCloseTo(180, 1);
  });
});

describe("medianPoint", () => {
  it("takes the median of each axis separately", () => {
    expect(
      medianPoint([
        { lat: -45.0, lon: 168.9 },
        { lat: -45.2, lon: 168.5 },
        { lat: -45.1, lon: 168.7 },
      ])
    ).toEqual({ lat: -45.1, lon: 168.7 });
  });
});
