import { cleanAssets, hasGps, isMovementPhoto, markPhotos } from "../clean";
import type { PhotoPoint } from "../types";
import { scanWindow } from "../window";
import { makePhoto, OWNER, PARTNER } from "./photoFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.

const WINDOW = scanWindow("2031-05-02", "2031-05-09");
const clean = (photos: PhotoPoint[]) => cleanAssets(photos, { ownerId: OWNER, window: WINDOW });
const ids = (photos: readonly PhotoPoint[]) => photos.map((p) => p.id);

describe("hasGps", () => {
  it("reads a real fix as GPS", () => {
    expect(hasGps(-45.05, 168.7)).toBe(true);
  });

  it("reads a missing coordinate as no GPS", () => {
    expect(hasGps(null, 168.7)).toBe(false);
    expect(hasGps(-45.05, null)).toBe(false);
  });

  it("reads 0,0 and anything within 1e-6 of it as no GPS", () => {
    expect(hasGps(0, 0)).toBe(false);
    expect(hasGps(5e-7, -5e-7)).toBe(false);
  });

  it("keeps a real fix on the equator or the prime meridian", () => {
    expect(hasGps(0, 168.7)).toBe(true);
    expect(hasGps(-45.05, 0)).toBe(true);
  });

  it("refuses a coordinate off the globe", () => {
    expect(hasGps(91, 168.7)).toBe(false);
    expect(hasGps(-45.05, 181)).toBe(false);
    expect(hasGps(Number.NaN, 168.7)).toBe(false);
  });
});

