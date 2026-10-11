import { buildDraftWith, type BuilderDeps } from "../buildDraft";
import type { ScanInput } from "../types";
import { NORTHVALE, builderDeps, photosAt, preciseFlight, type Place } from "./builderFixtures";

/**
 * The stopover the scan offers for a layover with an outing (spec 2026-10-11
 * §2): a mid-day connection at Northvale whose traveller went into Elmwood,
 * and a night layover whose outing crosses midnight. Synthetic places only
 * (public repository).
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

const deps = (assets = [...AT_AIRPORT, ...AT_ELMWOOD], over: Partial<BuilderDeps> = {}) =>
  builderDeps(assets, {
    loadFlights: async () => [FLIGHT_IN, FLIGHT_OUT],
    airports: async () =>
      new Map([
        [
          "NVL",
          { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
        ],
      ]),
    ...over,
  });

/** The layover that crosses midnight: landing 22:30, the next departure 09:00 (10.5 h). */
const MID_FLIGHT_IN = preciseFlight({
  id: F1,
  label: "ZZ103 KMR→NVL",
  depIata: "KMR",
  arrIata: "NVL",
  dep: { lat: -43.49, lon: 172.53 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-05-02T08:00",
  arrLocal: "2031-05-02T22:30",
});
const MID_FLIGHT_OUT = preciseFlight({
  id: F2,
  label: "ZZ104 NVL→WKA",
  depIata: "NVL",
  arrIata: "WKA",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -45.95, lon: 169.55 },
  depLocal: "2031-05-03T09:00",
  arrLocal: "2031-05-03T11:30",
});

/** Four at the airport and five into Elmwood, on both sides of midnight. */
const MID_AT_AIRPORT = photosAt("nvm", NORTHVALE, [
  "2031-05-02T22:40",
  "2031-05-02T22:50",
  "2031-05-03T08:20",
  "2031-05-03T08:30",
]);
const MID_AT_ELMWOOD = photosAt("emm", ELMWOOD, [
  "2031-05-02T23:30",
  "2031-05-03T00:30",
  "2031-05-03T05:30",
  "2031-05-03T06:30",
  "2031-05-03T07:30",
]);

/**
 * The destination after the second flight: one ground area, so the night plan is not
 * empty. NZ coordinates on purpose: an overseas fix would be re-clocked by zone rule 1
 * (the photo's own GPS zone) and its photos would move off 03 May.
 */
const SOUTHHOLLOW: Place = { lat: -46.0, lon: 169.5, city: "Southhollow", state: "Southland" };
const AT_SOUTHHOLLOW = photosAt("sh", SOUTHHOLLOW, [
  "2031-05-03T12:00",
  "2031-05-03T13:00",
  "2031-05-03T14:00",
  "2031-05-03T15:00",
  "2031-05-03T16:00",
]);

