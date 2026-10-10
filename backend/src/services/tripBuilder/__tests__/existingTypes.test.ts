import {
  hasTravstatsMarker,
  isSleptNight,
  NOT_SEEN_REASONS,
  STATION_STATUSES,
  TRAVSTATS_ALBUM_MARKER,
} from "../existingTypes";

describe("re-sync vocabulary", () => {
  it("knows exactly four station statuses", () => {
    expect(STATION_STATUSES).toEqual(["same", "changed", "new", "notSeen"]);
  });

  it("knows why a stored station was not seen", () => {
    expect(NOT_SEEN_REASONS).toEqual(["outsideWindow", "notInPhotos"]);
  });

  it("counts a stay and a free night as slept, a pass and a route correction as not", () => {
    expect(isSleptNight("stay")).toBe(true);
    expect(isSleptNight("free")).toBe(true);
    expect(isSleptNight("pass")).toBe(false);
    expect(isSleptNight("via")).toBe(false);
  });

  it("recognises the description TravStats writes into an album it creates", () => {
    expect(TRAVSTATS_ALBUM_MARKER).toBe("TravStats trip ·");
    expect(hasTravstatsMarker("TravStats trip · 2031-05-02 – 2031-05-09")).toBe(true);
    expect(hasTravstatsMarker("Our holiday")).toBe(false);
    expect(hasTravstatsMarker("")).toBe(false);
    expect(hasTravstatsMarker(null)).toBe(false);
    expect(hasTravstatsMarker(undefined)).toBe(false);
  });
});
