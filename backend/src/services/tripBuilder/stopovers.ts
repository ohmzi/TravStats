/**
 * Stopover roadtrips (spec
 * docs/superpowers/specs/2026-10-11-stopover-roadtrips-design.md, §2): the tour
 * a layover's outing set implies.
 *
 * A layover whose photos went somewhere — STOPOVER_MIN_PHOTOS of them further
 * than STOPOVER_MIN_KM from the airport — is a stopover candidate. The tour
 * always begins with the arrival airport as its first stop, then the outing
 * set's clusters in time order, so a single downtown cluster still yields two
 * stations, which the roadtrip model wants. Its legs come from the same leg
 * machinery the areas use; it never enters the night plan.
 *
 * Pure: the photos, flight, airport row and named clusters come in as values.
 * The scan-side wiring (`areaPlans.ts`, `stopoversPhase`) does the clustering,
 * naming and probing around it.
 */
import { dayMonthLabel } from "../../shared/tour/builderNightPlan";
import { defaultStationNotes } from "../../shared/tour/builderStations";
import { airportCityName, airportDisplayName } from "../../utils/airportDisplay";
import type { AirportData } from "../airportLookup";
import { distanceKm } from "../photoJourneys/cluster";
import type { RouteProbe } from "../tour/routing/types";
import type { Coord } from "../tour/tourDistance";
import { buildLegs } from "./ferry";
import { claimKey, passStation, pickPreviewIds, stationKeyOf } from "./stations";
import { STOPOVER_MIN_KM, STOPOVER_MIN_PHOTOS } from "./thresholds";
import type {
  CountryAt,
  Day,
  FlightAnchor,
  Layover,
  NamedCluster,
  PhotoPoint,
  PlanStation,
  StationSpan,
  StoredStopover,
} from "./types";

