import { assembleWarnings, movementOutsideDates, type WarningInput } from "../draftWarnings";
import type { DraftStats, HomeAtDay, PhotoPoint } from "../types";
import { NORTHVALE, preciseFlight } from "./builderFixtures";

const WINDOW = {
  startDay: "2031-05-02",
  endDay: "2031-05-06",
  contextFromDay: "2031-04-29",
  contextToDay: "2031-05-09",
};
const STATS: DraftStats = {
  assets: 10,
  images: 10,
  videos: 0,
  located: 10,
  excluded: {
    partner: 0,
    hiddenLivePart: 0,
    misdated: 0,
    inFlight: 0,
    atSea: 0,
    unlocated: 0,
    dayGuessed: 0,
  },
  truncated: false,
};
const QUIET: WarningInput = {
  inspect: true,
  window: WINDOW,
  stats: STATS,
  unrecordedFlights: [],
  roads: { available: true, canProbe: true },
  hasLegs: true,
  noRoadData: [],
  roadtripsHidden: false,
  overlapping: [],
  flights: [],
  outsideMovement: [],
  pendingJourneyIds: [],
  albumLinkedElsewhere: null,
  homeUnconfirmed: false,
};
const F1 = "ff0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
const FLIGHT = preciseFlight({
  id: F1,
  label: "ZZ101 ZPC→ZEP",
  depIata: "ZPC",
  arrIata: "ZEP",
  dep: { lat: -44.72, lon: 169.17 },
  arr: { lat: -38.02, lon: 177.01 },
  depLocal: "2031-05-01T22:00",
  arrLocal: "2031-05-02T00:30",
});

describe("assembleWarnings", () => {
  it("says nothing when nothing is wrong", () => {
    expect(assembleWarnings(QUIET)).toEqual([]);
  });

  it("reports every warning in the documented order", () => {
    const warnings = assembleWarnings({
      ...QUIET,
      stats: { ...STATS, truncated: true },
      unrecordedFlights: [
        { fromDay: "2031-05-03", toDay: "2031-05-04", nearestAirports: { from: "ZPC", to: null } },
      ],
      roads: { available: false, canProbe: false },
      noRoadData: ["-894|3383|2031-05-04"],
      roadtripsHidden: true,
      overlapping: [{ name: "Winter in Tarn", startDay: "2031-01-01", endDay: "2031-12-31" }],
      flights: [FLIGHT],
      outsideMovement: [{ code: "movementOutsideDates", params: { day: "2031-05-01", km: 120 } }],
      pendingJourneyIds: ["j-1"],
      albumLinkedElsewhere: "Rented cabin",
      homeUnconfirmed: true,
    });

    expect(warnings.map((w) => w.code)).toEqual([
      "truncated",
      "possibleUnrecordedFlight",
      "noRouting",
      "noRoadData",
      "roadtripsHidden",
      "overlappingTrip",
      "flightOutsideDates",
      "movementOutsideDates",
      "pendingPhotoJourneys",
      "albumLinkedElsewhere",
      "homeUnconfirmed",
    ]);
    expect(warnings.find((w) => w.code === "overlappingTrip")).toEqual({
      code: "overlappingTrip",
      params: {
        name: "Winter in Tarn",
        startDay: "2031-01-01",
        endDay: "2031-12-31",
        suspiciouslyLong: true,
      },
    });
    expect(warnings.find((w) => w.code === "flightOutsideDates")).toEqual({
      code: "flightOutsideDates",
      params: { flightId: F1, suggestStartDay: "2031-05-01" },
    });
  });

  it("says cannotSnap when routing exists but cannot probe", () => {
    const warnings = assembleWarnings({ ...QUIET, roads: { available: true, canProbe: false } });
    expect(warnings).toEqual([{ code: "cannotSnap", params: {} }]);
  });

  it("keeps the routing warnings quiet when no area has a leg", () => {
    const warnings = assembleWarnings({
      ...QUIET,
      hasLegs: false,
      roads: { available: false, canProbe: false },
    });
    expect(warnings).toEqual([]);
  });

  it("reports an empty window with the span it checked", () => {
    const warnings = assembleWarnings({
      ...QUIET,
      stats: {
        ...STATS,
        assets: 0,
        images: 0,
        located: 0,
        excluded: { ...STATS.excluded, partner: 4 },
      },
    });
    expect(warnings).toEqual([
      {
        code: "emptyWindow",
        params: {
          checkedFrom: "2031-04-29",
          checkedTo: "2031-05-09",
          partner: 4,
          trashedNote: true,
        },
      },
    ]);
  });

  it("reports photos without any location", () => {
    const warnings = assembleWarnings({ ...QUIET, stats: { ...STATS, located: 0 } });
    expect(warnings).toEqual([{ code: "noLocatedPhotos", params: {} }]);
  });

  it("suggests dates only for flights that are ticked and reach outside the window", () => {
    const late = preciseFlight({
      id: "aa0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
      label: "ZZ102 ZEP→ZPC",
      depIata: "ZEP",
      arrIata: "ZPC",
      dep: { lat: -38.02, lon: 177.01 },
      arr: { lat: -44.72, lon: 169.17 },
      depLocal: "2031-05-06T23:00",
      arrLocal: "2031-05-07T00:30",
    });
    const filedElsewhere = preciseFlight({
      id: "bb0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
      label: "ZZ103 ZPC→ZEP",
      depIata: "ZPC",
      arrIata: "ZEP",
      dep: { lat: -44.72, lon: 169.17 },
      arr: { lat: -38.02, lon: 177.01 },
      depLocal: "2031-05-01T22:00",
      arrLocal: "2031-05-02T00:30",
      tripId: "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01",
      tripName: "Winter in Tarn",
    });
    const warnings = assembleWarnings({ ...QUIET, flights: [late, filedElsewhere] });
    expect(warnings).toEqual([
      { code: "flightOutsideDates", params: { flightId: late.id, suggestEndDay: "2031-05-07" } },
    ]);
  });

  it("leaves the movement warnings out of an album-only scan", () => {
    const warnings = assembleWarnings({
      ...QUIET,
      inspect: false,
      roads: { available: false, canProbe: false },
      noRoadData: ["k"],
      unrecordedFlights: [
        { fromDay: "2031-05-03", toDay: "2031-05-04", nearestAirports: { from: null, to: null } },
      ],
      outsideMovement: [{ code: "movementOutsideDates", params: { day: "2031-05-01", km: 99 } }],
      homeUnconfirmed: true,
      stats: { ...STATS, located: 0 },
    });
    expect(warnings).toEqual([]);
  });
});

