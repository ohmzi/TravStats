/**
 * Synthetic fixtures for the flight rules. Invented airports in a made-up archipelago: Northvale
 * (NVL), Port Carrow (PCR) and Kelmore (KEL). Times are the wall clock of one zone, so a test
 * reads like a day's diary.
 *
 * The photo and the flight are built on `makePhoto` and `makeAnchor` from `photoFixtures`, so the
 * test tree has one builder per type and a change to `PhotoPoint` is made once. Only what the
 * flight rules vary (the place, the clock, the airports) is set here.
 */
import type { Coord } from "../../tour/tourDistance";
import type { FlightAnchor, PhotoPoint } from "../types";
import { makeAnchor, makePhoto, msAt, NZST_H } from "./photoFixtures";

/** The zone of every fixture here: UTC+12 (NZST) from April to September, so keep dates in that stretch. */
export const ZONE = "Pacific/Auckland";

export interface Airport extends Coord {
  iata: string;
}

/** Northvale airport; Port Carrow is 347 km north-east of it, Kelmore 640 km. */
export const NVL: Airport = { iata: "NVL", lat: -45.021, lon: 168.739 };
export const PCR: Airport = { iata: "PCR", lat: -43.489, lon: 172.532 };
export const KEL: Airport = { iata: "KEL", lat: -41.327, lon: 174.805 };

const KM_PER_DEGREE = 111.195;
const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const deg = (radians: number): number => (radians * 180) / Math.PI;

/** The instant (epoch ms) of the wall clock `local` ("YYYY-MM-DD HH:MM") in ZONE, for a date in NZST. */
export function at(local: string): number {
  return msAt(local, NZST_H);
}

/** The point `northKm` north and `eastKm` east of `base` (flat earth: good for a few dozen km). */
export function offsetKm(base: Coord, northKm: number, eastKm: number): Coord {
  return {
    lat: base.lat + northKm / KM_PER_DEGREE,
    lon: base.lon + eastKm / (KM_PER_DEGREE * Math.cos(rad(base.lat))),
  };
}

/** The point `fraction` of the way along the great circle from `from` to `to` (outside 0…1 extends it). */
export function between(from: Coord, to: Coord, fraction: number): Coord {
  const lat1 = rad(from.lat);
  const lon1 = rad(from.lon);
  const lat2 = rad(to.lat);
  const lon2 = rad(to.lon);
  const angle = Math.acos(
    Math.min(
      1,
      Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
    )
  );
  const a = Math.sin((1 - fraction) * angle) / Math.sin(angle);
  const b = Math.sin(fraction * angle) / Math.sin(angle);
  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
}

/** A photo taken at the wall clock `local` ("YYYY-MM-DD HH:MM", ZONE); `where` null is a photo without GPS. */
export function photo(
  id: string,
  local: string,
  where: Coord | null,
  over: Partial<PhotoPoint> = {}
): PhotoPoint {
  const { flags, ...rest } = over;
  return makePhoto({
    id,
    local,
    zone: ZONE,
    lat: where ? where.lat : null,
    lon: where ? where.lon : null,
    originalFileName: `${id}.jpg`,
    ...rest,
    flags: { located: where !== null, ...flags },
  });
}

/** A flight with real instants at both ends, `depLocal` / `arrLocal` as "YYYY-MM-DD HH:MM" in ZONE. */
export function preciseFlight(
  id: string,
  depLocal: string,
  arrLocal: string,
  from: Airport,
  to: Airport,
  over: Partial<FlightAnchor> = {}
): FlightAnchor {
  return makeAnchor({
    id,
    label: `${id} ${from.iata}→${to.iata}`,
    depIata: from.iata,
    arrIata: to.iata,
    dep: { lat: from.lat, lon: from.lon },
    arr: { lat: to.lat, lon: to.lon },
    depZone: ZONE,
    arrZone: ZONE,
    depDay: depLocal.slice(0, 10),
    arrDay: arrLocal.slice(0, 10),
    depClock: depLocal.slice(11, 16),
    arrClock: arrLocal.slice(11, 16),
    precise: true,
    depMs: at(depLocal),
    arrMs: at(arrLocal),
    ...over,
  });
}

/** The point `crossKm` to the left of the track `from` → `to`, `fraction` of the way along it. */
export function beside(from: Coord, to: Coord, fraction: number, crossKm: number): Coord {
  const north = (to.lat - from.lat) * KM_PER_DEGREE;
  const east = (to.lon - from.lon) * KM_PER_DEGREE * Math.cos(rad((from.lat + to.lat) / 2));
  const length = Math.hypot(north, east);
  return offsetKm(
    between(from, to, fraction),
    (crossKm * east) / length,
    (-crossKm * north) / length
  );
}

/** A flight known only by its days (a date-only or legacy row): no clock, no instants. */
export function datedFlight(
  id: string,
  depDay: string,
  arrDay: string,
  from: Airport,
  to: Airport,
  over: Partial<FlightAnchor> = {}
): FlightAnchor {
  return {
    ...preciseFlight(id, `${depDay} 12:00`, `${arrDay} 12:00`, from, to),
    depClock: null,
    arrClock: null,
    precise: false,
    depMs: null,
    arrMs: null,
    ...over,
  };
}

/** A located photo that fell in the sea (`flags.atSea`): kept out of the movement photos. */
export function seaPhoto(id: string, local: string, where: Coord): PhotoPoint {
  const shot = photo(id, local, where);
  return { ...shot, flags: { ...shot.flags, atSea: true } };
}
