/**
 * The owner's report (2026-10-13, "Sumayya's wedding"): a long stay in one city
 * whose photos also stand at a place a few tens of kilometres out showed ONE
 * station, so the trip page carried no location detail. Single linkage joins
 * the city's photos with the place's through the drive between them, and the
 * by-name split (spec §C.5, amended 2026-10-13) must still cut the two named
 * places apart: the stay then yields several stations, each with its own place
 * title and day span. The place here is 33 km out — the real gap is 33.2 km —
 * and its photos are the day's last, the shape the live data has, so the
 * station is a brief stop and takes that night by the lastPhoto rule.
 *
 * Synthetic fixtures (2031, invented places; no real trip).
 */
import { buildDraftWith } from "../buildDraft";
import type { ScanInput } from "../types";
import {
  builderDeps,
  countryAtFixture,
  photosAt,
  preciseFlight,
  type Place,
} from "./builderFixtures";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const INPUT: ScanInput = {
  name: "Vastra week",
  startDay: "2031-05-02",
  endDay: "2031-05-09",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

/** The stay's city. */
const VASTRA: Place = { lat: -45.05, lon: 168.7, city: "Vastra", state: "Westshire" };
/** About 33 km out (the live stay's place was 33.2 km from the city's median). */
const FAIRHAVEN: Place = { lat: -44.75, lon: 168.7, city: "Fairhaven", state: "Westshire" };
/** The drive's photos, about 17 km from each end: they chain the two places into one cluster. */
const DRIVE: Place = { lat: -44.9, lon: 168.7, city: "Vastra", state: "Westshire" };
const ZNV = { lat: -45.05, lon: 168.7 };
const ZKM = { lat: -45.6, lon: 169.3 };

const F1 = "f1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";
const F2 = "f2a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";

/** Out to the city, a week there with a day out, and home. */
const FLIGHTS = [
  preciseFlight({
    id: F1,
    label: "ZZ201 ZKM→ZNV",
    depIata: "ZKM",
    arrIata: "ZNV",
    dep: ZKM,
    arr: ZNV,
    depLocal: "2031-05-02T06:00",
    arrLocal: "2031-05-02T10:00",
  }),
  preciseFlight({
    id: F2,
    label: "ZZ202 ZNV→ZKM",
    depIata: "ZNV",
    arrIata: "ZKM",
    dep: ZNV,
    arr: ZKM,
    depLocal: "2031-05-09T15:00",
    arrLocal: "2031-05-09T19:00",
  }),
];

const cityDay = (d: string, prefix: string) =>
  photosAt(prefix, VASTRA, [`2031-05-${d}T09:00`, `2031-05-${d}T15:00`, `2031-05-${d}T21:00`]);

const ASSETS = [
  ...photosAt("arr", VASTRA, ["2031-05-02T14:00", "2031-05-02T18:00", "2031-05-02T21:00"]),
  ...cityDay("03", "c3"),
  ...cityDay("04", "c4"),
  // The day out: the drive's photo chains the place to the city's cluster,
  // and the place's own photos are the day's last — the live shape.
  ...photosAt("out", VASTRA, ["2031-05-05T08:00"]),
  ...photosAt("drive", DRIVE, ["2031-05-05T09:45"]),
  ...photosAt("fair", FAIRHAVEN, ["2031-05-05T10:30", "2031-05-05T11:30", "2031-05-05T12:30"]),
  ...cityDay("06", "c6"),
  ...cityDay("07", "c7"),
  ...cityDay("08", "c8"),
  ...photosAt("back", VASTRA, ["2031-05-09T09:00", "2031-05-09T11:00"]),
];

describe("buildDraftWith: a stay whose photos stand in two named places", () => {
  async function build() {
    return buildDraftWith(
      builderDeps(ASSETS, {
        loadFlights: async () => FLIGHTS,
        countryAt: countryAtFixture,
      }),
      USER,
      INPUT,
      () => undefined
    );
  }

  it("shows the city, the place out of town and the city again, each its own station", async () => {
    const { dto } = await build();

    expect(dto.areas).toHaveLength(1);
    expect(
      dto.areas[0].stations.map((s) => [s.title, s.titleSource, s.kind, s.firstDay, s.lastDay])
    ).toEqual([
      ["Vastra", "immich", "visit", "2031-05-02", "2031-05-05"],
      ["Fairhaven", "immich", "brief", "2031-05-05", "2031-05-05"],
      ["Vastra", "immich", "visit", "2031-05-06", "2031-05-09"],
    ]);
  });

  it("gives each station its own photos, and the night of the day out to the place", async () => {
    const { dto } = await build();
    const [city, fairhaven, cityAgain] = dto.areas[0].stations;

    expect([city.photoCount, fairhaven.photoCount, cityAgain.photoCount]).toEqual([11, 3, 11]);
    expect(dto.nights["2031-05-04"]).toMatchObject({ assign: city.key, reason: "lastPhoto" });
    expect(dto.nights["2031-05-05"]).toMatchObject({
      assign: fairhaven.key,
      reason: "lastPhoto",
    });
    expect(dto.nights["2031-05-06"]).toMatchObject({ assign: cityAgain.key, reason: "lastPhoto" });
  });
});
