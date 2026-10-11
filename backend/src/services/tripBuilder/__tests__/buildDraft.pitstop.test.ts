import { buildDraftWith } from "../buildDraft";
import type { ScanInput } from "../types";
import { NORTHVALE, builderDeps, photosAt, preciseFlight, type Place } from "./builderFixtures";

/**
 * The pitstop the scan marks on a multi-day same-airport stay (spec 2026-10-11
 * pitstops §2): the traveller stays in Dunholme between two flights that share
 * Northvale, while the trip's principal destination keeps the trip's own
 * album. Synthetic places only (public repository).
 */
const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const F1 = "1a1b2c3d-4e5f-4061-8a2b-3c4d5e6f7a8b";
const F2 = "2b2c3d4e-5f60-4172-9b3c-4d5e6f7a8b9c";

/** About 34 km from Northvale: past the 30 km layover radius, so the stay is an area. */
const DUNHOLME: Place = { lat: -44.744, lon: 168.7, city: "Dunholme", state: "Westshire" };
/** The destination after the second flight. */
const SOUTHHOLLOW: Place = { lat: -46.0, lon: 169.5, city: "Southhollow", state: "Southland" };

const FLIGHT_IN = preciseFlight({
  id: F1,
  label: "ZZ109 KMR→NVL",
  depIata: "KMR",
  arrIata: "NVL",
  dep: { lat: -43.49, lon: 172.53 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-05-02T08:00",
  arrLocal: "2031-05-02T10:05",
});
/** Leaves two days later: different local days, so the stay is a pitstop. */
const FLIGHT_OUT = preciseFlight({
  id: F2,
  label: "ZZ110 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-04T18:00",
  arrLocal: "2031-05-04T20:30",
});
/** Leaves the same evening, a gap of 13h50: outside the layover window, and the same local day. */
const FLIGHT_OUT_SAME_DAY = preciseFlight({
  id: F2,
  label: "ZZ110 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-02T23:55",
  arrLocal: "2031-05-03T02:25",
});

/** The stay's own photos: two days in Dunholme, between the two flights. */
const AT_DUNHOLME = photosAt("dh", DUNHOLME, [
  "2031-05-02T11:00",
  "2031-05-02T13:00",
  "2031-05-03T09:00",
  "2031-05-03T11:00",
  "2031-05-03T15:00",
]);
/** The same-day stay: one day in Dunholme, before the evening flight. */
const AT_DUNHOLME_ONE_DAY = photosAt("dh", DUNHOLME, [
  "2031-05-02T11:00",
  "2031-05-02T13:00",
  "2031-05-02T15:00",
  "2031-05-02T17:00",
]);
/** The principal destination: three nights in Southhollow after the second flight. */
const AT_SOUTHHOLLOW = photosAt("sh", SOUTHHOLLOW, [
  "2031-05-04T22:00",
  "2031-05-05T12:00",
  "2031-05-06T12:00",
]);
const AT_SOUTHHOLLOW_SAME_DAY = photosAt("sh", SOUTHHOLLOW, [
  "2031-05-03T12:00",
  "2031-05-04T12:00",
  "2031-05-05T12:00",
]);

const INPUT: ScanInput = {
  name: "Southern loop",
  startDay: "2031-05-02",
  endDay: "2031-05-07",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

const deps = (
  outbound: typeof FLIGHT_OUT,
  assets: ReturnType<typeof photosAt>,
  over: Partial<Parameters<typeof builderDeps>[1]> = {}
) =>
  builderDeps(assets, {
    loadFlights: async () => [FLIGHT_IN, outbound],
    airports: async () =>
      new Map([
        [
          "NVL",
          { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
        ],
      ]),
    ...over,
  });

describe("buildDraftWith: a multi-day same-airport stay", () => {
  it("marks the stay a pitstop with its album name, and leaves the destination alone", async () => {
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT, [...AT_DUNHOLME, ...AT_SOUTHHOLLOW]),
      USER,
      INPUT,
      () => undefined
    );
    expect(dto.areas.map((area) => area.mainCity)).toEqual(["Dunholme", "Southhollow"]);
    const [stay, destination] = dto.areas;
    expect(stay.pitstop).toEqual({ albumName: "Dunholme 2031 Road Trip (Southern loop)" });
    // The destination keeps the trip's own album; its own flight pair qualifies
    // for nothing because it is not a pitstop's business (spec §2).
    expect(destination.pitstop).toBeUndefined();
    // Nothing else about the area changes (spec §2): the scan's own kind default
    // is untouched; the review gives a pitstop its Roadtrip default (spec §3).
    expect(stay.defaultAs).toBe("stops");
  });

  it("marks nothing when the two flights fall on one local day", async () => {
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT_SAME_DAY, [...AT_DUNHOLME_ONE_DAY, ...AT_SOUTHHOLLOW_SAME_DAY]),
      USER,
      INPUT,
      () => undefined
    );
    // The same geometry, an ordinary pair of areas: the day rule alone decides.
    expect(dto.areas.map((area) => area.mainCity)).toEqual(["Dunholme", "Southhollow"]);
    expect(dto.areas.every((area) => area.pitstop === undefined)).toBe(true);
  });

  it("carries the roadtripsHidden warning for a pitstop when roadtrips are off in Settings", async () => {
    // The review disables the pitstop's kind and album switches from this warning
    // (spec §3, the S3-1a lesson): the scan must carry it for a pitstop whose area
    // kind is the scan's own `stops`.
    const { dto } = await buildDraftWith(
      deps(FLIGHT_OUT, [...AT_DUNHOLME, ...AT_SOUTHHOLLOW], { roadtripsVisible: false }),
      USER,
      INPUT,
      () => undefined
    );
    expect(dto.warnings.map((w) => w.code)).toContain("roadtripsHidden");
  });
});
