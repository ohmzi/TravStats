import {
  countRoadtripNights,
  isStation,
  stationCityNames,
  stationState,
  type RoadtripNights,
} from "../../shared/tour/roadtrip";
import { drivenKm, drivenLegs, travelledKm } from "../tour/tourDistance";
import type { CountryResolver } from "../geo/countryFromCoordinates";
import { toCountryCode } from "../../shared/countryEvidence";
import { stayTimes } from "../lodging/timesDto";
import { stationTimes } from "./timesDto";
import { roadtripSketchPath } from "./routeSketch";
import { NOT_A_COVER } from "../trips/photoStation";

/**
 * What a roadtrip page and list say about one roadtrip, derived from rows the
 * engine already holds. Nothing here is stored: a figure the stations and
 * legs can answer is never a column that could disagree with them.
 */

/** The stay fields a station needs to show and count its night. */
export const STATION_STAY_SELECT = {
  id: true,
  lodgingId: true,
  checkIn: true,
  checkOut: true,
  // What the stay's `times` are built from (ADR 0002 phase 4).
  checkInDate: true,
  checkOutDate: true,
  checkInAt: true,
  checkOutAt: true,
  stayZone: true,
  datePrecision: true,
  freeCancellationUntil: true,
  freeCancellationOn: true,
  freeCancellationZone: true,
  paymentDueOn: true,
  nights: true,
  status: true,
  lodging: {
    select: { id: true, name: true, type: true, city: true, country: true, isoCountryCode: true },
  },
} as const;

export const STATION_SELECT = {
  id: true,
  title: true,
  lat: true,
  lon: true,
  startDate: true,
  endDate: true,
  startUtc: true,
  endUtc: true,
  stopZone: true,
  notes: true,
  routeOrderIdx: true,
  overnight: true,
  viaPoint: true,
  lodgingStayId: true,
  lodgingStay: { select: STATION_STAY_SELECT },
  placeId: true,
  place: { select: { id: true, name: true, localName: true, category: true } },
} as const;

/**
 * STATION_SELECT plus a stay's own notes: the words the AI summary's brief
 * retells and `briefHasVoice` counts (spec 2026-10-12 §6). The narrow
 * STATION_SELECT remains what every page and list reads; only the summary
 * pays for the extra column.
 */
export const STATION_LLM_SELECT = {
  ...STATION_SELECT,
  lodgingStay: { select: { ...STATION_STAY_SELECT, notes: true } },
} as const;

/**
 * STATION_SELECT plus what only the station DTO needs: how many trip photos
 * are filed at each station (forgejo#139), so the station chain can show them
 * without a call per station. A separate select so the readers that only
 * count nights or countries do not pay for the count; `toStationDto` takes
 * `StationDtoRow`, so a DTO built from the narrower select fails `tsc` rather
 * than shipping a missing count.
 *
 * The cover's pseudo-photo row is left out, as every gallery read does.
 */
export const STATION_DTO_SELECT = {
  ...STATION_SELECT,
  _count: { select: { photos: { where: NOT_A_COVER } } },
} as const;

/**
 * The relation filter for readers that want STATIONS only — every count, the
 * phone's list, the statistics. A route correction (`viaPoint`) is a bend in
 * the line, not a place; the editor and the leg writer are the only readers
 * that must see it.
 */
export const STATIONS_ONLY = { viaPoint: false } as const;

export interface StationRow {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  startDate: Date | null;
  endDate: Date | null;
  startUtc: Date | null;
  endUtc: Date | null;
  stopZone: string | null;
  notes: string | null;
  routeOrderIdx: number | null;
  overnight: boolean;
  viaPoint: boolean;
  placeId: string | null;
  place: { id: string; name: string; category: string } | null;
  lodgingStayId: string | null;
  lodgingStay: {
    id: string;
    lodgingId: string;
    checkIn: Date | null;
    checkOut: Date | null;
    checkInDate: Date | null;
    checkOutDate: Date | null;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    stayZone: string | null;
    datePrecision: string;
    freeCancellationUntil: Date | null;
    freeCancellationOn: Date | null;
    freeCancellationZone: string | null;
    paymentDueOn: Date | null;
    nights: number | null;
    status: string;
    lodging: {
      id: string;
      name: string;
      type: string;
      city: string | null;
      country: string | null;
      isoCountryCode: string | null;
    };
  } | null;
}

export interface StationDtoRow extends StationRow {
  _count: { photos: number };
}

