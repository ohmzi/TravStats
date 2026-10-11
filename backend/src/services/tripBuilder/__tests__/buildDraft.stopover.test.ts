import { buildDraftWith } from "../buildDraft";
import type { ScanInput } from "../types";
import { NORTHVALE, builderDeps, photosAt, preciseFlight, type Place } from "./builderFixtures";

/**
 * The stopover the scan offers for a layover with an outing (spec 2026-10-11
 * §2): a mid-day connection at Northvale whose traveller went into Elmwood.
 * Synthetic places only (public repository).
 */
const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const F1 = "f1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";
const F2 = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d";

/** About 13 km from Northvale: past the 5 km outing line, inside the 30 km layover radius. */
const ELMWOOD: Place = { lat: -44.95, lon: 168.78, city: "Elmwood", state: "Westshire" };

const FLIGHT_IN = preciseFlight({
  id: F1,
  label: "ZZ101 KMR→NVL",
  depIata: "KMR",
  arrIata: "NVL",
  dep: { lat: -43.49, lon: 172.53 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-05-02T08:00",
  arrLocal: "2031-05-02T10:05",
});
const FLIGHT_OUT = preciseFlight({
  id: F2,
  label: "ZZ102 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-02T18:00",
  arrLocal: "2031-05-02T20:30",
});

/** Two photos at the airport and five downtown — the layover and its outing. */
const AT_AIRPORT = photosAt("nv", NORTHVALE, ["2031-05-02T10:10", "2031-05-02T10:20"]);
const AT_ELMWOOD = photosAt("em", ELMWOOD, [
  "2031-05-02T11:00",
  "2031-05-02T12:00",
  "2031-05-02T13:00",
  "2031-05-02T14:00",
  "2031-05-02T15:00",
]);

const INPUT: ScanInput = {
  name: "Southern loop",
  startDay: "2031-05-02",
  endDay: "2031-05-03",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

const deps = (assets = [...AT_AIRPORT, ...AT_ELMWOOD]) =>
  builderDeps(assets, {
    loadFlights: async () => [FLIGHT_IN, FLIGHT_OUT],
    airports: async () =>
      new Map([
        [
          "NVL",
          { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
        ],
      ]),
  });

describe("buildDraftWith: a layover whose photos went somewhere", () => {
  it("offers a stopover tour that starts at the arrival airport", async () => {
    const { dto } = await buildDraftWith(deps(), USER, INPUT, () => undefined);
    expect(dto.stopovers).toHaveLength(1);
    const [stopover] = dto.stopovers ?? [];
    expect(stopover).toMatchObject({
      key: `${F1}#${F2}`,
      city: "Elmwood",
      title: "Elmwood 2031 Road Trip",
      day: "2031-05-02",
      airportIata: "NVL",
      photoCount: 7,
      outingCount: 5,
    });
    expect(stopover.stations.map((s) => s.kind)).toEqual(["airport", "visit"]);
    expect(stopover.stations.map((s) => s.title)).toEqual(["Northvale", "Elmwood"]);
    expect(stopover.stations[0].previewIdx).toEqual([]);
    expect(stopover.stations[1].photoCount).toBe(5);
    expect(stopover.legs).toHaveLength(1);
    expect(stopover.legs[0]).toMatchObject({
      fromKey: stopover.stations[0].key,
      toKey: stopover.stations[1].key,
      mode: "road",
      ferryEvidence: null,
      routedKm: null,
    });
  });

  it("keeps the layover out of the areas and the nights, and its photos in the album", async () => {
    const draft = await buildDraftWith(deps(), USER, INPUT, () => undefined);
    expect(draft.dto.areas).toEqual([]);
    expect(draft.dto.nights).toEqual({});
    expect(draft.dto.flights[0].layover).toEqual({ photoCount: 7, airportIata: "NVL" });
    expect(new Set(draft.albumAssetIds)).toEqual(
      new Set([...AT_AIRPORT, ...AT_ELMWOOD].map((asset) => asset.id))
    );
  });

  it("keeps the whole layover server-side and shows the tour by preview index only", async () => {
    const draft = await buildDraftWith(deps(), USER, INPUT, () => undefined);
    const [stored] = draft.stopovers;
    expect(stored.photoIds).toHaveLength(7);
    const elmwood = stored.stations[1];
    expect(elmwood.previewIdx.length).toBeGreaterThan(0);
    const shown = elmwood.previewIdx.map((index) => draft.previewAssetIds[index]);
    expect(shown.every((id) => id.startsWith("em-"))).toBe(true);
    expect(JSON.stringify(draft.dto)).not.toContain("em-");
  });

  it("offers nothing from a layover whose photos stayed near the airport", async () => {
    const { dto } = await buildDraftWith(
      deps([...AT_AIRPORT, ...AT_ELMWOOD.slice(0, 4)]),
      USER,
      INPUT,
      () => undefined
    );
    expect(dto.stopovers).toEqual([]);
    expect(dto.flights[0].layover).toEqual({ photoCount: 6, airportIata: "NVL" });
  });
});
