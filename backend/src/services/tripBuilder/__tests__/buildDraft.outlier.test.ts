import { buildDraftWith } from "../buildDraft";
import type { ScanInput } from "../types";
import { NORTHVALE, builderDeps, countryAtFixture, photosAt, type Place } from "./builderFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const FINCHPORT: Place = { lat: -38.0, lon: 177.0, city: "Finchport", state: "Eastshire" };

const INPUT: ScanInput = {
  name: "Westshire week",
  startDay: "2031-05-02",
  endDay: "2031-05-09",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

const build = (assets: Parameters<typeof builderDeps>[0]) =>
  buildDraftWith(
    builderDeps(assets, { countryAt: countryAtFixture }),
    USER,
    INPUT,
    () => undefined
  );

/** `count` Auckland wall clocks half an hour apart from `from`. */
function everyHalfHour(from: string, count: number): string[] {
  const start = Date.parse(`${from}:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(start + i * 30 * 60_000).toISOString();
    return `${at.slice(0, 10)}T${at.slice(11, 16)}`;
  });
}

/**
 * A handful of photos in a far city — the owner's Oakville case (ruling
 * 2026-10-13): inside one area, a small cluster away from the area's main
 * cluster is ignored — no station, no night, no split, no unrecorded-flight
 * warning — and the review says so. A real drive's second stop is comparable
 * in size and stays untouched.
 */
describe("buildDraftWith: a far outlier inside an area", () => {
  it("drops the handful, keeps the stay's bulk and notes it", async () => {
    // 2 of 42 photos sit at the far place: under a twentieth, a handful.
    const bulk = photosAt("nv", NORTHVALE, everyHalfHour("2031-05-03T10:00", 40));
    const handful = photosAt("fp", FINCHPORT, ["2031-05-04T06:15", "2031-05-04T06:30"]);
    const { dto, albumAssetIds } = await build([...bulk, ...handful]);

    expect(dto.areas).toHaveLength(1);
    expect(dto.areas[0].stations.map((s) => [s.title, s.photoCount])).toEqual([["Northvale", 40]]);
    expect(dto.days.flatMap((day) => day.passedThrough)).toEqual([]);
    // The note, and no unrecorded-flight warning: the move was the handful's,
    // and it is gone. A single station has no legs, so nothing needs routing.
    expect(dto.warnings).toEqual([{ code: "photosFarFromStay", params: { count: 2 } }]);
    // The photos stay the trip's own: the album keeps them, ignored as they are.
    expect(albumAssetIds).toEqual(expect.arrayContaining(handful.map((a) => a.id)));
  });

  it("leaves a real drive's two comparable stops untouched", async () => {
    const first = photosAt("nv", NORTHVALE, [
      "2031-05-03T10:00",
      "2031-05-03T11:00",
      "2031-05-03T12:00",
      "2031-05-03T14:00",
      "2031-05-03T16:00",
      "2031-05-03T17:00",
    ]);
    const second = photosAt("fp", FINCHPORT, [
      "2031-05-04T10:00",
      "2031-05-04T12:00",
      "2031-05-04T14:00",
      "2031-05-04T16:00",
      "2031-05-04T18:00",
    ]);
    const { dto } = await build([...first, ...second]);

    expect(dto.areas).toHaveLength(1);
    expect(dto.areas[0].stations.map((s) => [s.title, s.kind])).toEqual([
      ["Northvale", "visit"],
      ["Finchport", "visit"],
    ]);
    expect(dto.warnings.map((w) => w.code)).toEqual(["noRouting"]);
  });
});
