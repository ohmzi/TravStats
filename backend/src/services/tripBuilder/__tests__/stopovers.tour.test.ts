import type { AirportData } from "../../airportLookup";
import { stationKeyOf } from "../stations";
import {
  stopoverAreaCity,
  stopoverCity,
  stopoverFromArea,
  stopoverOf,
  stopoverStations,
} from "../stopovers";
import type { FlightAnchor, Layover, NamedCluster, PhotoPoint, PlanLeg } from "../types";
import { makePhoto } from "./photoFixtures";
import { anchor, groundArea, planOf, station } from "./planFixtures";
import { NORTHVALE } from "./placeFixtures";

/**
 * The stopover tour (spec 2026-10-11 §2.2): the arrival airport first, then the
 * outing set's clusters, named by the chain, with the legs between them.
 * Synthetic places only (public repository).
 */
/** About 6.0 km north of the airport: outside the 5 km outing line. */
const FAR = { lat: NORTHVALE.lat + 0.054, lon: NORTHVALE.lon };

const photo = (id: string, local: string): PhotoPoint =>
  makePhoto({ id, local, lat: FAR.lat, lon: FAR.lon });

const PHOTOS = [
  photo("p1", "2031-05-02 11:00"),
  photo("p2", "2031-05-02 12:00"),
  photo("p3", "2031-05-02 13:00"),
  photo("p4", "2031-05-02 14:00"),
  photo("p5", "2031-05-02 15:00"),
];

const LAYOVER: Layover = {
  inFlightId: "f1",
  outFlightId: "f2",
  airportIata: "NVL",
  photoIds: ["p1", "p2", "p3", "p4", "p5"],
};

/** ZZ101 lands at Northvale on 2 May at 10:05. */
const IN_FLIGHT: FlightAnchor = anchor({ arr: { lat: NORTHVALE.lat, lon: NORTHVALE.lon } });

/** The catalogue row the airport station is titled from. */
const AIRPORT_ROW: AirportData = {
  name: "Northvale International Airport",
  lat: NORTHVALE.lat,
  lon: NORTHVALE.lon,
};

const cluster = (over: Partial<NamedCluster> = {}): NamedCluster => ({
  id: "c1",
  photoIds: ["p1", "p2", "p3", "p4", "p5"],
  lat: FAR.lat,
  lon: FAR.lon,
  spreadKm: 1,
  immichCity: "Elmwood",
  immichState: "Westshire",
  immichCountry: null,
  title: "Elmwood",
  titleSource: "immich",
  isHome: false,
  ...over,
});

const build = (named: NamedCluster[], taken: Set<string> = new Set()) => {
  const tour = stopoverStations({
    layover: LAYOVER,
    inFlight: IN_FLIGHT,
    airport: AIRPORT_ROW,
    named,
    photosById: new Map(PHOTOS.map((p) => [p.id, p] as const)),
    taken,
  });
  if (tour === null) throw new Error("the fixture always makes a tour");
  return tour;
};

describe("stopoverStations", () => {
  it("starts the tour with the arrival airport, so one cluster still yields two stations", () => {
    const tour = build([cluster()]);
    expect(tour.stations).toHaveLength(2);
    expect(tour.stations.map((s) => s.kind)).toEqual(["airport", "visit"]);
    expect(tour.stations.map((s) => s.title)).toEqual(["Northvale", "Elmwood"]);
    expect(tour.stations[0].titleSource).toBe("airport");
    expect(tour.stations[0].firstDay).toBe(IN_FLIGHT.arrDay);
    expect(tour.stations[0].previewIdx).toEqual([]);
    expect(tour.stations[1].photoCount).toBe(5);
    expect(tour.stations[1].firstDay).toBe("2031-05-02");
    expect(tour.stations[1].lastDay).toBe("2031-05-02");
    expect([...tour.spanMs.keys()]).toEqual([tour.stations[1].key]);
    expect(tour.previewPhotoIds.get(tour.stations[1].key)).toHaveLength(5);
  });

  it("mints its station keys from the scan's shared taken set", () => {
    const base = stationKeyOf(FAR.lat, FAR.lon, "2031-05-02");
    const tour = build([cluster()], new Set([base]));
    expect(tour.stations[1].key).toBe(`${base}~2`);
  });

  it("dates the stopover from its first outing photo", () => {
    expect(build([cluster()]).day).toBe("2031-05-02");
  });
});

describe("the stopover's city", () => {
  // The name is not minted here any more (owner ruling 2026-10-12): one naming
  // pass over every trip of the journey, in `buildDraftWith`, names the area
  // roadtrips and the stopovers together. What the stopover contributes is its
  // city and its day.
  it("takes the naming chain's answer, or the airport's city when it has only coordinates", () => {
    expect(stopoverCity([cluster()], AIRPORT_ROW)).toBe("Elmwood");
    const coords = cluster({
      title: `${FAR.lat.toFixed(2)}, ${FAR.lon.toFixed(2)}`,
      titleSource: "coords",
    });
    expect(stopoverCity([coords], AIRPORT_ROW)).toBe("Northvale");
  });
});

