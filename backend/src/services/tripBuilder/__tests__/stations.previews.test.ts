import { indexPreviews } from "../stations";
import { planOf, station } from "./planFixtures";

const area = (ids: Record<string, string[]>) =>
  planOf(
    Object.keys(ids).map((key) => station(key)),
    { previewPhotoIds: new Map(Object.entries(ids)) }
  );

describe("indexPreviews", () => {
  it("deals thumbnails out one rank at a time across the stations", () => {
    const { previewAssetIds, previewIdx } = indexPreviews([
      area({ x: ["a1", "a2", "a3"], y: ["b1"] }),
    ]);
    expect(previewAssetIds).toEqual(["a1", "b1", "a2", "a3"]);
    expect([...previewIdx]).toEqual([
      ["x", [0, 2, 3]],
      ["y", [1]],
    ]);
  });

  it("stops at the cap and drops the later ranks first", () => {
    const { previewAssetIds, previewIdx } = indexPreviews(
      [area({ x: ["a1", "a2", "a3"], y: ["b1", "b2"] })],
      3
    );
    expect(previewAssetIds).toEqual(["a1", "b1", "a2"]);
    expect([...previewIdx]).toEqual([
      ["x", [0, 2]],
      ["y", [1]],
    ]);
  });

  it("lists a photo shared by two stations once, and gives a station without photos []", () => {
    const { previewAssetIds, previewIdx } = indexPreviews([
      area({ x: ["shared"], y: ["shared", "b2"], z: [] }),
    ]);
    expect(previewAssetIds).toEqual(["shared", "b2"]);
    expect([...previewIdx]).toEqual([
      ["x", [0]],
      ["y", [0, 1]],
      ["z", []],
    ]);
  });

  it("caps the draft at 400 thumbnails by default", () => {
    const ids = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`s${i}`, [`p${i}`]]));
    expect(indexPreviews([area(ids)]).previewAssetIds).toHaveLength(400);
  });
});
