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
      // The journey's only trip, so it takes the journey's own name (owner
      // ruling 2026-10-12: "<Journey name> · <City>", or just the journey's
      // name for a one-trip journey) — and its album takes the same string
      // (`commitPlan` writes one name for both).
      title: "Southern loop",
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
    // The destination area is a single-city stop, not a trip, so the journey
    // holds one trip and the stopover takes the journey's name (owner ruling
    // 2026-10-12).
    expect(stopover).toMatchObject({
      key: `${F1}#${F2}`,
      day: "2031-05-02",
      title: "Southern loop",
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
    // One name each for the roadtrip and its album: every trip of the journey
    // is "<Journey> · <City>" (owner ruling 2026-10-12), and two trips sharing
    // a city take their own day suffixes — the ` (d MMM)` duplicate convention
    // C.11 shares — so the two can never collide.
    expect(first.title).toBe("Back through Northvale · Elmwood (6 Jun)");
    expect(second.title).toBe("Back through Northvale · Elmwood (20 Jun)");
    expect(first.title).not.toBe(second.title);
  });
});

// ─── A stretch the areas call an area (branch (b), spec §2 amended) ──────────

const G1 = "1a1b2c3d-4e5f-4061-8a2b-3c4d5e6f7a8b";
const G2 = "2b2c3d4e-5f60-4172-9b3c-4d5e6f7a8b9c";

/**
 * The hub-city geometry branch (b) exists for: the city sits about 34 km from
 * the airport the two flights share — past the 30 km layover radius, so the
 * area rules never see a layover.
 */
const DUNHOLME: Place = { lat: -44.744, lon: 168.7, city: "Dunholme", state: "Westshire" };