describe("stopoverOf", () => {
  it("stores the whole layover's photo set, the tour and its one leg", () => {
    const tour = build([cluster()]);
    const stopover = stopoverOf({
      layover: LAYOVER,
      tour,
      probes: [{ distanceKm: 32.5, ferryKm: 0 }],
      countryAt: () => "NZ",
    });
    expect(stopover.key).toBe("f1#f2");
    // No name yet: the one naming pass in `buildDraftWith` names every trip.
    expect("title" in stopover).toBe(false);
    expect(stopover.city).toBe("Elmwood");
    expect(stopover.day).toBe("2031-05-02");
    expect(stopover.airportIata).toBe("NVL");
    expect(stopover.photoIds).toEqual(LAYOVER.photoIds);
    expect(stopover.legs).toHaveLength(1);
    expect(stopover.legs[0]).toMatchObject({
      fromKey: stopover.stations[0].key,
      toKey: stopover.stations[1].key,
      routedKm: 32.5,
      mode: "road",
      ferryEvidence: null,
    });
    expect(stopover.legs[0].chordKm).toBeCloseTo(6.0, 1);
  });
});

// ─── Branch (b): the area's own stations become the tour (spec §2 amended) ───

/** The flight that landed before the stretch, and the one it precedes. */
const AREA_IN: FlightAnchor = anchor({ id: "f1" });
const AREA_OUT: FlightAnchor = anchor({ id: "f2", label: "ZZ102 NVL→SLM", depIata: "NVL" });

/** The whole stretch, two hours at the airport and a day in the city. */
const AREA = groundArea({
  photoIds: ["p1", "p2", "p3", "p4", "p5"],
  seaPhotoIds: ["p6"],
  afterFlightId: "f1",
  beforeFlightId: "f2",
  startDay: "2031-05-02",
  endDay: "2031-05-02",
});

const AREA_LEGS: PlanLeg[] = [
  {
    fromKey: "k-airport",
    toKey: "k-city",
    chordKm: 34,
    routedKm: null,
    mode: "road",
    ferryEvidence: null,
  },
];

/** The area's own plan, as the scan built it: the airport anchors and the city stop. */
const AREA_PLAN = planOf(
  [
    station("k-airport", {
      title: "Northvale",
      titleSource: "airport",
      kind: "airport",
      photoCount: 0,
    }),
    station("k-city", { title: "Elmwood", kind: "visit", photoCount: 5, previewIdx: [0, 1] }),
  ],
  { legs: AREA_LEGS }
);

/** Five photos in the city, all past the 5 km line, the first one at 11:00. */
const AREA_OUTING = ["p1", "p2", "p3", "p4", "p5"].map((id, index) =>
  makePhoto({ id, local: `2031-05-02 ${String(11 + index).padStart(2, "0")}:00` })
);

describe("stopoverFromArea (branch (b))", () => {
  it("keeps the area's own stations and legs and stores the whole stretch as the album list", () => {
    const stopover = stopoverFromArea({
      area: AREA,
      inFlight: AREA_IN,
      outFlight: AREA_OUT,
      plan: AREA_PLAN,
      airport: AIRPORT_ROW,
      outing: AREA_OUTING,
    });
    expect(stopover).not.toBeNull();
    expect(stopover).toMatchObject({
      key: "f1#f2",
      city: "Elmwood",
      day: "2031-05-02",
      inFlightId: "f1",
      outFlightId: "f2",
      airportIata: "NVL",
    });
    // Verbatim: the stations, their keys and previews, and the legs as the areas built them.
    expect(stopover?.stations).toEqual(AREA_PLAN.stations);
    expect(stopover?.legs).toEqual(AREA_LEGS);
    // The album list is the stretch's movement and at-sea photos together.
    expect(stopover?.photoIds).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
  });

  it("refuses an area with no ground station to name it after", () => {
    const airportOnly = planOf([
      station("k-airport", { title: "Northvale", titleSource: "airport", kind: "airport" }),
    ]);
    expect(
      stopoverFromArea({
        area: AREA,
        inFlight: AREA_IN,
        outFlight: AREA_OUT,
        plan: airportOnly,
        airport: AIRPORT_ROW,
        outing: AREA_OUTING,
      })
    ).toBeNull();
  });

  it("names the city after the biggest ground station, the airport's city when it has only coordinates", () => {
    expect(
      stopoverAreaCity(
        [
          station("k1", { title: "Elmwood", photoCount: 5 }),
          station("k2", { title: "Port Carrow", photoCount: 9 }),
        ],
        AIRPORT_ROW
      )
    ).toBe("Port Carrow");
    expect(
      stopoverAreaCity(
        [
          station("k1", {
            title: `${NORTHVALE.lat}, ${NORTHVALE.lon}`,
            titleSource: "coords",
            photoCount: 9,
          }),
        ],
        AIRPORT_ROW
      )
    ).toBe("Northvale");
  });
});
