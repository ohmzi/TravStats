/**
 * Airport anchors (spec 2026-10-09 §C.9): the airport an area begins or ends
 * at, when its first or last station is too far from it to be "the airport".
 *
 * A trip that lands at an airport 60 km from the first city should show the
 * airport as a pass station, so the leg from it to the city is a leg. The
 * title is the catalogue's display name ("Northvale"), never a bare IATA code,
 * which would count as a city of its own.
 */
import { airportDisplayName } from "../../utils/airportDisplay";
import type { AirportData } from "../airportLookup";
import { distanceKm } from "../photoJourneys/cluster";
import type { Coord } from "../tour/tourDistance";
import { claimKey, stationKeyOf } from "./stations";
import { AIRPORT_ANCHOR_KM } from "./thresholds";
import type { Day, FlightAnchor, GroundArea, PlanStation } from "./types";

export interface AirportAnchorInput {
  area: GroundArea;
  /** The area's stations in travel order, before any home station is placed. */
  stations: readonly PlanStation[];
  anchorsById: ReadonlyMap<string, FlightAnchor>;
  /** Catalogue rows by upper-case IATA code (`getCachedAirports`). */
  airports: ReadonlyMap<string, AirportData>;
  taken: Set<string>;
}

function airportStation(
  input: AirportAnchorInput,
  iata: string | null,
  at: Coord,
  day: Day
): PlanStation | null {
  const airport = iata === null ? undefined : input.airports.get(iata.toUpperCase());
  const title = airportDisplayName(airport) ?? (iata ? `${iata} airport` : null);
  if (title === null) return null;
  return {
    key: claimKey(stationKeyOf(at.lat, at.lon, day), input.taken),
    title,
    titleSource: "airport",
    kind: "airport",
    lat: at.lat,
    lon: at.lon,
    snappedKm: null,
    firstDay: day,
    lastDay: day,
    firstLocal: null,
    lastLocal: null,
    photoCount: 0,
    previewIdx: [],
    notes: null,
  };
}

/**
 * The area's stations with an airport station in front when the inbound flight's
 * arrival airport is more than `AIRPORT_ANCHOR_KM` from the first station, and
 * one behind when the outbound flight's departure airport is that far from the
 * last. An area with no stations gets none: there is nothing to anchor to.
 */
export function addAirportAnchors(input: AirportAnchorInput): PlanStation[] {
  const first = input.stations[0];
  const last = input.stations[input.stations.length - 1];
  if (first === undefined || last === undefined) return [...input.stations];

  const inbound =
    input.area.afterFlightId === null ? undefined : input.anchorsById.get(input.area.afterFlightId);
  const outbound =
    input.area.beforeFlightId === null
      ? undefined
      : input.anchorsById.get(input.area.beforeFlightId);

  const before =
    inbound && distanceKm(first, inbound.arr) > AIRPORT_ANCHOR_KM
      ? airportStation(input, inbound.arrIata, inbound.arr, inbound.arrDay)
      : null;
  const after =
    outbound && distanceKm(last, outbound.dep) > AIRPORT_ANCHOR_KM
      ? airportStation(input, outbound.depIata, outbound.dep, outbound.depDay)
      : null;
  return [...(before ? [before] : []), ...input.stations, ...(after ? [after] : [])];
}
