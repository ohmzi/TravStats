import { isStopoverCandidate, outingOf } from "../stopovers";
import type { Layover, PhotoPoint } from "../types";
import { makePhoto } from "./photoFixtures";
import { NORTHVALE } from "./placeFixtures";

/**
 * A layover's outing set (spec 2026-10-11 §2): the geotagged photos further
 * than STOPOVER_MIN_KM from the airport, of which STOPOVER_MIN_PHOTOS offer a
 * roadtrip. Synthetic places only (public repository).
 */
const AIRPORT = { lat: NORTHVALE.lat, lon: NORTHVALE.lon };
/** About 4.0 km north of the airport: inside the 5 km line. */
const NEAR = { lat: AIRPORT.lat + 0.036, lon: AIRPORT.lon };
/** About 6.0 km north: outside it. */
const FAR = { lat: AIRPORT.lat + 0.054, lon: AIRPORT.lon };

const photo = (
  id: string,
  at: { lat: number; lon: number },
  local = "2031-05-02 11:00"
): PhotoPoint => makePhoto({ id, local, lat: at.lat, lon: at.lon });

const photosById = (photos: readonly PhotoPoint[]): Map<string, PhotoPoint> =>
  new Map(photos.map((p) => [p.id, p] as const));

const LAYOVER: Layover = {
  inFlightId: "f1",
  outFlightId: "f2",
  airportIata: "NVL",
  photoIds: ["p1", "p2", "p3", "p4", "p5", "p6"],
};

describe("outingOf", () => {
  it("keeps the photos further than 5 km from the airport and drops the airport's own", () => {
    const outing = outingOf(
      LAYOVER,
      photosById([
        photo("p1", AIRPORT),
        photo("p2", NEAR),
        photo("p3", FAR),
        photo("p4", FAR),
        photo("p5", FAR),
        photo("p6", FAR),
      ]),
      AIRPORT
    );
    expect(outing.map((p) => p.id)).toEqual(["p3", "p4", "p5", "p6"]);
  });

  it("answers in the order the photos were taken", () => {
    const outing = outingOf(
      LAYOVER,
      photosById([
        photo("p1", FAR, "2031-05-02 15:00"),
        photo("p2", FAR, "2031-05-02 12:00"),
        photo("p3", FAR, "2031-05-02 13:00"),
      ]),
      AIRPORT
    );
    expect(outing.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
  });
});

describe("isStopoverCandidate", () => {
  it("offers a tour from five outing photos", () => {
    const five = ["p1", "p2", "p3", "p4", "p5"].map((id) => photo(id, FAR));
    expect(isStopoverCandidate(five)).toBe(true);
  });

  it("offers nothing from four", () => {
    const four = ["p1", "p2", "p3", "p4"].map((id) => photo(id, FAR));
    expect(isStopoverCandidate(four)).toBe(false);
  });
});
