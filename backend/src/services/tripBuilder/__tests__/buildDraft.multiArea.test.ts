import { buildDraftWith } from "../buildDraft";
import type { ScanInput } from "../types";
import {
  NORTHVALE,
  PORT_CARROW,
  builderDeps,
  countryAtFixture,
  photosAt,
  preciseFlight,
  type Place,
} from "./builderFixtures";

const USER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const TRIP = "7e5d9a14-3b2c-4d8f-9a1e-5c6b7d8e9f01";
const F1 = "f1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b";

const EASTPORT: Place = { lat: -38.0, lon: 177.0, city: "Eastport", state: "Eastshire" };
const FENWICK: Place = { lat: -37.7, lon: 176.25, city: "Fenwick", state: "Eastshire" };
const ZPC = { lat: -44.72, lon: 169.17 };
const ZEP = { lat: -38.02, lon: 177.01 };

const FLIGHT = preciseFlight({
  id: F1,
  label: "ZZ101 ZPC→ZEP",
  depIata: "ZPC",
  arrIata: "ZEP",
  dep: ZPC,
  arr: ZEP,
  depLocal: "2031-05-04T18:00",
  arrLocal: "2031-05-04T19:45",
});

/** Area A: Northvale (two nights) and Port Carrow, then a flight. Area B: Eastport (three nights) and Fenwick. */
const AREA_A = [
  ...photosAt("nv", NORTHVALE, [
    "2031-05-02T10:00",
    "2031-05-02T14:00",
    "2031-05-02T19:00",
    "2031-05-03T09:00",
    "2031-05-03T12:00",
    "2031-05-03T19:00",
  ]),
  ...photosAt("pc", PORT_CARROW, ["2031-05-04T10:00", "2031-05-04T13:00", "2031-05-04T15:00"]),
];
const AREA_B = [
  ...photosAt("ep", EASTPORT, [
    "2031-05-05T09:00",
    "2031-05-05T15:00",
    "2031-05-05T21:00",
    "2031-05-06T10:00",
    "2031-05-06T16:00",
    "2031-05-06T21:00",
  ]),
  ...photosAt("fw", FENWICK, ["2031-05-07T10:00", "2031-05-07T12:00", "2031-05-07T15:00"]),
];

const NEW_TRIP: ScanInput = {
  name: "Southern loop",
  startDay: "2031-05-02",
  endDay: "2031-05-07",
  inspect: true,
  createAlbum: false,
  target: { kind: "new" },
};

describe("buildDraftWith: two ground areas joined by a flight", () => {
  const deps = () =>
    builderDeps([...AREA_A, ...AREA_B], {
      loadFlights: async () => [FLIGHT],
      countryAt: countryAtFixture,
    });

  it("makes a roadtrip of each area and names them after the trip and their main city", async () => {
    const { dto } = await buildDraftWith(deps(), USER, NEW_TRIP, () => undefined);

    expect(dto.areas).toHaveLength(2);
    const [a, b] = dto.areas;
    expect([a.defaultAs, b.defaultAs]).toEqual(["roadtrip", "roadtrip"]);
    expect([a.suggestedName, b.suggestedName]).toEqual([
      "Southern loop · Northvale",
      "Southern loop · Eastport",
    ]);
    expect([a.mainCity, b.mainCity]).toEqual(["Northvale", "Eastport"]);
    expect(a.stations.map((s) => s.title)).toEqual(["Northvale", "Port Carrow"]);
    expect(b.stations.map((s) => s.title)).toEqual(["Eastport", "Fenwick"]);
    expect(a.beforeFlightId).toBe(F1);
    expect(b.afterFlightId).toBe(F1);
    expect(a.key).toMatch(/^\d{4}-\d{2}-\d{2}#1$/);
    expect(b.key).toMatch(/^\d{4}-\d{2}-\d{2}#1$/);
  });

  it("gives the night of the landing to the first station after it and pulls that station back a day", async () => {
    const { dto } = await buildDraftWith(deps(), USER, NEW_TRIP, () => undefined);
    const [a, b] = dto.areas;
    const [northvale] = a.stations;
    const [eastport] = b.stations;

    expect(dto.nights).toMatchObject({
      "2031-05-02": { assign: northvale.key, reason: "lastPhoto" },
      "2031-05-03": { assign: northvale.key, reason: "lastPhoto" },
      "2031-05-04": { assign: eastport.key, reason: "afterLanding" },
      "2031-05-05": { assign: eastport.key, reason: "lastPhoto" },
      "2031-05-06": { assign: eastport.key, reason: "lastPhoto" },
    });
    // The key keeps the first PHOTO day; the shown first day is pulled to the landing night.
    expect(eastport.key.endsWith("|2031-05-05")).toBe(true);
    expect(eastport.firstDay).toBe("2031-05-04");
    expect(b.startDay).toBe("2031-05-04");
  });

  it("lists the flight and warns only that nothing can route", async () => {
    const { dto } = await buildDraftWith(deps(), USER, NEW_TRIP, () => undefined);

    expect(dto.flights).toEqual([
      expect.objectContaining({
        id: F1,
        depLocal: "2031-05-04 18:00",
        arrLocal: "2031-05-04 19:45",
        precise: true,
        defaultAssign: true,
      }),
    ]);
    expect(dto.warnings).toEqual([{ code: "noRouting", params: {} }]);
  });
});

describe("buildDraftWith: naming a roadtrip on an existing trip", () => {
  const input: ScanInput = {
    name: "Southern loop",
    startDay: "2031-05-02",
    endDay: "2031-05-04",
    inspect: true,
    createAlbum: false,
    target: { kind: "existing", tripId: TRIP },
  };
  const target = (roadtripNames: string[]) => ({
    id: TRIP,
    name: "Southern loop",
    countries: ["AU"],
    roadtripNames,
  });

  it("uses the trip's exact name when no roadtrip of that name exists yet", async () => {
    const { dto } = await buildDraftWith(
      builderDeps(AREA_A, { targetTrip: target([]) }),
      USER,
      input,
      () => undefined
    );
    expect(dto.areas).toHaveLength(1);
    expect(dto.areas[0].suggestedName).toBe("Southern loop");
    expect(dto.target).toEqual({ kind: "existing", tripId: TRIP, tripName: "Southern loop" });
  });

  it("uses the '·' form when the trip already has a roadtrip of its name, and unions the countries", async () => {
    const { dto } = await buildDraftWith(
      builderDeps(AREA_A, { targetTrip: target(["Southern loop"]) }),
      USER,
      input,
      () => undefined
    );
    expect(dto.areas[0].suggestedName).toBe("Southern loop · Northvale");
    expect([...dto.countries].sort()).toEqual(["AU", "NZ"]);
  });
});