export function nightsOf(stations: readonly StationRow[]): RoadtripNights {
  return countRoadtripNights(
    stations.map((s) => ({
      lodgingStayId: s.lodgingStayId,
      overnight: s.overnight,
      viaPoint: s.viaPoint,
      startDate: s.startDate,
      endDate: s.endDate,
      stay: s.lodgingStay
        ? {
            checkIn: s.lodgingStay.checkIn,
            checkOut: s.lodgingStay.checkOut,
            datePrecision: s.lodgingStay.datePrecision,
            nights: s.lodgingStay.nights,
            status: s.lodgingStay.status,
            lodgingType: s.lodgingStay.lodging.type,
          }
        : null,
    }))
  );
}

/**
 * The trip's own stored days (owner 2026-10-13), the journey's
 * `startDay`/`endDay` convention one level down. Either side may be null,
 * and null means "derive this side from the stations".
 */
export interface StoredTripDays {
  startDay: Date | null;
  endDay: Date | null;
}

/**
 * The span a roadtrip covers: earliest station start (or linked check-in)
 * to latest station end (or check-out), with the trip's OWN stored days
 * winning PER SIDE where it has them (owner 2026-10-13) — a stored start
 * with no stored end still ends at the latest station, and the other way
 * round. With neither day stored the derivation is exactly what every
 * existing trip already showed. Null ends abstain.
 *
 * This is the ONE answer: the list/detail DTOs, the chain, the figures band,
 * the scoped re-sync's window, the AI summary's brief and the timeline all
 * read spans through here, so a trip's two levels cannot disagree.
 */
export function spanOf(
  stations: readonly StationRow[],
  days?: StoredTripDays | null
): {
  startDate: string | null;
  endDate: string | null;
} {
  let start: Date | null = null;
  let end: Date | null = null;
  for (const s of stations.filter(isStation)) {
    const from = s.startDate ?? s.lodgingStay?.checkIn ?? null;
    const to = s.endDate ?? s.lodgingStay?.checkOut ?? from;
    if (from && (!start || from < start)) start = from;
    if (to && (!end || to > end)) end = to;
  }
  const storedStart = days?.startDay ?? null;
  const storedEnd = days?.endDay ?? null;
  return {
    startDate: (storedStart ?? start)?.toISOString() ?? null,
    endDate: (storedEnd ?? end)?.toISOString() ?? null,
  };
}

export function toStationDto(s: StationDtoRow): Record<string, unknown> {
  const stay = s.lodgingStay;
  return {
    id: s.id,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    startDate: s.startDate,
    endDate: s.endDate,
    times: stationTimes(s),
    notes: s.notes,
    order: s.routeOrderIdx,
    state: stationState(s),
    lodgingStayId: s.lodgingStayId,
    // The place a pass-through passed (tester 2026-09-26); null elsewhere.
    placeId: s.placeId,
    place: s.place,
    // Trip photos filed at this station; GET /trips/:tripId/photos?stopId=
    // lists them. Always 0 on a roadtrip filed on no trip — a trip photo
    // needs a trip to belong to.
    photoCount: s._count.photos,
    stay: stay
      ? {
          id: stay.id,
          lodgingId: stay.lodgingId,
          lodgingName: stay.lodging.name,
          lodgingType: stay.lodging.type,
          city: stay.lodging.city,
          country: stay.lodging.country,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          times: stayTimes(stay),
          nights: stay.nights,
          status: stay.status,
        }
      : null,
  };
}

export interface RoadtripListRow extends StoredTripDays {
  id: string;
  tripId: string | null;
  name: string;
  mode: string;
  color: string | null;
  vehicle: string | null;
  vehicleName: string | null;
  kindAssignedAutomatically: boolean;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  trip: { name: string } | null;
  /** `fromStopId`/`toStopId`/`waypoints` are read only by the route sketch. */
  legs: Array<{
    mode: string;
    distanceKm: number;
    fromStopId: string;
    toStopId: string;
    waypoints: unknown;
  }>;
  stops: StationRow[];
  _count: { tracks: number };
}

/**
 * The country ONE station stands in (ISO alpha-2), by the one rule every
 * station country is resolved with: its own coordinates when it has them, else
 * its linked stay's ISO code. The land-only boundary set answers null on the
 * shore — measured at Hirtshals and Stavanger, which is where campsites and
 * ferry ports are — so the linked stay speaks there; with neither, it abstains.
 *
 * Split out of `stationCountries` (2026-10-14) so a reader that needs ONE
 * station's country — the journey band's per-station days — asks the same
 * rule rather than keeping a second copy. There is one way to resolve a
 * station's country in this codebase, and this is it.
 */