describe("cleanAssets", () => {
  it("drops a partner's photo and one without an owner, and counts both", () => {
    const result = clean([
      makePhoto({ id: "own" }),
      makePhoto({ id: "partner", ownerId: PARTNER }),
      makePhoto({ id: "orphan", ownerId: null }),
    ]);
    expect(ids(result.photos)).toEqual(["own"]);
    expect(result.albumAssetIds).toEqual(["own"]);
    expect(result.excluded.partner).toBe(2);
  });

  it("counts a partner's hidden asset once, as the partner's", () => {
    const result = clean([
      makePhoto({ id: "partner-motion", ownerId: PARTNER, visibility: "hidden" }),
    ]);
    expect(result.excluded).toMatchObject({ partner: 1, hiddenLivePart: 0 });
  });

  it("drops the hidden motion half of a Live Photo and keeps an archived photo", () => {
    const result = clean([
      makePhoto({ id: "still", local: "2031-05-03 12:00" }),
      makePhoto({ id: "motion", type: "VIDEO", visibility: "hidden", local: "2031-05-03 12:00" }),
      makePhoto({ id: "archived", visibility: "archive", local: "2031-05-03 12:05" }),
    ]);
    expect(result.albumAssetIds).toEqual(["still", "archived"]);
    expect(result.excluded.hiddenLivePart).toBe(1);
  });

  it("keeps S and E by the photo's own day and hands the rest to the context", () => {
    const result = clean([
      makePhoto({ id: "before", local: "2031-05-01 23:59" }),
      makePhoto({ id: "first", local: "2031-05-02 00:00" }),
      makePhoto({ id: "last", local: "2031-05-09 23:59" }),
      makePhoto({ id: "after", local: "2031-05-10 00:00" }),
    ]);
    expect(ids(result.photos)).toEqual(["first", "last"]);
    expect(ids(result.context)).toEqual(["before", "after"]);
    expect(result.albumAssetIds).toEqual(["first", "last"]);
  });

  it("orders the photos by instant, not by their wall clocks", () => {
    // 09:00 at UTC−4 is 13:00Z; 20:00 NZST the same day is 08:00Z.
    const result = clean([
      makePhoto({
        id: "west",
        local: "2031-05-03 09:00",
        tMs: Date.parse("2031-05-03T13:00:00Z"),
        zone: "America/La_Paz",
      }),
      makePhoto({ id: "east", local: "2031-05-03 20:00" }),
    ]);
    expect(ids(result.photos)).toEqual(["east", "west"]);
  });

  it("keeps a photo with no GPS or with 0,0 in the album, but not as located", () => {
    const result = clean([
      makePhoto({ id: "fix", local: "2031-05-03 12:00" }),
      makePhoto({ id: "none", lat: null, lon: null, local: "2031-05-03 12:01" }),
      makePhoto({ id: "zero", lat: 0, lon: 0, local: "2031-05-03 12:02" }),
    ]);
    expect(result.albumAssetIds).toEqual(["fix", "none", "zero"]);
    expect(result.photos.map((p) => p.flags.located)).toEqual([true, false, false]);
    expect(result.excluded.unlocated).toBe(2);
  });

  it("keeps one movement photo per duplicate group, a located copy first", () => {
    const result = clean([
      makePhoto({
        id: "copy-no-gps",
        duplicateId: "dup-1",
        lat: null,
        lon: null,
        local: "2031-05-03 12:00",
      }),
      makePhoto({ id: "copy-a", duplicateId: "dup-1", local: "2031-05-03 12:01" }),
      makePhoto({ id: "copy-b", duplicateId: "dup-1", local: "2031-05-03 12:02" }),
      makePhoto({ id: "single", local: "2031-05-03 12:03" }),
    ]);
    const duplicate = Object.fromEntries(result.photos.map((p) => [p.id, p.flags.duplicate]));
    expect(duplicate).toEqual({
      "copy-no-gps": true,
      "copy-a": false,
      "copy-b": true,
      single: false,
    });
    expect(result.albumAssetIds).toHaveLength(4);
  });

  it("keeps the first copy when no copy of a group is located", () => {
    const result = clean([
      makePhoto({
        id: "later",
        duplicateId: "dup-2",
        lat: null,
        lon: null,
        local: "2031-05-03 12:05",
      }),
      makePhoto({
        id: "earlier",
        duplicateId: "dup-2",
        lat: null,
        lon: null,
        local: "2031-05-03 12:00",
      }),
    ]);
    expect(result.photos.map((p) => [p.id, p.flags.duplicate])).toEqual([
      ["earlier", false],
      ["later", true],
    ]);
  });

  it("counts the in-window photos whose day was guessed", () => {
    const result = clean([
      makePhoto({ id: "guessed", flags: { dayGuessed: true } }),
      makePhoto({ id: "outside", local: "2031-05-20 12:00", flags: { dayGuessed: true } }),
      makePhoto({ id: "sure", local: "2031-05-03 12:01" }),
    ]);
    expect(result.excluded.dayGuessed).toBe(1);
  });

  it("leaves the counts that later steps own at zero", () => {
    expect(clean([makePhoto()]).excluded).toEqual({
      partner: 0,
      hiddenLivePart: 0,
      misdated: 0,
      inFlight: 0,
      atSea: 0,
      unlocated: 0,
      dayGuessed: 0,
    });
  });

  it("never changes the photos it was given", () => {
    const given = [
      makePhoto({ id: "a", lat: 0, lon: 0, duplicateId: "dup-3" }),
      makePhoto({ id: "b", duplicateId: "dup-3", local: "2031-05-03 12:01" }),
    ];
    clean(given);
    expect(given.map((p) => [p.flags.located, p.flags.duplicate])).toEqual([
      [true, false],
      [true, false],
    ]);
  });
});

describe("isMovementPhoto", () => {
  it("takes a located, unique, well-dated photo on the ground", () => {
    expect(isMovementPhoto(makePhoto())).toBe(true);
  });

  it.each([
    ["unlocated", { located: false }],
    ["a duplicate", { duplicate: true }],
    ["misdated", { misdated: "straggler" as const }],
    ["at sea", { atSea: true }],
    ["in flight", { inFlight: true }],
    ["on a layover", { layover: true }],
  ])("leaves out a photo that is %s", (_label, flags) => {
    expect(isMovementPhoto(makePhoto({ flags }))).toBe(false);
  });
});

describe("markPhotos", () => {
  it("merges each patch into its photo's flags and leaves the rest as they were", () => {
    const photos = [makePhoto({ id: "a" }), makePhoto({ id: "b" })];
    const marked = markPhotos(photos, new Map([["b", { inFlight: true }]]));
    expect(marked.map((p) => p.flags.inFlight)).toEqual([false, true]);
    expect(photos[1].flags.inFlight).toBe(false);
    expect(marked[0]).toBe(photos[0]);
  });
});
