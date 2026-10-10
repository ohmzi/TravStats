import { buildDraftWith } from "../buildDraft";
import { BUILD_PHASES, type BuildPhase, type ScanInput } from "../types";
import {
  NORTHVALE,
  OPEN_WATER_A,
  OPEN_WATER_B,
  PORT_CARROW,
  SELBY_BAY,
  builderDeps,
  countryAtFixture,
  photosAt,
} from "./builderFixtures";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const INPUT: ScanInput = {
  name: "Strait crossing",
  startDay: "2031-05-02",
  endDay: "2031-05-08",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

/**
 * Northvale → Port Carrow → (day ferry) Selby Bay → (overnight ferry) Port
 * Carrow → a day with no photos → Northvale again. Times are Pacific/Auckland.
 */
const ASSETS = [
  ...photosAt("nv1", NORTHVALE, [
    "2031-05-02T10:00",
    "2031-05-02T11:30",
    "2031-05-02T14:00",
    "2031-05-02T19:30",
    "2031-05-03T09:00",
    "2031-05-03T11:00",
  ]),
  ...photosAt("pc1", PORT_CARROW, [
    "2031-05-03T16:00",
    "2031-05-03T17:30",
    "2031-05-03T20:30",
    "2031-05-04T09:00",
    "2031-05-04T10:00",
  ]),
  ...photosAt("sea1", OPEN_WATER_A, ["2031-05-04T15:00", "2031-05-04T16:00"]),
  ...photosAt("sb", SELBY_BAY, [
    "2031-05-04T18:30",
    "2031-05-04T19:00",
    "2031-05-04T21:00",
    "2031-05-05T10:00",
    "2031-05-05T13:00",
    "2031-05-05T17:00",
  ]),
  ...photosAt("sea2", OPEN_WATER_B, ["2031-05-05T22:30", "2031-05-05T23:30", "2031-05-06T01:30"]),
  ...photosAt("pc2", PORT_CARROW, ["2031-05-06T07:30", "2031-05-06T09:00", "2031-05-06T12:00"]),
  ...photosAt("nv2", NORTHVALE, ["2031-05-08T10:00", "2031-05-08T12:00"]),
];

describe("buildDraftWith: a ferry roadtrip across a strait", () => {
  async function build() {
    const phases: BuildPhase[] = [];
    const draft = await buildDraftWith(
      builderDeps(ASSETS, { countryAt: countryAtFixture }),
      USER,
      INPUT,
      (phase) => phases.push(phase)
    );
    return { draft, phases };
  }

  it("makes one roadtrip area of five stations in travel order", async () => {
    const { draft, phases } = await build();
    const area = draft.dto.areas[0];

    expect(phases).toEqual([...BUILD_PHASES]);
    expect(draft.dto.areas).toHaveLength(1);
    expect(area).toMatchObject({
      defaultAs: "roadtrip",
      suggestedName: "Strait crossing",
      startDay: "2031-05-02",
      endDay: "2031-05-08",
    });
    expect(area.stations.map((s) => [s.title, s.kind])).toEqual([
      ["Northvale", "visit"],
      ["Port Carrow", "visit"],
      ["Selby Bay", "visit"],
      ["Port Carrow", "brief"],
      ["Northvale", "brief"],
    ]);
    expect(area.stations[0]).toMatchObject({
      key: "-901|3374|2031-05-02",
      firstDay: "2031-05-02",
      lastDay: "2031-05-03",
      firstLocal: "2031-05-02 10:00",
      lastLocal: "2031-05-03 11:00",
      photoCount: 6,
    });
  });

  it("puts both crossings on a ferry because of the photos taken at sea", async () => {
    const { draft } = await build();
    expect(draft.dto.areas[0].legs.map((l) => [l.mode, l.ferryEvidence])).toEqual([
      ["road", null],
      ["ferry", "seaPhotos"],
      ["ferry", "seaPhotos"],
      ["road", null],
    ]);
  });

  it("gives every night a station, the overnight ferry its boarding station and the empty night 'unknown'", async () => {
    const { draft } = await build();
    const [nv1, pc1, sb, pc2, nv2] = draft.dto.areas[0].stations.map((s) => s.key);

    expect(draft.dto.nights).toMatchObject({
      "2031-05-02": { assign: nv1, reason: "lastPhoto" },
      "2031-05-03": { assign: pc1, reason: "lastPhoto" },
      "2031-05-04": { assign: sb, reason: "lastPhoto" },
      "2031-05-05": { assign: sb, reason: "ferry" },
      "2031-05-06": { assign: pc2, reason: "lastPhoto" },
      "2031-05-07": { assign: "unknown", reason: "unknown", suggestedStationKeys: [pc2, nv2] },
    });
    expect(Object.keys(draft.dto.nights)).toHaveLength(6);
  });

  it("counts photos, keeps the sea photos out of the stations and warns that nothing can route", async () => {
    const { draft } = await build();
    const [, pc1, sb] = draft.dto.areas[0].stations.map((s) => s.key);

    expect(draft.dto.stats).toMatchObject({
      assets: 27,
      images: 27,
      videos: 0,
      located: 27,
      excluded: { atSea: 5, inFlight: 0, misdated: 0, unlocated: 0, partner: 0 },
    });
    expect(draft.dto.countries).toEqual(["NZ"]);
    expect(draft.dto.warnings).toEqual([{ code: "noRouting", params: {} }]);
    expect(draft.dto.days).toHaveLength(7);
    expect(draft.dto.days[2]).toEqual({
      day: "2031-05-04",
      photos: 7,
      located: 7,
      stationKeys: [pc1, sb],
      flightIds: [],
      passedThrough: [],
    });
    expect(draft.dto.days[5]).toEqual({
      day: "2031-05-07",
      photos: 0,
      located: 0,
      stationKeys: [],
      flightIds: [],
      passedThrough: [],
    });
  });

  it("addresses thumbnails by index and indexes every station it offered", async () => {
    const { draft } = await build();
    const stations = draft.dto.areas[0].stations;

    expect(draft.albumAssetIds).toHaveLength(27);
    for (const station of stations) {
      expect(station.previewIdx.length).toBeGreaterThan(0);
      for (const index of station.previewIdx) {
        expect(draft.previewAssetIds[index]).toBeDefined();
      }
      expect(draft.stationIndex.get(station.key)).toMatchObject({
        areaKey: draft.dto.areas[0].key,
        firstDay: station.firstDay,
        lastDay: station.lastDay,
      });
    }
    expect(draft.previewAssetIds.some((id) => id.startsWith("sea"))).toBe(false);
  });
});