export function stationCountry(
  station: {
    lat: number | null;
    lon: number | null;
    lodgingStay: { lodging: { isoCountryCode: string | null } } | null;
  },
  resolver: Pick<CountryResolver, "countryAt">
): string | null {
  const fromPoint =
    station.lat !== null && station.lon !== null
      ? resolver.countryAt(station.lat, station.lon)
      : null;
  return fromPoint ?? toCountryCode(station.lodgingStay?.lodging.isoCountryCode ?? null);
}

/**
 * The countries a roadtrip's stations stand in (ISO alpha-2), each resolved by
 * `stationCountry` and deduped, sorted. The cross-domain overview asks the
 * same question of the same rule.
 */
export function stationCountries(
  stations: ReadonlyArray<{
    lat: number | null;
    lon: number | null;
    viaPoint?: boolean;
    lodgingStay: { lodging: { isoCountryCode: string | null } } | null;
  }>,
  resolver: Pick<CountryResolver, "countryAt">
): string[] {
  const touched = new Set<string>();
  // A route correction's country is one driven through at most, never one
  // the traveller stopped in (tester 2026-09-26).
  for (const s of stations.filter(isStation)) {
    const code = stationCountry(s, resolver);
    if (code) touched.add(code);
  }
  return [...touched].sort();
}

export function toRoadtripSummary(
  row: RoadtripListRow,
  tourCount: number,
  countries: string[]
): Record<string, unknown> {
  const nights = nightsOf(row.stops);
  const stations = row.stops.filter(isStation);
  return {
    id: row.id,
    kind: "roadtrip",
    tripId: row.tripId,
    tripName: row.trip?.name ?? null,
    name: row.name,
    mode: row.mode,
    color: row.color,
    vehicle: row.vehicle,
    vehicleName: row.vehicleName,
    kindAssignedAutomatically: row.kindAssignedAutomatically,
    // The ONE span rule: the trip's own days where it has them, the stations
    // on the sides where it does not (owner 2026-10-13).
    ...spanOf(row.stops, row),
    distanceKm: travelledKm(row.legs),
    drivenKm: drivenKm(row.legs),
    startOdometerKm: row.startOdometerKm,
    endOdometerKm: row.endOdometerKm,
    stationCount: stations.length,
    // The DISTINCT station titles this row carries — its cities (owner,
    // 2026-10-08). Names rather than a count because the list strip UNIONS them
    // across the shown rows ("how many cities i touched in all the road trips"),
    // and a per-row total could not be deduplicated. Computed from ALL stations,
    // not the placed-only `stations` array below, so an unplaced station still
    // names its city and the strip cannot undercount the card (`stationCityNames`).
    cityNames: stationCityNames(row.stops),
    // The drives the list summary counts (owner, 2026-10-08): the same road
    // legs `drivenKm` sums, never a ferry, rail, foot or bike leg — a "drive"
    // is a road stretch. `drivenLegs` is that ONE allow-list rule, shared with
    // `drivenKm`, so the two figures cannot disagree.
    //
    // Legs are keyed by ENDPOINT PAIR (`shared/tour/legPlan.ts`), never by
    // position, so a repeated ordered pair — an out-and-back — is ONE drive,
    // not two. This is therefore the count of DISTINCT consecutive pairs, which
    // the no-duplicate-station-id rule in `replaceStations` keeps at `stops - 1`
    // for a straight route; a via point is an endpoint too and adds one pair.
    driveCount: drivenLegs(row.legs).length,
    // `[lon, lat]` in travel order, for the list's route sketch; a station
    // without a point has nothing to draw and is left out, and so is a route
    // correction — the sketch marks stations.
    points: stations.flatMap((s) => (s.lat !== null && s.lon !== null ? [[s.lon, s.lat]] : [])),
    // The line the card actually draws: the routed way between the stations,
    // simplified. `points` above stays the stations themselves — the sketch
    // marks those on top of this line, and other readers may still want them.
    path: roadtripSketchPath(stations, row.legs),
    // The stations themselves, for the dashboard map's markers (tester
    // 2026-09-26): placed ones only, never a route correction.
    stations: stations.flatMap((s) =>
      s.lat !== null && s.lon !== null
        ? [{ id: s.id, title: s.title, lat: s.lat, lon: s.lon, state: stationState(s) }]
        : []
    ),
    nights: nights.nights,
    stayNights: nights.stayNights,
    freeNights: nights.freeNights,
    nightsKnown: nights.nightsKnown,
    placesSlept: nights.placesSlept,
    trackCount: row._count.tracks,
    tourCount,
    countries,
  };
}
