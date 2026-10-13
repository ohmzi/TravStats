import { buildDraftWith } from "../buildDraft";
import type { ScanInput } from "../types";
import {
  NORTHVALE,
  PORT_CARROW,
  at,
  builderDeps,
  countryAtFixture,
  nzAsset,
  photosAt,
} from "./builderFixtures";

// Synthetic fixtures only (public repository): invented places, shifted years.

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const INPUT: ScanInput = {
  name: "Westshire week",
  startDay: "2031-05-02",
  endDay: "2031-05-09",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

/** Four Northvale photos in one day, and three archived videos taken at Port Carrow the same day. */
const ASSETS = [
  ...photosAt("nv", NORTHVALE, [
    "2031-05-03T10:00",
    "2031-05-03T12:00",
    "2031-05-03T15:00",
    "2031-05-03T17:00",
  ]),
  ...["11:00", "13:00", "15:30"].map((time, i) =>
    nzAsset({
      id: `pc-archived-${i + 1}`,
      local: `2031-05-03T${time}`,
      type: "VIDEO",
      visibility: "archive",
      ...at(PORT_CARROW),
    })
  ),
];

/**
 * The scan reads no archived asset (owner ruling 2026-10-13, "Sumayya's
 * wedding"): the archived videos must not reach the draft's photo set — no
 * station, no passed-through chip, no count — while a normal photo of the
 * window still shapes it.
 */
describe("buildDraftWith: an archived asset", () => {
  it("is not in the draft's photo set, while a normal photo of the window is", async () => {
    const { dto } = await buildDraftWith(
      builderDeps(ASSETS, { countryAt: countryAtFixture }),
      USER,
      INPUT,
      () => undefined
    );

    expect(dto.stats.assets).toBe(4);
    expect(dto.areas).toHaveLength(1);
    expect(dto.areas[0].stations.map((s) => [s.title, s.kind])).toEqual([["Northvale", "visit"]]);
    expect(dto.areas[0].startDay).toBe("2031-05-03");
    expect(dto.areas[0].endDay).toBe("2031-05-03");
    expect(dto.days.flatMap((day) => day.passedThrough)).toEqual([]);
  });
});
