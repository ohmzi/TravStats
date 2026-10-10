import { claimKey, defaultStationNotes, pickPreviewIds, stationKeyOf } from "../stations";
import { NORTHVALE, photo } from "./placeFixtures";

describe("stationKeyOf", () => {
  it("rounds the median to 0.05° and appends the first day", () => {
    expect(stationKeyOf(-45.05, 168.7, "2031-05-02")).toBe("-901|3374|2031-05-02");
    expect(stationKeyOf(-45.06, 168.69, "2031-05-02")).toBe("-901|3374|2031-05-02");
    expect(stationKeyOf(-44.7, 169.15, "2031-05-04")).toBe("-894|3383|2031-05-04");
  });

  it("writes a zero the same way on both sides of it", () => {
    expect(stationKeyOf(-0.01, 0.01, "2031-05-02")).toBe("0|0|2031-05-02");
  });
});

describe("claimKey", () => {
  it("hands out the base key once and then ~2, ~3 …", () => {
    const taken = new Set<string>();
    expect(claimKey("-901|3374|2031-05-02", taken)).toBe("-901|3374|2031-05-02");
    expect(claimKey("-901|3374|2031-05-02", taken)).toBe("-901|3374|2031-05-02~2");
    expect(claimKey("-901|3374|2031-05-02", taken)).toBe("-901|3374|2031-05-02~3");
    expect([...taken]).toHaveLength(3);
  });

  it("does not collide with a key somebody else already took", () => {
    const taken = new Set(["a", "a~2"]);
    expect(claimKey("a", taken)).toBe("a~3");
  });
});

describe("defaultStationNotes", () => {
  it("reads first and last photo and the count", () => {
    expect(
      defaultStationNotes({
        firstLocal: "2031-05-04 16:00",
        lastLocal: "2031-05-05 08:30",
        photoCount: 3,
      })
    ).toBe("First photo 16:00 · last 08:30 · 3 photos");
  });

  it("says '1 photo' for one and has nothing for a station without photos of its own", () => {
    expect(
      defaultStationNotes({
        firstLocal: "2031-05-04 16:00",
        lastLocal: "2031-05-04 16:00",
        photoCount: 1,
      })
    ).toBe("First photo 16:00 · last 16:00 · 1 photo");
    expect(defaultStationNotes({ firstLocal: null, lastLocal: null, photoCount: 0 })).toBeNull();
  });
});

describe("pickPreviewIds", () => {
  const frames = (count: number, favourites: number[] = []) =>
    Array.from({ length: count }, (_, i) =>
      photo(`p${i}`, `2031-05-05 10:${String(i).padStart(2, "0")}`, NORTHVALE, {
        isFavorite: favourites.includes(i),
      })
    );

  it("returns every photo when there are few", () => {
    expect(pickPreviewIds(frames(4))).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("spreads evenly through the day when there are many", () => {
    expect(pickPreviewIds(frames(12), 4)).toEqual(["p1", "p4", "p7", "p10"]);
  });

  it("puts favourites first, then fills up with an even spread of the rest", () => {
    expect(pickPreviewIds(frames(12, [9, 2]), 4)).toEqual(["p2", "p9", "p3", "p8"]);
  });

  it("takes only favourites when there are enough, and orders unsorted input by time", () => {
    const shuffled = [...frames(6, [0, 1, 2, 3, 4, 5])].reverse();
    expect(pickPreviewIds(shuffled, 3)).toEqual(["p1", "p3", "p5"]);
  });

  it("defaults to six", () => {
    expect(pickPreviewIds(frames(20))).toHaveLength(6);
  });
});
