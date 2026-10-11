import type { AirportData } from "../../airportLookup";
import { stationKeyOf } from "../stations";
import { stopoverCity, stopoverOf, stopoverStations, stopoverTitle } from "../stopovers";
import type { FlightAnchor, Layover, NamedCluster, PhotoPoint } from "../types";
import { makePhoto } from "./photoFixtures";
import { anchor } from "./planFixtures";
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

describe("the stopover's name", () => {
  it("is `<City> <Year> Road Trip`", () => {
    expect(stopoverTitle("Elmwood", "2031-05-02", new Set<string>())).toBe(
      "Elmwood 2031 Road Trip"
    );
  });

  it("suffixes a later same-city candidate with its day, so two candidates never share a title", () => {
    const first = stopoverTitle("Elmwood", "2031-05-02", new Set<string>());
    const second = stopoverTitle("Elmwood", "2031-05-06", new Set([first]));
    expect(first).toBe("Elmwood 2031 Road Trip");
    expect(second).toBe("Elmwood 2031 Road Trip (6 May)");
    // Even two candidates on one day stay apart: the day suffix itself is deduplicated (C.11).
    const third = stopoverTitle("Elmwood", "2031-05-06", new Set([first, second]));
    expect(third).toBe("Elmwood 2031 Road Trip (6 May) 2");
  });

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
      takenTitles: new Set<string>(),
    });
    expect(stopover.key).toBe("f1#f2");
    expect(stopover.title).toBe("Elmwood 2031 Road Trip");
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
