import { buildSegments } from "../segments";
import { walk } from "./placeFixtures";

describe("buildSegments", () => {
  it("keeps one segment while the city stays and no gap passes 30 hours", () => {
    const { photos, clusterOf } = walk([
      ["a", "2031-05-05 09:00", "cA"],
      ["b", "2031-05-05 18:00", "cA"],
      ["c", "2031-05-06 23:00", "cA"],
    ]);
    expect(buildSegments(photos, clusterOf)).toEqual([
      {
        id: "s1",
        clusterId: "cA",
        photoIds: ["a", "b", "c"],
        startMs: photos[0].tMs,
        endMs: photos[2].tMs,
        firstDay: "2031-05-05",
        lastDay: "2031-05-06",
        firstLocal: "2031-05-05 09:00",
        lastLocal: "2031-05-06 23:00",
      },
    ]);
  });

  it("continues across a gap of exactly 30 hours, and splits at 30 hours and a minute", () => {
    const exact = walk([
      ["a", "2031-05-05 09:00", "cA"],
      ["b", "2031-05-06 15:00", "cA"],
    ]);
    expect(buildSegments(exact.photos, exact.clusterOf)).toHaveLength(1);

    const over = walk([
      ["a", "2031-05-05 09:00", "cA"],
      ["b", "2031-05-06 15:01", "cA"],
    ]);
    const segments = buildSegments(over.photos, over.clusterOf);
    expect(segments.map((s) => [s.id, s.clusterId, s.photoIds])).toEqual([
      ["s1", "cA", ["a"]],
      ["s2", "cA", ["b"]],
    ]);
  });

  it("starts a new segment whenever the city changes, even for a moment", () => {
    const { photos, clusterOf } = walk([
      ["a", "2031-05-05 09:00", "cA"],
      ["b", "2031-05-05 12:00", "cB"],
      ["c", "2031-05-05 17:00", "cA"],
    ]);
    expect(buildSegments(photos, clusterOf).map((s) => [s.id, s.clusterId])).toEqual([
      ["s1", "cA"],
      ["s2", "cB"],
      ["s3", "cA"],
    ]);
  });

  it("orders by time and skips a photo that belongs to no city", () => {
    const { photos, clusterOf } = walk([
      ["late", "2031-05-05 18:00", "cA"],
      ["early", "2031-05-05 09:00", "cA"],
      ["lost", "2031-05-05 12:00", "cX"],
    ]);
    clusterOf.delete("lost");
    expect(buildSegments(photos, clusterOf).map((s) => s.photoIds)).toEqual([["early", "late"]]);
    expect(buildSegments([], clusterOf)).toEqual([]);
  });
});
