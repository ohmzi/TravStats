/**
 * The final review's finding B5-1: single linkage at 30 km joins the
 * residence's photos with a place 24 km away, and the one cluster then holds
 * two named places. Each station of that cluster is titled from its own
 * segment — the day trip by the cove's own city, the two home ends by the
 * residence's town — instead of every station wearing whichever place the
 * cluster's photo count happens to favour.
 *
 * The loop parks at a base (Ostwick) away from both home and the cove: the
 * day trip out of it is what makes a station at the cove at all. Fixtures are
 * synthetic (2031, invented places, no real trip).
 */
import { buildDraftWith } from "../buildDraft";
import type { ScanInput } from "../types";
import {
  HOME_PERIODS,
  builderDeps,
  countryAtFixture,
  photosAt,
  type Place,
} from "./builderFixtures";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const INPUT: ScanInput = {
  name: "Kelmore loop",
  startDay: "2031-05-02",
  endDay: "2031-05-04",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

/** The residence `HOME_PERIODS` names: "Kelmore, Westshire" at −45.6, 169.3. */
const KELMORE_TOWN: Place = { lat: -45.6, lon: 169.3, city: "Kelmore", state: "Westshire" };
/** About 24 km from the residence: inside the 30 km single-linkage reach, so one cluster holds both. */
const SELBY_COVE: Place = { lat: -45.7, lon: 169.02, city: "Selby Cove", state: "Westshire" };
/** About 44 km from the residence and 50 km from the cove: a base of its own cluster. */
const OSTWICK: Place = { lat: -45.95, lon: 169.55, city: "Ostwick", state: "Westshire" };

const HOME_LOCALS = ["2031-05-02T09:00", "2031-05-02T12:00", "2031-05-02T18:00"];
const HOME_LAST = ["2031-05-04T09:00", "2031-05-04T11:00"];
/** An evening drive to the base, the night there: the base's stop holds a night, so it is no day trip. */
const BASE_BEFORE = ["2031-05-02T23:00", "2031-05-03T00:30"];
const BASE_AFTER = ["2031-05-03T17:00", "2031-05-03T18:00"];

/** The window's assets, in time order: home, the base, the day trip, the base, home. */
function loopAssets(coastLocals: readonly string[]) {
  return [
    ...photosAt("k", KELMORE_TOWN, HOME_LOCALS),
    ...photosAt("o", OSTWICK, BASE_BEFORE),
    ...photosAt("c", SELBY_COVE, coastLocals),
    ...photosAt("oa", OSTWICK, BASE_AFTER),
    ...photosAt("k2", KELMORE_TOWN, HOME_LAST),
  ];
}

describe("buildDraftWith: a home cluster merged with a nearby day trip", () => {
  async function stationsOf(coastLocals: readonly string[]) {
    const { dto } = await buildDraftWith(
      builderDeps(loopAssets(coastLocals), {
        homePeriods: HOME_PERIODS,
        countryAt: countryAtFixture,
      }),
      USER,
      INPUT,
      () => undefined
    );
    expect(dto.areas).toHaveLength(1);
    return dto.areas[0].stations;
  }

  /** Three coast photos: the home photos outnumber them and name the merged cluster. */
  const COAST_FEW = ["2031-05-03T11:00", "2031-05-03T12:00", "2031-05-03T13:00"];
  /** Seven coast photos: the cove outnumbers home and names the merged cluster. */
  const COAST_MANY = [
    "2031-05-03T11:00",
    "2031-05-03T11:30",
    "2031-05-03T12:00",
    "2031-05-03T12:30",
    "2031-05-03T13:00",
    "2031-05-03T13:30",
    "2031-05-03T14:00",
  ];

  it("titles the day trip by the cove's own city when home names the merged cluster", async () => {
    const stations = await stationsOf(COAST_FEW);
    expect(stations.map((s) => [s.title, s.kind, s.titleSource])).toEqual([
      ["Kelmore", "home", "immich"],
      ["Ostwick", "brief", "immich"],
      ["Selby Cove", "dayTrip", "immich"],
      ["Ostwick", "brief", "immich"],
      ["Kelmore", "home", "immich"],
    ]);
  });

  it("keeps the residence's town on the home ends when the cove names the merged cluster", async () => {
    const stations = await stationsOf(COAST_MANY);
    expect(stations.map((s) => [s.title, s.kind, s.titleSource])).toEqual([
      ["Kelmore", "home", "home"],
      ["Ostwick", "brief", "immich"],
      ["Selby Cove", "dayTrip", "immich"],
      ["Ostwick", "brief", "immich"],
      ["Kelmore", "home", "home"],
    ]);
  });
});
