import { counterOf, flagStragglers } from "../clean";
import type { PhotoPoint } from "../types";
import { makePhoto, PORT_CARROW, type PhotoInput } from "./photoFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.

const pad = (n: number): string => String(n).padStart(4, "0");

/** The iPhone photo IMG_<n> at `local` NZST. */
function shot(n: number, local: string, over: PhotoInput = {}): PhotoPoint {
  return makePhoto({ id: `img-${pad(n)}`, originalFileName: `IMG_${pad(n)}.HEIC`, local, ...over });
}

/** IMG_<from> … IMG_<to>, a minute apart from 10:00 on `day`. */
function run(from: number, to: number, day: string): PhotoPoint[] {
  return Array.from({ length: to - from + 1 }, (_, i) =>
    shot(from + i, `${day} 10:${String(i).padStart(2, "0")}`)
  );
}

describe("counterOf", () => {
  it("reads an iPhone counter, edited copies included", () => {
    expect(counterOf("IMG_4512.HEIC")).toBe(4512);
    expect(counterOf("IMG_E4512.JPG")).toBe(4512);
    expect(counterOf("img_0007.jpg")).toBe(7);
  });

  it("is not fooled by a dated Android name or any other name", () => {
    expect(counterOf("IMG_20310503_142233.jpg")).toBeNull();
    expect(counterOf("PXL_20310503_022233456.jpg")).toBeNull();
    expect(counterOf("Screenshot_0001.png")).toBeNull();
    expect(counterOf("IMG_451.HEIC")).toBeNull();
  });
});

describe("flagStragglers", () => {
  // Ten shots on 3 May; their median instant is 10:04:30 NZST.
  const home = run(4510, 4519, "2031-05-03");

  it("flags a photo more than 3 days from its counter neighbours", () => {
    const late = shot(4520, "2031-05-07 10:00", { ...PORT_CARROW });
    expect([...flagStragglers([...home, late], [])]).toEqual([late.id]);
  });

  it("leaves a photo at most 3 days from them", () => {
    const near = shot(4520, "2031-05-06 10:04");
    expect(flagStragglers([...home, near], []).size).toBe(0);
  });

  it("does not judge a photo with fewer than five neighbours", () => {
    const late = shot(4514, "2031-05-07 10:00");
    expect(flagStragglers([...run(4510, 4513, "2031-05-03"), late], []).size).toBe(0);
  });

  it("counts the context days around the window as neighbours", () => {
    const late = shot(4520, "2031-05-07 10:00");
    expect([...flagStragglers([late], home)]).toEqual([late.id]);
  });

  it("only counts neighbours from the same camera model", () => {
    const otherPhone = home.map((p) => ({ ...p, model: "iPhone 12" }));
    const late = shot(4520, "2031-05-07 10:00");
    expect(flagStragglers([...otherPhone, late], []).size).toBe(0);
  });

  it("judges only located, unique photos, but lets any photo be a neighbour", () => {
    const unlocatedHome = home.map((p) => ({ ...p, flags: { ...p.flags, located: false } }));
    const late = shot(4520, "2031-05-07 10:00");
    const lateUnlocated = shot(4521, "2031-05-07 10:01", { flags: { located: false } });
    const lateDuplicate = shot(4522, "2031-05-07 10:02", { flags: { duplicate: true } });
    expect([...flagStragglers([...unlocatedHome, late, lateUnlocated, lateDuplicate], [])]).toEqual(
      [late.id]
    );
  });

  it("lets counters wrap from 9999 to 0000 between photos close in time", () => {
    const after = shot(4, "2031-05-07 10:00");
    expect([...flagStragglers([...run(9990, 9999, "2031-05-03"), after], [])]).toEqual([after.id]);
  });

  it("does not wrap between photos more than 30 days apart: two phones of one model", () => {
    const oldPhone = run(9985, 9999, "2031-05-02");
    const newPhone = run(1, 5, "2031-06-25");
    expect(flagStragglers([...oldPhone, ...newPhone], []).size).toBe(0);
  });
});