const HUB_IN = preciseFlight({
  id: G1,
  label: "ZZ109 KMR→NVL",
  depIata: "KMR",
  arrIata: "NVL",
  dep: { lat: -43.49, lon: 172.53 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-05-02T08:00",
  arrLocal: "2031-05-02T10:05",
});
const HUB_OUT = preciseFlight({
  id: G2,
  label: "ZZ110 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-02T18:00",
  arrLocal: "2031-05-02T20:30",
});

/** A control pair: the inbound flight lands at a different airport, so the stretch is between two different airports. */
const AWAY_HUB_IN = preciseFlight({
  id: G1,
  label: "ZZ109 KMR→WKA",
  depIata: "KMR",
  arrIata: "WKA",
  dep: { lat: -43.49, lon: 172.53 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-05-02T08:00",
  arrLocal: "2031-05-02T10:05",
});

/** Every photo is in the city, past the 30 km radius: the area rules never see a layover. */
const AT_DUNHOLME = photosAt("dh", DUNHOLME, [
  "2031-05-02T11:00",
  "2031-05-02T12:00",
  "2031-05-02T13:00",
  "2031-05-02T14:00",
  "2031-05-02T15:00",
]);

const hubDeps = (
  inbound: typeof HUB_IN,
  assets: ReturnType<typeof photosAt> = AT_DUNHOLME,
  over: Partial<BuilderDeps> = {}
) =>
  builderDeps([...assets], {
    loadFlights: async () => [inbound, HUB_OUT],
    airports: async () =>
      new Map([
        [
          "NVL",
          { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
        ],
      ]),
    ...over,
  });

describe("buildDraftWith: a stretch between two flights sharing an airport, its city past the layover radius", () => {
  it("reclassifies the area into a stopover candidate that keeps its own stations and legs", async () => {
    const draft = await buildDraftWith(hubDeps(HUB_IN), USER, INPUT, () => undefined);
    const { dto } = draft;
    expect(dto.stopovers).toHaveLength(1);
    const [stopover] = dto.stopovers ?? [];
    expect(stopover).toMatchObject({
      key: `${G1}#${G2}`,
      city: "Dunholme",
      // The reclassified stretch leaves the areas, so the journey holds this
      // one trip: it takes the journey's name (owner ruling 2026-10-12).
      title: "Southern loop",
      day: "2031-05-02",
      airportIata: "NVL",
      photoCount: 5,
      outingCount: 5,
    });
    // The airport anchors and the city stop the area derived, verbatim: the
    // airport first and last (34 km from the city), the four-hour city stop between.
    expect(stopover.stations.map((s) => s.kind)).toEqual(["airport", "brief", "airport"]);
    expect(stopover.stations.map((s) => s.title)).toEqual(["Northvale", "Dunholme", "Northvale"]);
    expect(stopover.stations[1].photoCount).toBe(5);
    expect(stopover.legs).toHaveLength(2);
    // The stretch leaves the areas: never offered twice.
    expect(dto.areas).toEqual([]);
    // The album list is the stretch's whole photo set, server-side only; the
    // city stop shows through the draft's preview indexes as any station does.
    expect(draft.stopovers[0].photoIds).toEqual(AT_DUNHOLME.map((asset) => asset.id));
    const shown = stopover.stations[1].previewIdx.map((index) => draft.previewAssetIds[index]);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((id) => id.startsWith("dh-"))).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("dh-");

    // The same geometry between two flights that do not share an airport stays
    // an area — the control shows the candidate's stations are the area's own.
    const control = await buildDraftWith(hubDeps(AWAY_HUB_IN), USER, INPUT, () => undefined);
    expect(control.dto.areas).toHaveLength(1);
    const [area] = control.dto.areas ?? [];
    expect(area.stations.map((s) => s.key)).toEqual(stopover.stations.map((s) => s.key));
    expect(area.stations.map((s) => s.kind)).toEqual(stopover.stations.map((s) => s.kind));
    expect(area.stations.map((s) => s.photoCount)).toEqual(
      stopover.stations.map((s) => s.photoCount)
    );
    expect(area.legs).toEqual(stopover.legs);
    expect(control.dto.stopovers).toEqual([]);
  });

  it("offers nothing from the stretch when the outing set is one photo short", async () => {
    // Four photos past the line and three at the airport: the outing test wants five.
    const short = photosAt("dh4", DUNHOLME, [
      "2031-05-02T12:00",
      "2031-05-02T13:00",
      "2031-05-02T14:00",
      "2031-05-02T15:00",
    ]);
    const atAirport = photosAt("nva", NORTHVALE, [
      "2031-05-02T10:10",
      "2031-05-02T10:20",
      "2031-05-02T10:30",
    ]);
    const draft = await buildDraftWith(
      hubDeps(HUB_IN, [...atAirport, ...short]),
      USER,
      INPUT,
      () => undefined
    );
    expect(draft.dto.stopovers).toEqual([]);
    // Still an area — the city stop 34 km out proves the geometry was there.
    expect(draft.dto.areas).toHaveLength(1);
    expect(draft.dto.areas[0].stations.map((s) => s.title)).toContain("Dunholme");
  });

  it("keeps a stretch between different airports an area, city visit and all", async () => {
    // City A → city B through Northvale: the flights do not share an airport,
    // so nothing here is a stopover, however real the visit between them.
    const draft = await buildDraftWith(hubDeps(AWAY_HUB_IN), USER, INPUT, () => undefined);
    expect(draft.dto.stopovers).toEqual([]);
    expect(draft.dto.areas).toHaveLength(1);
    expect(draft.dto.areas[0].stations.map((s) => s.title)).toContain("Dunholme");
  });

  it("keeps a stretch longer than the layover window an area, outing or not", async () => {
    // The same city and outing, but the outbound flight leaves the next
    // evening: a gap of 31h55 is no layover window, so the area stays.
    const lateOut = preciseFlight({
      id: G2,
      label: "ZZ110 NVL→SLM",
      depIata: "NVL",
      arrIata: "SLM",
      dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
      arr: { lat: -16.52, lon: -68.12 },
      depLocal: "2031-05-03T18:00",
      arrLocal: "2031-05-03T20:30",
    });
    const photos = photosAt("dhb", DUNHOLME, [
      "2031-05-02T11:00",
      "2031-05-02T12:00",
      "2031-05-02T13:00",
      "2031-05-02T14:00",
      "2031-05-02T15:00",
      "2031-05-03T09:00",
      "2031-05-03T10:00",
    ]);
    const draft = await buildDraftWith(
      hubDeps(HUB_IN, photos, { loadFlights: async () => [HUB_IN, lateOut] }),
      USER,
      INPUT,
      () => undefined
    );
    expect(draft.dto.stopovers).toEqual([]);
    expect(draft.dto.areas).toHaveLength(1);
    expect(draft.dto.areas[0].stations.map((s) => s.title)).toContain("Dunholme");
  });
});

// ─── A layover beside two reclassified areas, one name between them ─────────

const H1 = "1b2c3d4e-5f60-4172-9b3c-4d5e6f7a8b9c";
const H2 = "2c3d4e5f-6071-4283-ac4d-5e6f7a8b9c0d";
const H3 = "3d4e5f60-7182-4394-bd5e-6f7a8b9c0d1e";
const H4 = "4e5f6071-8293-44a5-ce6f-7a8b9c0d1e2f";
const H5 = "5f607182-93a4-45b6-df70-8b9c0d1e2f30";
const H6 = "60718293-a4b5-46c7-e081-9c0d1e2f3041";

/** Immich names the whole bay "Elmwood": the airport-side stop at 13 km and the far city at 34 km both carry the name. */
const FAR_ELMWOOD: Place = { lat: -44.744, lon: 168.7, city: "Elmwood", state: "Westshire" };

const E1 = preciseFlight({
  id: H1,
  label: "ZZ111 KMR→NVL",
  depIata: "KMR",
  arrIata: "NVL",
  dep: { lat: -43.49, lon: 172.53 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-05-02T08:00",
  arrLocal: "2031-05-02T10:05",
});
const E2 = preciseFlight({
  id: H2,
  label: "ZZ112 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-02T18:00",
  arrLocal: "2031-05-02T20:30",
});
const E3 = preciseFlight({
  id: H3,
  label: "ZZ113 SLM→NVL",
  depIata: "SLM",
  arrIata: "NVL",
  dep: { lat: -16.52, lon: -68.12 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-05-06T08:00",
  arrLocal: "2031-05-06T10:05",
});
const E4 = preciseFlight({
  id: H4,
  label: "ZZ114 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-06T18:00",
  arrLocal: "2031-05-06T20:30",
});
const E5 = preciseFlight({
  id: H5,
  label: "ZZ115 SLM→NVL",
  depIata: "SLM",
  arrIata: "NVL",
  dep: { lat: -16.52, lon: -68.12 },
  arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  depLocal: "2031-05-07T08:00",
  arrLocal: "2031-05-07T10:05",
});
const E6 = preciseFlight({
  id: H6,
  label: "ZZ116 NVL→SLM",
  depIata: "NVL",
  arrIata: "SLM",
  dep: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
  arr: { lat: -16.52, lon: -68.12 },
  depLocal: "2031-05-07T18:00",
  arrLocal: "2031-05-07T20:30",
});

const MIXED_INPUT: ScanInput = {
  name: "Southward twice",
  startDay: "2031-05-02",
  endDay: "2031-05-07",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

describe("buildDraftWith: a layover and two reclassified areas sharing one name", () => {
  it("keeps branch (a) exactly as it was and mints the branch-(b) titles after it", async () => {
    const assets = [
      ...photosAt("nvl", NORTHVALE, ["2031-05-02T10:10", "2031-05-02T10:20"]),
      ...photosAt("emw", ELMWOOD, [
        "2031-05-02T11:00",
        "2031-05-02T12:00",
        "2031-05-02T13:00",
        "2031-05-02T14:00",
        "2031-05-02T15:00",
      ]),
      ...photosAt("fwd", FAR_ELMWOOD, [
        "2031-05-06T11:00",
        "2031-05-06T12:00",
        "2031-05-06T13:00",
        "2031-05-06T14:00",
        "2031-05-06T15:00",
      ]),
      ...photosAt("fwe", FAR_ELMWOOD, [
        "2031-05-07T11:00",
        "2031-05-07T12:00",
        "2031-05-07T13:00",
        "2031-05-07T14:00",
        "2031-05-07T15:00",
      ]),
    ];
    const draft = await buildDraftWith(
      builderDeps(assets, {
        loadFlights: async () => [E1, E2, E3, E4, E5, E6],
        airports: async () =>
          new Map([
            [
              "NVL",
              { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
            ],
          ]),
      }),
      USER,
      MIXED_INPUT,
      () => undefined
    );
    const { dto } = draft;
    expect(dto.areas).toEqual([]);
    expect(dto.stopovers?.map((s) => s.key)).toEqual([`${H1}#${H2}`, `${H3}#${H4}`, `${H5}#${H6}`]);
    expect(dto.stopovers?.map((s) => s.city)).toEqual(["Elmwood", "Elmwood", "Elmwood"]);
    // Every trip of the journey shares the one convention (owner ruling
    // 2026-10-12): "<Journey> · <City>", and three trips sharing one city take
    // their own day suffixes, the one naming pass dealing them out (C.11's own
    // convention).
    expect(dto.stopovers?.map((s) => s.title)).toEqual([
      "Southward twice · Elmwood (2 May)",
      "Southward twice · Elmwood (6 May)",
      "Southward twice · Elmwood (7 May)",
    ]);
    const [layover] = dto.stopovers ?? [];
    expect(layover).toMatchObject({ day: "2031-05-02", airportIata: "NVL", photoCount: 7 });
    expect(layover.stations.map((s) => s.kind)).toEqual(["airport", "visit"]);
  });
});

// ─── One layover beside one roadtrip area: two trips, one rule ───────────────

describe("buildDraftWith: a layover beside a roadtrip area", () => {
  /** The destination's second city, so the area is a roadtrip (two cities). */
  const DUNMERE: Place = { lat: -46.5, lon: 169.7, city: "Dunmere", state: "Southland" };
  const AT_DUNMERE = photosAt("dm", DUNMERE, [
    "2031-05-03T12:00",
    "2031-05-03T13:00",
    "2031-05-03T14:00",
  ]);

  it("names the stopover and the area by the one convention, each from its own city", async () => {
    // Two offerings in one scan: counting them together is what the ruling
    // wants — neither kind is decided alone, so neither takes the bare journey
    // name (owner ruling 2026-10-12; the count spans both kinds).
    const draft = await buildDraftWith(midnightDeps({}), USER, INPUT, () => undefined);
    // The control: the single-city destination is a timeline stop, not a trip,
    // so the journey still holds one trip and the stopover keeps its name.
    expect(draft.dto.stopovers?.[0].title).toBe("Southern loop");

    const withArea = await buildDraftWith(
      builderDeps([...MID_AT_AIRPORT, ...MID_AT_ELMWOOD, ...AT_SOUTHHOLLOW, ...AT_DUNMERE], {
        loadFlights: async () => [MID_FLIGHT_IN, MID_FLIGHT_OUT],
        airports: async () =>
          new Map([
            [
              "NVL",
              { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
            ],
          ]),
      }),
      USER,
      INPUT,
      () => undefined
    );
    const { dto } = withArea;
    // Two cities make the destination a roadtrip, so the journey now holds two
    // trips and BOTH take the journey-and-city name.
    const roadtripArea = dto.areas.find((area) => area.defaultAs === "roadtrip");
    expect(roadtripArea?.suggestedName).toMatch(/^Southern loop · /);
    expect(dto.stopovers?.map((s) => s.title)).toEqual(["Southern loop · Elmwood"]);
  });
});

// ─── The photos stay in the days and the album; the night plan is untouched ──

describe("buildDraftWith: the reclassification leaves the nights and the day totals alone", () => {
  const withDestination = (inbound: typeof HUB_IN) =>
    builderDeps([...AT_DUNHOLME, ...AT_SOUTHHOLLOW], {
      loadFlights: async () => [inbound, HUB_OUT],
      airports: async () =>
        new Map([
          [
            "NVL",
            { name: "Northvale International Airport", lat: NORTHVALE.lat, lon: NORTHVALE.lon },
          ],
        ]),
    });

  it("keeps the night plan and the day counts of a scan that never reclassified", async () => {
    const draft = await buildDraftWith(withDestination(HUB_IN), USER, INPUT, () => undefined);
    const control = await buildDraftWith(
      withDestination(AWAY_HUB_IN),
      USER,
      INPUT,
      () => undefined
    );
    // The two scans differ only in whether the stretch left the areas.
    expect(draft.dto.stopovers).toHaveLength(1);
    expect(control.dto.stopovers).toEqual([]);
    expect(draft.dto.areas).toHaveLength(1);
    expect(draft.dto.areas[0].stations.map((s) => s.title)).toContain("Southhollow");
    expect(control.dto.areas).toHaveLength(2);

    // The night plan is the same plan, and the days count the same photos.
    expect(draft.dto.nights).toEqual(control.dto.nights);
    expect(Object.keys(draft.dto.nights)).toEqual(["2031-05-02"]);
    expect(draft.dto.nights["2031-05-02"].reason).toBe("afterLanding");
    expect(draft.dto.days.map((d) => d.photos)).toEqual(control.dto.days.map((d) => d.photos));
    expect(draft.dto.days.map((d) => d.photos)).toEqual([5, 5]);
    expect(draft.dto.stats).toEqual(control.dto.stats);

    // The stretch's photos stay in the stats and the main album's asset ids.
    expect(new Set(draft.albumAssetIds)).toEqual(
      new Set([...AT_DUNHOLME, ...AT_SOUTHHOLLOW].map((asset) => asset.id))
    );

    // And no night and no day names one of the stopover's stations.
    const stopoverKeys = new Set(
      (draft.dto.stopovers?.[0].stations ?? []).map((station) => station.key)
    );
    const dayKeys = draft.dto.days.flatMap((day) => day.stationKeys);
    const nightKeys = Object.values(draft.dto.nights).flatMap((night) => [
      night.assign,
      ...night.suggestedStationKeys,
    ]);
    expect([...dayKeys, ...nightKeys].filter((key) => stopoverKeys.has(key))).toEqual([]);
    expect(stopoverKeys.size).toBe(3);
  });
});
