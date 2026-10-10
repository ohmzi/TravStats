import { buildSegments, classifySegments } from "../segments";
import { walk, type Step } from "./placeFixtures";

function classify(steps: readonly Step[]) {
  const { photos, clusterOf, byId } = walk(steps);
  return classifySegments(buildSegments(photos, clusterOf), byId);
}

describe("classifySegments: visit or brief", () => {
  it("calls a stay of 6 hours a visit and one minute less brief", () => {
    expect(
      classify([
        ["a", "2031-05-05 09:00", "cA"],
        ["b", "2031-05-05 15:00", "cA"],
      ]).map((s) => s.role)
    ).toEqual(["visit"]);
    expect(
      classify([
        ["a", "2031-05-05 09:00", "cA"],
        ["b", "2031-05-05 14:59", "cA"],
      ]).map((s) => s.role)
    ).toEqual(["brief"]);
  });
});

describe("classifySegments: excursions", () => {
  // A all of 05-04 evening and 05-05 morning, a day trip to B, then back to A.
  const dayTrip: readonly Step[] = [
    ["a1", "2031-05-04 16:00", "cA"],
    ["a2", "2031-05-05 11:00", "cA"],
    ["b1", "2031-05-05 12:00", "cB"],
    ["b2", "2031-05-05 15:30", "cB"],
    ["a3", "2031-05-05 17:00", "cA"],
    ["a4", "2031-05-05 21:30", "cA"],
  ];

  it("marks a short trip out of a base and back as an excursion from that base", () => {
    const segments = classify(dayTrip);
    expect(segments.map((s) => s.role)).toEqual(["visit", "excursion", "brief"]);
    expect(segments.map((s) => s.excursionOf)).toEqual([null, "cA", null]);
    expect(segments.map((s) => s.holdsNight)).toEqual([true, false, true]);
  });

  it("does not fold a segment that holds the evening, however short", () => {
    const segments = classify([
      ["a1", "2031-05-05 08:00", "cA"],
      ["a2", "2031-05-05 15:00", "cA"],
      ["b1", "2031-05-05 17:00", "cB"],
      ["b2", "2031-05-05 23:30", "cB"],
      ["a3", "2031-05-06 08:00", "cA"],
      ["a4", "2031-05-06 09:00", "cA"],
    ]);
    expect(segments.map((s) => s.role)).toEqual(["visit", "visit", "brief"]);
    expect(segments[1].holdsNight).toBe(true);
  });

  it("needs strictly under 8 hours", () => {
    const segments = classify([
      ["a1", "2031-05-04 20:00", "cA"],
      ["a2", "2031-05-05 08:00", "cA"],
      ["b1", "2031-05-05 09:00", "cB"],
      ["b2", "2031-05-05 17:00", "cB"],
      ["a3", "2031-05-05 18:00", "cA"],
      ["a4", "2031-05-05 19:00", "cA"],
    ]);
    expect(segments.map((s) => s.role)).toEqual(["visit", "visit", "brief"]);
  });

  it("needs the trip to be a continuation: days apart is two stays, not a day trip", () => {
    const segments = classify([
      ["a1", "2031-05-01 10:00", "cA"],
      ["b1", "2031-05-05 10:00", "cB"],
      ["b2", "2031-05-05 14:00", "cB"],
      ["a2", "2031-05-09 10:00", "cA"],
    ]);
    expect(segments.map((s) => s.role)).toEqual(["brief", "brief", "brief"]);
  });

  it("keeps a gap of over 30 hours at one place as two segments, never an excursion", () => {
    const segments = classify([
      ["a1", "2031-05-05 09:00", "cA"],
      ["a2", "2031-05-07 09:00", "cA"],
    ]);
    expect(segments.map((s) => [s.role, s.excursionOf])).toEqual([
      ["brief", null],
      ["brief", null],
    ]);
  });
});

describe("classifySegments: transit noise", () => {
  it("drops a blip of two photos in ten minutes between two stops", () => {
    const segments = classify([
      ["a1", "2031-05-05 09:00", "cA"],
      ["a2", "2031-05-05 16:00", "cA"],
      ["t1", "2031-05-05 17:00", "cT"],
      ["t2", "2031-05-05 17:10", "cT"],
      ["c1", "2031-05-05 19:00", "cC"],
      ["c2", "2031-05-05 20:00", "cC"],
    ]);
    expect(segments.map((s) => s.role)).toEqual(["visit", "transit", "brief"]);
  });

  it("keeps a stop with 3 photos, or one that lasts 30 minutes", () => {
    const threePhotos = classify([
      ["a1", "2031-05-05 09:00", "cA"],
      ["t1", "2031-05-05 17:00", "cT"],
      ["t2", "2031-05-05 17:05", "cT"],
      ["t3", "2031-05-05 17:10", "cT"],
      ["c1", "2031-05-05 19:00", "cC"],
    ]);
    expect(threePhotos[1].role).toBe("brief");
    const thirtyMinutes = classify([
      ["a1", "2031-05-05 09:00", "cA"],
      ["t1", "2031-05-05 17:00", "cT"],
      ["t2", "2031-05-05 17:30", "cT"],
      ["c1", "2031-05-05 19:00", "cC"],
    ]);
    expect(thirtyMinutes[1].role).toBe("brief");
  });

  it("never drops the first or last segment of an area", () => {
    const segments = classify([
      ["a", "2031-05-05 09:00", "cA"],
      ["b", "2031-05-05 09:10", "cB"],
      ["c", "2031-05-05 09:20", "cC"],
    ]);
    expect(segments.map((s) => s.role)).toEqual(["brief", "transit", "brief"]);
  });

  it("is noise even between two segments of one city, and then no excursion", () => {
    const segments = classify([
      ["a1", "2031-05-05 09:00", "cA"],
      ["a2", "2031-05-05 16:00", "cA"],
      ["t1", "2031-05-05 17:00", "cT"],
      ["t2", "2031-05-05 17:10", "cT"],
      ["a3", "2031-05-05 18:00", "cA"],
      ["a4", "2031-05-05 19:00", "cA"],
    ]);
    expect(segments.map((s) => [s.role, s.excursionOf])).toEqual([
      ["visit", null],
      ["transit", null],
      ["brief", null],
    ]);
  });
});
