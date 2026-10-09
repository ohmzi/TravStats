import { flagFilenameClocks } from "../clean";
import { makePhoto } from "./photoFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.

describe("flagFilenameClocks", () => {
  it("leaves a Samsung photo whose name matches its local clock", () => {
    const p = makePhoto({
      id: "s",
      originalFileName: "20310503_142233.jpg",
      local: "2031-05-03 14:22",
      make: "samsung",
      model: "SM-S921B",
    });
    expect(flagFilenameClocks([p]).size).toBe(0);
  });

  it("flags a Samsung photo more than 36 h from its name, and not one just inside", () => {
    const out = makePhoto({
      id: "out",
      originalFileName: "20310503_142233.jpg",
      local: "2031-05-05 02:23",
    });
    const inside = makePhoto({
      id: "inside",
      originalFileName: "20310503_142233.jpg",
      local: "2031-05-05 02:22",
    });
    expect([...flagFilenameClocks([out, inside])]).toEqual(["out"]);
  });

  it("reads a Pixel name as UTC and holds it against the instant", () => {
    // 02:22 UTC is 14:22 NZST: the first name and its photo agree.
    const ok = makePhoto({
      id: "ok",
      originalFileName: "PXL_20310503_022233456.jpg",
      local: "2031-05-03 14:22",
    });
    const off = makePhoto({
      id: "off",
      originalFileName: "PXL_20310501_022233456.jpg",
      local: "2031-05-03 14:22",
    });
    expect([...flagFilenameClocks([ok, off])]).toEqual(["off"]);
  });

  it("holds a Pixel name against the instant, not against the wall clock read as UTC", () => {
    // Both photos were taken at 14:22 NZST on 3 May, which is 02:22 UTC. The zone is 12 h
    // ahead of UTC, so the two readings land on opposite sides of the 36 h limit.
    // `inside`: named 15:00 UTC on 1 May, 35 h 22 m before the instant (47 h 22 m before
    // the wall clock read as UTC).
    const inside = makePhoto({
      id: "inside",
      originalFileName: "PXL_20310501_150000123.jpg",
      local: "2031-05-03 14:22",
    });
    // `outside`: named 20:00 UTC on 4 May, 41 h 38 m after the instant (29 h 38 m after
    // the wall clock read as UTC).
    const outside = makePhoto({
      id: "outside",
      originalFileName: "PXL_20310504_200000123.jpg",
      local: "2031-05-03 14:22",
    });
    expect([...flagFilenameClocks([inside, outside])]).toEqual(["outside"]);
  });

  it("ignores a stamp that names no real time", () => {
    const p = makePhoto({
      id: "x",
      originalFileName: "20311340_250000.jpg",
      local: "2031-05-03 14:22",
    });
    expect(flagFilenameClocks([p]).size).toBe(0);
  });

  it("ignores a name without a stamp", () => {
    const photos = [
      makePhoto({ id: "iphone", originalFileName: "IMG_0001.HEIC" }),
      makePhoto({ id: "shot", originalFileName: "Screenshot_20310501-142233.png" }),
    ];
    expect(flagFilenameClocks(photos).size).toBe(0);
  });

  it("judges only located, unique photos", () => {
    const unlocated = makePhoto({
      id: "u",
      originalFileName: "20310501_142233.jpg",
      flags: { located: false },
    });
    const duplicate = makePhoto({
      id: "d",
      originalFileName: "20310501_142233.jpg",
      flags: { duplicate: true },
    });
    expect(flagFilenameClocks([unlocated, duplicate]).size).toBe(0);
  });
});
