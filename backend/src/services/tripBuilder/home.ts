/**
 * Home, as the trip builder asks about it (spec 2026-10-09 §C.5, §C.9): where
 * the user lived on a day, how that home sits at either end of an area, and
 * whether an area is only the way back home.
 */
import { zoneOfCoordinates } from "../../shared/time/resolveInput";
import { periodAt, type HomePeriod } from "../../utils/homeAirport";
import { distanceKm } from "../photoJourneys/cluster";
import { HOME_RADIUS_KM } from "./thresholds";
import type { CityCluster, Day, HomeAtDay } from "./types";

/**
 * The home on `day`, or null. A period with no residence (a migrated one whose
 * airport the catalogue does not know) has nothing to measure from, so it is no
 * home at all; a guessed point would be worse.
 */
export function homeAt(periods: readonly HomePeriod[], day: Day): HomeAtDay | null {
  const period = periodAt(periods, day);
  const residence = period?.residence;
  if (!period || !residence) return null;
  return {
    name: residence.name,
    lat: residence.lat,
    lon: residence.lon,
    confirmed: period.residenceConfirmed,
    zone: zoneOfCoordinates(residence.lat, residence.lon),
    airports: new Set(period.airports.map((airport) => airport.code.toUpperCase())),
  };
}

/** A cluster whose median lies within `HOME_RADIUS_KM` of the residence is home. */
export function isHomeCluster(
  cluster: Pick<CityCluster, "lat" | "lon">,
  home: HomeAtDay | null
): boolean {
  return home !== null && distanceKm(cluster, home) <= HOME_RADIUS_KM;
}