const midnightDeps = (over: Partial<BuilderDeps> = {}) =>
  builderDeps([...MID_AT_AIRPORT, ...MID_AT_ELMWOOD, ...AT_SOUTHHOLLOW], {
    loadFlights: async () => [MID_FLIGHT_IN, MID_FLIGHT_OUT],
    airports: async () =>
      new Map([
        [
          "NVL",
          { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
        ],
      ]),
    ...over,
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

  it("warns that roadtrips are hidden whenever it offers a stopover, areas or none", async () => {
    // Finding S3-1a: the review disables the stopover's roadtrip switch from this
    // warning, so a scan whose areas are all single-city stops (or absent) must
    // still carry it — otherwise the switch is offered and the commit refuses it.
    const noAreas = await buildDraftWith(
      deps(undefined, { roadtripsVisible: false }),
      USER,
      INPUT,
      () => undefined
    );
    expect(noAreas.dto.areas).toEqual([]);
    expect(noAreas.dto.stopovers).toHaveLength(1);
    expect(noAreas.dto.warnings).toContainEqual({ code: "roadtripsHidden", params: {} });

    const stopsOnly = await buildDraftWith(
      midnightDeps({ roadtripsVisible: false }),
      USER,
      INPUT,
      () => undefined
    );
    expect(stopsOnly.dto.areas).toHaveLength(1);
    expect(stopsOnly.dto.areas.every((a) => a.defaultAs === "stops")).toBe(true);
    expect(stopsOnly.dto.stopovers).toHaveLength(1);
    expect(stopsOnly.dto.warnings).toContainEqual({ code: "roadtripsHidden", params: {} });
  });

  it("offers a midnight-crossing layover without touching the nights or the day totals", async () => {
    const draft = await buildDraftWith(midnightDeps(), USER, INPUT, () => undefined);
    const { dto } = draft;
    expect(dto.stopovers).toHaveLength(1);
    const [stopover] = dto.stopovers ?? [];
    // The day is the first outing photo's (23:30 on 02 May), not the last photo's or the departure's.
    expect(stopover).toMatchObject({
      key: `${F1}#${F2}`,
      day: "2031-05-02",
      title: "Elmwood 2031 Road Trip",
      photoCount: 9,
      outingCount: 5,
    });
    // The outing's own station straddles midnight: its photos run 23:30 → 07:30.
    expect(stopover.stations[1]).toMatchObject({ firstDay: "2031-05-02", lastDay: "2031-05-03" });
    // The whole crossing is one layover, not a day's ground on each side of it.
    expect(dto.flights[0].layover).toEqual({ photoCount: 9, airportIata: "NVL" });

    // 02 May: the two airport photos and the first outing photo; 03 May: the rest of the
    // layover plus the destination. Every layover photo still counts on its own day.
    const byDay = new Map(dto.days.map((day) => [day.day, day.photos] as const));
    expect(byDay.get("2031-05-02")).toBe(3);
    expect(byDay.get("2031-05-03")).toBe(11);

    // The night plan is real — its one suggestion is the destination area's station — yet
    // nothing in it, nor in the days' station lists, names a stopover station (review focus 2).
    const stopoverKeys = new Set(stopover.stations.map((station) => station.key));
    expect(Object.keys(dto.nights)).toEqual(["2031-05-02"]);
    const destinationKeys = dto.areas.flatMap((area) => area.stations.map((s) => s.key));
    expect(dto.nights["2031-05-02"].suggestedStationKeys).toEqual(destinationKeys);
    const nightNames = Object.values(dto.nights).flatMap((night) => [
      night.assign,
      ...night.suggestedStationKeys,
    ]);
    const dayNames = dto.days.flatMap((day) => day.stationKeys);
    expect([...nightNames, ...dayNames].filter((key) => stopoverKeys.has(key))).toEqual([]);
  });
});

// ─── Two stays through one city, one year ────────────────────────────────────

const F3 = "3f4a5b6c-7d8e-4f01-9234-5678495a6b7c";
const F4 = "4a5b6c7d-8e9f-4012-a345-67895a6b7c8d";
const F5 = "5b6c7d8e-9fa0-4123-b456-789a6b7c8d9e";
const F6 = "6c7d8e9f-a0b1-4234-c567-89ab7c8d9e0f";

/**
 * A round trip through Northvale twice: out on 06 June and home on 20 June,
 * each pass with the same Elmwood outing. Two qualifying candidates in one
 * city and year, so the second needs the duplicate-day title to stay distinct.
 */
const FIRST_IN = preciseFlight({
  id: F3,
  label: "ZZ105 KMR→NVL",
  depIata: "KMR",
  arrIata: "NVL",
  dep: { lat: -43.49, lon: 172.53 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-06-06T08:00",
  arrLocal: "2031-06-06T10:05",
});
const FIRST_OUT = preciseFlight({
  id: F4,
  label: "ZZ106 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-06-06T18:00",
  arrLocal: "2031-06-06T20:30",
});
const SECOND_IN = preciseFlight({
  id: F5,
  label: "ZZ107 SLM→NVL",
  depIata: "SLM",
  arrIata: "NVL",
  dep: { lat: -16.52, lon: -68.12 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-06-20T08:00",
  arrLocal: "2031-06-20T10:05",
});
const SECOND_OUT = preciseFlight({
  id: F6,
  label: "ZZ108 NVL→KMR",
  depIata: "NVL",
  arrIata: "KMR",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -43.49, lon: 172.53 },
  depLocal: "2031-06-20T18:00",
  arrLocal: "2031-06-20T20:30",
});

/** The outbound stay: two photos at the airport and five in Elmwood, as before. */
const FIRST_AT_AIRPORT = photosAt("nvo", NORTHVALE, ["2031-06-06T10:10", "2031-06-06T10:20"]);
const FIRST_AT_ELMWOOD = photosAt("emo", ELMWOOD, [
  "2031-06-06T11:00",
  "2031-06-06T12:00",
  "2031-06-06T13:00",
  "2031-06-06T14:00",
  "2031-06-06T15:00",
]);

/** The homeward stay, a fortnight later: the same outing, its own photo ids. */
const SECOND_AT_AIRPORT = photosAt("nvr", NORTHVALE, ["2031-06-20T10:10", "2031-06-20T10:20"]);
const SECOND_AT_ELMWOOD = photosAt("emr", ELMWOOD, [
  "2031-06-20T11:00",
  "2031-06-20T12:00",
  "2031-06-20T13:00",
  "2031-06-20T14:00",
  "2031-06-20T15:00",
]);

const TWO_STAYS_INPUT: ScanInput = {
  name: "Back through Northvale",
  startDay: "2031-06-06",
  endDay: "2031-06-20",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

const twoStaysDeps = () =>
  builderDeps(
    [...FIRST_AT_AIRPORT, ...FIRST_AT_ELMWOOD, ...SECOND_AT_AIRPORT, ...SECOND_AT_ELMWOOD],
    {
      loadFlights: async () => [FIRST_IN, FIRST_OUT, SECOND_IN, SECOND_OUT],
      airports: async () =>
        new Map([
          [
            "NVL",
            { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
          ],
        ]),
    }
  );

describe("buildDraftWith: two qualifying stopovers in one city and year", () => {
  it("gives the second the day-suffixed title, so the two roadtrips never collide", async () => {
    const { dto } = await buildDraftWith(twoStaysDeps(), USER, TWO_STAYS_INPUT, () => undefined);
    expect(dto.stopovers).toHaveLength(2);
    const [first, second] = dto.stopovers ?? [];
    // Scan order: the outbound stay first, the homeward stay second, each under its own key.
    expect(first).toMatchObject({ key: `${F3}#${F4}`, city: "Elmwood" });
    expect(second).toMatchObject({ key: `${F5}#${F6}`, city: "Elmwood" });
    expect(first.key).not.toBe(second.key);
    // One name each for the roadtrip and its album: the first keeps the plain one, the
    // second takes the ` (d MMM)` of its own day, the duplicate convention C.11 shares.
    expect(first.title).toBe("Elmwood 2031 Road Trip");
    expect(second.title).toBe("Elmwood 2031 Road Trip (20 Jun)");
    expect(first.title).not.toBe(second.title);
  });
});