describe("movementOutsideDates", () => {
  const HOME: HomeAtDay = {
    name: "Kelmore, Westshire",
    lat: -45.6,
    lon: 169.3,
    confirmed: true,
    zone: "Pacific/Auckland",
    airports: new Set(["ZKM"]),
  };
  const homeAt = () => HOME;
  const window = { startDay: "2031-05-02", endDay: "2031-05-06" };

  /** Only the fields the check reads; the rest of a PhotoPoint is irrelevant to it. */
  function contextPhoto(id: string, day: string, lat: number, lon: number): PhotoPoint {
    return {
      id,
      day,
      lat,
      lon,
      flags: { located: true, duplicate: false },
    } as unknown as PhotoPoint;
  }

  it("names the last day before and the first day after the window that continue the trip", () => {
    const warnings = movementOutsideDates({
      context: [
        contextPhoto("a", "2031-04-30", NORTHVALE.lat, NORTHVALE.lon),
        contextPhoto("b", "2031-05-01", NORTHVALE.lat, NORTHVALE.lon),
        contextPhoto("c", "2031-05-07", NORTHVALE.lat, NORTHVALE.lon),
      ],
      window,
      firstStation: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
      lastStation: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
      homeAt,
    });
    // 77 km: the great-circle distance from Northvale (−45.05, 168.70) to the residence (−45.60, 169.30).
    expect(warnings.map((w) => w.params)).toEqual([
      { day: "2031-05-01", km: 77 },
      { day: "2031-05-07", km: 77 },
    ]);
  });

  it("ignores a photo far from the stations", () => {
    const warnings = movementOutsideDates({
      context: [contextPhoto("far", "2031-05-07", -36.85, 174.76)],
      window,
      firstStation: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
      lastStation: { lat: NORTHVALE.lat, lon: NORTHVALE.lon },
      homeAt,
    });
    expect(warnings).toEqual([]);
  });

  it("ignores photos taken at home even when a station is a few kilometres from them", () => {
    // About 10 km north of the residence: inside CITY_LINK_KM of the home photos, so the
    // check can only be settled by the distance from home.
    const nearHome = { lat: HOME.lat + 0.09, lon: HOME.lon };
    const warnings = movementOutsideDates({
      context: [
        contextPhoto("before", "2031-05-01", HOME.lat, HOME.lon),
        contextPhoto("after", "2031-05-07", HOME.lat, HOME.lon),
      ],
      window,
      firstStation: nearHome,
      lastStation: nearHome,
      homeAt,
    });
    expect(warnings).toEqual([]);
  });

  it("draws the line at the home radius for photos that continue from a station", () => {
    // A station 30 km north of the residence; one photo 25 km out (inside the home radius)
    // and one 35 km out (past it), both a few kilometres from the station.
    const station = { lat: HOME.lat + 0.27, lon: HOME.lon };
    const warnings = movementOutsideDates({
      context: [
        contextPhoto("inside", "2031-05-01", HOME.lat + 0.225, HOME.lon),
        contextPhoto("past", "2031-05-07", HOME.lat + 0.315, HOME.lon),
      ],
      window,
      firstStation: station,
      lastStation: station,
      homeAt,
    });
    expect(warnings.map((w) => w.params)).toEqual([{ day: "2031-05-07", km: 35 }]);
  });
});
