import { buildDraftWith } from "../buildDraft";
import type { ScanInput } from "../types";
import {
  HOME_PERIODS,
  builderDeps,
  countryAtFixture,
  nzAsset,
  photosAt,
  preciseFlight,
  type Place,
} from "./builderFixtures";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const INPUT: ScanInput = {
  name: "Northcote week",
  startDay: "2031-06-10",
  endDay: "2031-06-19",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

const NORTHCOTE_BAY: Place = {
  lat: -36.85,
  lon: 174.76,
  city: "Northcote Bay",
  state: "Eastshire",
};
const KELMORE: Place = { lat: -45.6, lon: 169.3, city: "Kelmore", state: "Westshire" };
const MIDHAVEN: Place = { lat: -41.33, lon: 174.8, city: "Midhaven", state: "Midshire" };
const ZKM = { lat: -45.63, lon: 169.32 };
const ZNC = { lat: -37.01, lon: 174.79 };
const ZMH = { lat: -41.33, lon: 174.8 };

const F1 = "f1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";
const F2 = "f2a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";
const F3 = "f3a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";

/** A red-eye out of home, a week in one city, a connection with a layover, a flight home. */
const FLIGHTS = [
  preciseFlight({
    id: F1,
    label: "ZZ101 ZKM→ZNC",
    depIata: "ZKM",
    arrIata: "ZNC",
    dep: ZKM,
    arr: ZNC,
    depLocal: "2031-06-09T23:15",
    arrLocal: "2031-06-10T00:45",
  }),
  preciseFlight({
    id: F2,
    label: "ZZ102 ZNC→ZMH",
    depIata: "ZNC",
    arrIata: "ZMH",
    dep: ZNC,
    arr: ZMH,
    depLocal: "2031-06-18T15:30",
    arrLocal: "2031-06-18T16:50",
  }),
  preciseFlight({
    id: F3,
    label: "ZZ103 ZMH→ZKM",
    depIata: "ZMH",
    arrIata: "ZKM",
    dep: ZMH,
    arr: ZKM,
    depLocal: "2031-06-18T19:30",
    arrLocal: "2031-06-18T21:00",
  }),
];

const cityDays = ["10", "11", "12", "13", "14", "15", "16", "17"];
const ASSETS = [
  // Eight minutes before landing, 4.5 km from the airport: on the ground.
  nzAsset({
    id: "early",
    local: "2031-06-10T00:37",
    lat: -36.97,
    lon: 174.78,
    city: "Northcote Bay",
    state: "Eastshire",
  }),
  ...cityDays.flatMap((d) =>
    photosAt(`city-${d}`, NORTHCOTE_BAY, [
      `2031-06-${d}T10:00`,
      `2031-06-${d}T15:00`,
      `2031-06-${d}T21:00`,
    ])
  ),
  ...photosAt("city-18", NORTHCOTE_BAY, ["2031-06-18T10:00", "2031-06-18T13:30"]),
  // Taken in the air between ZNC and ZMH.
  nzAsset({ id: "air", local: "2031-06-18T16:05", lat: -39.2, lon: 174.9 }),
  // Taken at the connection airport between the two flights.
  ...photosAt("layover", MIDHAVEN, ["2031-06-18T17:30", "2031-06-18T18:15"]),
  // Back home on the last day.
  ...photosAt("home", KELMORE, ["2031-06-19T09:00", "2031-06-19T11:00"]),
];

describe("buildDraftWith: a red-eye, one city, a layover and a flight home", () => {
  async function build() {
    return buildDraftWith(
      builderDeps(ASSETS, {
        loadFlights: async () => FLIGHTS,
        homePeriods: HOME_PERIODS,
        countryAt: countryAtFixture,
        airports: async () =>
          new Map([
            ["ZKM", { iata: "ZKM", name: "Kelmore Airport", lat: ZKM.lat, lon: ZKM.lon }],
            ["ZNC", { iata: "ZNC", name: "Northcote Bay Airport", lat: ZNC.lat, lon: ZNC.lon }],
            ["ZMH", { iata: "ZMH", name: "Midhaven Airport", lat: ZMH.lat, lon: ZMH.lon }],
          ]),
      }),
      USER,
      INPUT,
      () => undefined
    );
  }

  it("keeps the one city as a timeline stop and drops the area after the return home", async () => {
    const { dto } = await build();

    expect(dto.areas).toHaveLength(1);
    const area = dto.areas[0];
    expect(area).toMatchObject({ defaultAs: "stops", afterFlightId: F1, beforeFlightId: F2 });
    expect(area.stations.map((s) => [s.title, s.kind])).toEqual([["Northcote Bay", "visit"]]);
    expect(area.home.start.offered).toBe(false);
    expect(area.home.end.offered).toBe(false);
  });

  it("sleeps in the city eight nights and the last night at home after landing", async () => {
    const { dto } = await build();
    const city = dto.areas[0].stations[0].key;

    expect(Object.keys(dto.nights)).toHaveLength(9);
    for (const d of cityDays) {
      expect(dto.nights[`2031-06-${d}`]).toMatchObject({ assign: city, reason: "lastPhoto" });
    }
    expect(dto.nights["2031-06-18"]).toMatchObject({ assign: "home", reason: "afterLanding" });
  });

  it("lists the red-eye of the day before the window, ticked, with a suggestion to start a day earlier", async () => {
    const { dto, flightIds } = await build();

    expect(dto.flights.map((f) => [f.id, f.depLocal, f.defaultAssign])).toEqual([
      [F1, "2031-06-09 23:15", true],
      [F2, "2031-06-18 15:30", true],
      [F3, "2031-06-18 19:30", true],
    ]);
    expect(flightIds).toEqual(new Set([F1, F2, F3]));
    expect(dto.warnings).toEqual([
      { code: "flightOutsideDates", params: { flightId: F1, suggestStartDay: "2031-06-09" } },
    ]);
  });

  it("shows the connection's ground photos under the flight that landed there", async () => {
    const { dto } = await build();
    expect(dto.flights[1].layover).toEqual({ photoCount: 2, airportIata: "ZMH" });
    expect(dto.flights[0].layover).toBeUndefined();
    expect(dto.flights[2].layover).toBeUndefined();
  });

  it("keeps the photos taken in the air in the album but out of the stations", async () => {
    const { dto, albumAssetIds } = await build();

    expect(dto.stats.excluded.inFlight).toBe(1);
    expect(dto.stats.assets).toBe(ASSETS.length);
    expect(albumAssetIds).toContain("air-1".replace("-1", ""));
    expect(dto.areas[0].stations[0].photoCount).toBe(1 + 8 * 3 + 2);
  });

  it("fills the countries and the origin and destination labels", async () => {
    const { dto } = await build();

    expect(dto.countries).toEqual(["NZ"]);
    expect(dto.originLabel).toBe("Kelmore");
    expect(dto.destinationLabel).toBe("Northcote Bay");
    expect(dto.days).toHaveLength(10);
    expect(dto.days[0]).toMatchObject({ day: "2031-06-10", flightIds: [F1] });
    expect(dto.days[8]).toMatchObject({ day: "2031-06-18", flightIds: [F2, F3] });
    expect(dto.days[9]).toMatchObject({ day: "2031-06-19", photos: 2, stationKeys: [] });
  });
});
