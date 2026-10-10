/**
 * Areas (spec 2026-10-09 §C.11): what becomes of each stretch of ground travel.
 *
 * Which areas are one timeline stop and which a roadtrip, which city names a
 * roadtrip, the countries a trip names and the two ends of its journey band.
 * The roadtrip names themselves come from `roadtripAreaNames`
 * (shared/tour/builderNightPlan.ts), fed with `mainCityOf` and each area's start day.
 */
import { daysBetween } from "../../shared/time/localDate";
import type {
  AreaKind,
  AreaPlan,
  CountryAt,
  Day,
  DraftArea,
  FlightAnchor,
  GroundArea,
  NightEntry,
  PlanStation,
} from "./types";

/** `<startDay>#<n>`: how an area is named across a re-scan and in the commit body. */
export function areaKeyOf(startDay: Day, ordinal: number): string {
  return `${startDay}#${ordinal}`;
}

/** The parts with their keys; `n` counts from 1 among the areas that start on the same day. */
export function keyAreas<T extends { area: GroundArea }>(
  parts: readonly T[]
): Array<T & { key: string }> {
  const seen = new Map<Day, number>();
  return parts.map((part) => {
    const ordinal = (seen.get(part.area.startDay) ?? 0) + 1;
    seen.set(part.area.startDay, ordinal);
    return { ...part, key: areaKeyOf(part.area.startDay, ordinal) };
  });
}

/** A station that stands for a city of the trip: not the way home, not an airport. */
const isCity = (station: PlanStation): boolean =>
  station.kind !== "home" && station.kind !== "airport";

const cityIdOf = (station: PlanStation): string => station.title.trim().toLowerCase();

/**
 * One distinct city, with no home leg switched on, is a single timeline stop
 * over the area's first to last day; anything more is a roadtrip, if roadtrips
 * are visible to the user. Home and airport stations are not cities, and an
 * area with no city at all (only the way home) is a stop too — it has nothing
 * to drive between.
 */
export function decideAreaKind(
  plan: Pick<AreaPlan, "stations" | "home">,
  roadtripsVisible: boolean
): AreaKind {
  const cities = new Set(plan.stations.filter(isCity).map(cityIdOf));
  const homeLegs = plan.home.start.defaultOn || plan.home.end.defaultOn;
  if (cities.size === 0 || (cities.size === 1 && !homeLegs)) return "stops";
  return roadtripsVisible ? "roadtrip" : "stops";
}

interface CityTally {
  title: string;
  nights: number;
  photos: number;
}

/**
 * The city a roadtrip is named after: the one with the most nights, then the
 * most photos, then the first. Stations of one title count as one city; home
 * and airport stations never do. Null when the area has no city.
 */
export function mainCityOf(
  stations: readonly PlanStation[],
  nights: Readonly<Record<Day, NightEntry>>
): string | null {
  const nightsAt = new Map<string, number>();
  for (const { assign } of Object.values(nights)) {
    nightsAt.set(assign, (nightsAt.get(assign) ?? 0) + 1);
  }

  const cities = new Map<string, CityTally>();
  for (const station of stations.filter(isCity)) {
    const id = cityIdOf(station);
    const city = cities.get(id) ?? { title: station.title.trim(), nights: 0, photos: 0 };
    city.nights += nightsAt.get(station.key) ?? 0;
    city.photos += station.photoCount;
    cities.set(id, city);
  }

  let main: CityTally | null = null;
  for (const city of cities.values()) {
    const wins =
      main === null ||
      city.nights > main.nights ||
      (city.nights === main.nights && city.photos > main.photos);
    if (wins) main = city;
  }
  return main === null ? null : main.title;
}

export interface DraftCountriesInput {
  stations: readonly PlanStation[];
  /** The flights ticked in review: their arrival countries are part of the trip. */
  tickedFlights: readonly FlightAnchor[];
  countryAt: CountryAt;
  /** The countries an existing trip already names; they come first. */
  existing: readonly string[];
}

/**
 * The countries a trip names: the existing ones, then where its stations stand
 * (home and airport stations left out) and where its ticked flights land. Upper-
 * case two-letter codes, each once; a place the resolver cannot name adds none.
 */
export function draftCountries(input: DraftCountriesInput): string[] {
  const codes: string[] = [];
  const add = (code: string | null): void => {
    const upper = code?.toUpperCase() ?? "";
    if (/^[A-Z]{2}$/.test(upper) && !codes.includes(upper)) codes.push(upper);
  };
  input.existing.forEach(add);
  for (const station of input.stations.filter(isCity)) {
    add(input.countryAt(station.lat, station.lon));
  }
  for (const flight of input.tickedFlights) add(input.countryAt(flight.arr.lat, flight.arr.lon));
  return codes;
}

const daySpanOf = (area: DraftArea): number => daysBetween(area.startDay, area.endDay);

/**
 * The trip's origin and destination labels: the home city (else the first
 * city of the trip) to the main city of the longest area. Without a home, an
 * origin that is the destination too is left out rather than say "A → A".
 */
export function draftLabels(
  areas: readonly DraftArea[],
  homeTitle: string | null
): { originLabel: string | null; destinationLabel: string | null } {
  let longest: DraftArea | undefined;
  for (const area of areas) {
    if (longest === undefined || daySpanOf(area) > daySpanOf(longest)) longest = area;
  }
  const destinationLabel = longest?.mainCity ?? null;

  const home = homeTitle?.trim() || null;
  if (home !== null) return { originLabel: home, destinationLabel };
  const firstCity = areas.flatMap((area) => area.stations).find(isCity)?.title ?? null;
  return { originLabel: firstCity === destinationLabel ? null : firstCity, destinationLabel };
}

/**
 * An area as the draft shows it. `plan.legs` must be the legs of `plan.stations`
 * (the final list, home and airport stations included), one fewer than stations.
 */
export function toDraftArea(
  plan: AreaPlan,
  defaultAs: AreaKind,
  suggestedName: string,
  mainCity: string | null
): DraftArea {
  if (plan.legs.length !== Math.max(0, plan.stations.length - 1)) {
    throw new Error(
      `Area ${plan.key} has ${plan.legs.length} legs for ${plan.stations.length} stations`
    );
  }
  return {
    key: plan.key,
    defaultAs,
    suggestedName,
    mainCity,
    startDay: plan.area.startDay,
    endDay: plan.area.endDay,
    ...(plan.area.afterFlightId === null ? {} : { afterFlightId: plan.area.afterFlightId }),
    ...(plan.area.beforeFlightId === null ? {} : { beforeFlightId: plan.area.beforeFlightId }),
    home: plan.home,
    stations: plan.stations,
    legs: plan.legs,
  };
}
