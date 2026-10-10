import { areaKeyOf, keyAreas } from "../areas";
import { groundArea } from "./planFixtures";

describe("areaKeyOf", () => {
  it("joins the start day and the ordinal with #", () => {
    expect(areaKeyOf("2031-05-02", 1)).toBe("2031-05-02#1");
  });
});

describe("keyAreas", () => {
  it("counts from 1 among the areas that start on the same day, in order", () => {
    const parts = [
      { area: groundArea({ startDay: "2031-05-02" }) },
      { area: groundArea({ startDay: "2031-05-02" }) },
      { area: groundArea({ startDay: "2031-05-06" }) },
      { area: groundArea({ startDay: "2031-05-02" }) },
    ];
    expect(keyAreas(parts).map((part) => part.key)).toEqual([
      "2031-05-02#1",
      "2031-05-02#2",
      "2031-05-06#1",
      "2031-05-02#3",
    ]);
  });

  it("keeps whatever else a part carries, and leaves the input as it was", () => {
    const parts = [{ area: groundArea(), segments: ["s1"] }];
    const [keyed] = keyAreas(parts);
    expect(keyed.segments).toEqual(["s1"]);
    expect(keyed.area).toBe(parts[0].area);
    expect("key" in parts[0]).toBe(false);
  });

  it("makes keys the commit schema's pattern accepts", () => {
    const [keyed] = keyAreas([{ area: groundArea({ startDay: "2031-12-31" }) }]);
    expect(keyed.key).toMatch(/^\d{4}-\d{2}-\d{2}#\d+$/);
  });

  it("keys no areas at all", () => {
    expect(keyAreas([])).toEqual([]);
  });
});