/** By instant; the id breaks a tie, so the order never depends on Immich's paging. */
function inTimeOrder(photos: readonly PhotoPoint[]): PhotoPoint[] {
  return [...photos].sort((a, b) => a.tMs - b.tMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The outing set (spec §2): the layover's geotagged photos further than
 * STOPOVER_MIN_KM from the airport, in time order.
 */
export function outingOf(
  layover: Layover,
  photosById: ReadonlyMap<string, PhotoPoint>,
  at: Coord
): PhotoPoint[] {
  const members = layover.photoIds.flatMap((id) => {
    const photo = photosById.get(id);
    return photo ? [photo] : [];
  });
  return inTimeOrder(members).filter(
    (photo) =>
      photo.flags.located &&
      photo.lat !== null &&
      photo.lon !== null &&
      distanceKm({ lat: photo.lat, lon: photo.lon }, at) > STOPOVER_MIN_KM
  );
}

/** STOPOVER_MIN_PHOTOS outing photos or more: the layover is offered (spec §2). */
export function isStopoverCandidate(outing: readonly PhotoPoint[]): boolean {
  return outing.length >= STOPOVER_MIN_PHOTOS;
}

/**
 * `<City> <Year> Road Trip`: the one name of the roadtrip and its album (owner
 * ruling). A base `takenTitles` already holds — the titles the scan minted for
 * earlier candidates — gets the day suffix C.11's roadtrip names use
 * (`roadtripAreaNames`: ` (d MMM)` of this stopover's own day), so two
 * stopovers in one city and year stay distinct; a suffix that is itself taken
 * gets the same numeric ending (plan 2026-10-11, controller amendment 1).
 */
export function stopoverTitle(city: string, day: Day, takenTitles: ReadonlySet<string>): string {
  const base = `${city} ${day.slice(0, 4)} Road Trip`;
  const wanted = takenTitles.has(base) ? `${base} (${dayMonthLabel(day)})` : base;
  let title = wanted;
  for (let n = 2; takenTitles.has(title); n++) title = `${wanted} ${n}`;
  return title;
}

/**
 * The city the stopover is named after (spec §2.2): the naming chain's own
 * answer for the biggest cluster of the outing set, and the airport's city when
 * the chain ran out and named the place by its coordinates.
 */
export function stopoverCity(named: readonly NamedCluster[], airport: AirportData | null): string {
  let main: NamedCluster | undefined;
  for (const cluster of named) {
    if (main === undefined || cluster.photoIds.length > main.photoIds.length) main = cluster;
  }
  const title = main?.title.trim() ?? "";
  if (main !== undefined && main.titleSource !== "coords" && title !== "") return title;
  return airportCityName(airport) ?? airportDisplayName(airport) ?? title;
}

export interface StopoverStationsInput {
  layover: Layover;
  /** The flight that landed before the stopover: its arrival point is the airport's. */
  inFlight: FlightAnchor;
  /** The arrival airport's catalogue row; null when the code has none. */
  airport: AirportData | null;
  /** The outing set's clusters, named by the scan's naming chain (`nameClusters`). */
  named: readonly NamedCluster[];
  photosById: ReadonlyMap<string, PhotoPoint>;
  /** The scan-wide station-key set, shared with the areas (`areaPlans.ts`). */
  taken: Set<string>;
}

export interface StopoverStations {
  /** The tour's stops, the arrival airport first (spec §2.2). */
  stations: PlanStation[];
  /** Station key → its first and last photo instant; the airport stop has none. */
  spanMs: Map<string, StationSpan>;
  /** Station key → up to PREVIEWS_PER_STATION asset ids. SERVER-ONLY. */
  previewPhotoIds: Map<string, string[]>;
  /** The chain's city for the outing set, for the name. */
  city: string;
  /** The stopover's day: the first outing photo's day, on its own clock. */
  day: Day;
}

/**
 * The tour's stations: the arrival airport as the first stop, then one stop per
 * outing cluster in time order. Null only when the airport cannot be named at
 * all (a scanned layover always carries an IATA code) or nothing clustered.
 */
export function stopoverStations(input: StopoverStationsInput): StopoverStations | null {
  const iata = input.layover.airportIata;
  const airportTitle =
    airportDisplayName(input.airport) ?? (iata !== null ? `${iata} airport` : null);
  if (airportTitle === null) return null;

  const clusterPhotos = input.named.map((cluster) =>
    inTimeOrder(
      cluster.photoIds.flatMap((id) => {
        const photo = input.photosById.get(id);
        return photo ? [photo] : [];
      })
    )
  );
  const all = inTimeOrder(clusterPhotos.flat());
  const first = all[0];
  if (first === undefined) return null;

  const stations: PlanStation[] = [
    passStation({
      kind: "airport",
      title: airportTitle,
      titleSource: "airport",
      at: input.inFlight.arr,
      day: input.inFlight.arrDay,
      taken: input.taken,
    }),
  ];
  const spanMs = new Map<string, StationSpan>();
  const previewPhotoIds = new Map<string, string[]>();

  input.named.forEach((cluster, index) => {
    const photos = clusterPhotos[index];
    const lead = photos[0];
    if (lead === undefined) return;
    const last = photos[photos.length - 1];
    const key = claimKey(stationKeyOf(cluster.lat, cluster.lon, lead.day), input.taken);
    stations.push({
      key,
      title: cluster.title,
      titleSource: cluster.titleSource,
      kind: "visit",
      lat: cluster.lat,
      lon: cluster.lon,
      snappedKm: null,
      firstDay: lead.day,
      lastDay: last.day,
      firstLocal: lead.local,
      lastLocal: last.local,
      photoCount: photos.length,
      previewIdx: [],
      notes: defaultStationNotes({
        firstLocal: lead.local,
        lastLocal: last.local,
        photoCount: photos.length,
      }),
    });
    spanMs.set(key, { firstMs: lead.tMs, lastMs: last.tMs });
    previewPhotoIds.set(key, pickPreviewIds(photos));
  });

  return {
    stations,
    spanMs,
    previewPhotoIds,
    city: stopoverCity(input.named, input.airport),
    day: first.day,
  };
}

export interface StopoverAssemblyInput {
  layover: Layover;
  tour: StopoverStations;
  /** The router's answers for airport→stop1, stop1→stop2 …; null without probes. */
  probes: ReadonlyArray<RouteProbe | null>;
  countryAt: CountryAt;
  /** The titles the scan has minted so far: a later same-city candidate gets the day suffix. */
  takenTitles: ReadonlySet<string>;
}

/**
 * The stopover the draft stores (spec §2.3): the whole layover's photo set (the
 * album list), the tour's stations, and the legs between them. No nights: a
 * stopover is hours, not a stay.
 */
export function stopoverOf(input: StopoverAssemblyInput): StoredStopover {
  return {
    key: `${input.layover.inFlightId}#${input.layover.outFlightId}`,
    title: stopoverTitle(input.tour.city, input.tour.day, input.takenTitles),
    city: input.tour.city,
    day: input.tour.day,
    inFlightId: input.layover.inFlightId,
    outFlightId: input.layover.outFlightId,
    airportIata: input.layover.airportIata,
    photoIds: [...input.layover.photoIds],
    stations: input.tour.stations,
    legs: buildLegs({
      stations: input.tour.stations,
      spanMs: input.tour.spanMs,
      probes: input.probes,
      seaPhotos: [],
      countryAt: input.countryAt,
    }),
  };
}
