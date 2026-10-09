import { calculateDistance } from "../geo";
import { hasUnknownLength, stayNights, type DisplayableStay } from "../lodgingDateDisplay";

/**
 * The numbers a journey's band is made of, folded from the journey's own
 * flights and stays — nothing here is stored or sent.
 *
 * Lives beside `flightSummaryFigures.ts` rather than in the page so the rules
 * are testable without rendering a band, and takes narrow rows rather than the
 * full DTO so a test can hand it three fields. Every function is pure and
 * uses the plain `String`/number default, so the tests need no `Intl` and no
 * React.
 *
 * THE DISTANCE IS A SUM OF DERIVED NUMBERS, AND SAYS SO. A flight's
 * `routeDistance` is a haversine chord stamped when the row was written
 * (`backend/src/routes/flights.ts`, `flightsBatch.ts`), not a flown path;
 * `FlightJourneyCard.tsx` already sums the same figure. Only a leg whose
 * `routeSource` is `"live_tracking"` is measured, so the fold reports how many
 * legs were measured and how many were derived, and the band marks the derived
 * sum with `~` (the rule stated in `ListSummaryStrip.tsx`: flight time and
 * distance are both derived "and the app is careful to mark them as estimates
 * wherever they appear"). A derived distance is never allowed to read as a
 * measured one.
 *
 * A LEG WITH NO DISTANCE AT ALL IS NOT A ZERO. When a flight carries neither a
 * stamped `routeDistance` nor two real endpoints — a null/NaN coordinate, or the
 * (0,0) "no coordinate" sentinel the write path stores — it contributes NOTHING
 * and is counted as `unknownLegs`; the band reads that as "at least this much"
 * rather than lowering the total by pretending the leg was zero
 * (`roadtripView.ts`, "a planned roadtrip counts for nothing in any statistic"
 * — the same instinct).
 *
 * CITIES IS NOT AIRPORTS, AND BOTH ARE REAL. The owner settled the two as
 * deliberately different figures (owner, 2026-10-08): a journey can land twice
 * in one city, and then it is two airports and one city. Cities come from the
 * airport catalogue's own `city` (through the backend lookup, so no per-code
 * request from the browser); a journey where no airport resolves a city yields
 * a dash with its reason, and a PARTIAL resolution is a lower bound the caller
 * is told about through `airportsWithoutCity`.
 */

/**
 * The fields of a flight this fold reads. Minimal on purpose, like
 * `SummarisableFlight`: a `Pick<Flight, …>` from `/trips/:id` satisfies it
 * without the fold knowing the rest of the row.
 */
export interface JourneyFlight {
  routeDistance?: number | null;
  routeSource?: string | null;
  depIata?: string | null;
  arrIata?: string | null;
  depCity?: string | null;
  arrCity?: string | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

/**
 * Whether an endpoint is a real position and not the app's "no coordinate"
 * sentinel.
 *
 * A prisma `Float` is non-nullable (`schema.prisma`), so a flight whose airport
 * the catalogue never resolved does not store a null endpoint — it stores
 * (0,0). That is Null Island's twin in name only: `TripMap` draws no arc for a
 * leg with either end there (`TripMap.tsx`: `depLat === 0 && depLon === 0 ||
 * arrLat === 0 && arrLon === 0`). Counting the leg anyway is how a phantom
 * great-circle chord reaches a headline, which is the "unknown is a dash, never
 * a zero" mistake this module exists to prevent.
 */
function isRealEndpoint(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
}

/** A lodging stay, as the night fold needs it. `status` is optional so a test need not carry it. */
export interface JourneyStay extends DisplayableStay {
  status?: string | null;
}

/** The journey's distance and how much of it was measured rather than derived. */
export interface JourneyDistance {
  km: number;
  /** True when at least one leg's distance is derived — the band's `~`. */
  estimated: boolean;
  /** Legs backed by a recorded track (`routeSource === "live_tracking"`). */
  liveLegs: number;
  /** Legs counted from a stamped chord or their coordinates. */
  derivedLegs: number;
  /** Legs that yielded no distance — the sum is a lower bound, never lowered by them. */
  unknownLegs: number;
}

function hasCoordinates(flight: JourneyFlight): boolean {
  return (
    isRealEndpoint(flight.depLat, flight.depLon) && isRealEndpoint(flight.arrLat, flight.arrLon)
  );
}

/**
 * Fold the journey's legs into one distance.
 *
 * A stamped `routeDistance` wins over the coordinates: it is what was written
 * with the flight and does not move if the airport catalogue is later edited.
 * The coordinate fallback is the corner `FlightJourneyCard.tsx` already takes
 * — same maths, the same `lib/geo.ts` rule — so the card and the page agree on
 * a leg the row did not stamp.
 *
 * A leg whose two ends are not both real positions contributes NOTHING: its
 * `routeDistance`, if any, was stamped by the write path from those same
 * endpoints (`routes/flights.ts`), so it is the phantom chord `TripMap` refuses
 * to draw, not a distance. `routeDistance <= 0` is likewise absent, not a zero
 * — the convention `services/stats/records.ts` already reads flight distance
 * with. Both cases leave the leg in `unknownLegs`.
 */
export function journeyDistanceKm(flights: readonly JourneyFlight[]): JourneyDistance {
  let km = 0;
  let liveLegs = 0;
  let derivedLegs = 0;
  let unknownLegs = 0;

  for (const flight of flights) {
    const leg = hasCoordinates(flight)
      ? typeof flight.routeDistance === "number" && flight.routeDistance > 0
        ? flight.routeDistance
        : calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon)
      : null;

    if (leg === null) {
      unknownLegs += 1;
      continue;
    }
    km += leg;
    if (flight.routeSource === "live_tracking") liveLegs += 1;
    else derivedLegs += 1;
  }

  return { km, estimated: derivedLegs > 0, liveLegs, derivedLegs, unknownLegs };
}

/**
 * The prefix a journey's distance carries, so the card and the page band agree
 * on what `~` and `≈` mean (owner, 2026-10-08).
 *
 * `≈` marks the sum a LOWER BOUND — a leg gave no distance and contributes
 * nothing — and `~` marks it DERIVED, a sum of great-circle chords rather than
 * a flown path (the rule `ListSummaryStrip.tsx` states: the app "is careful to
 * mark them as estimates wherever they appear"). The two can hold at once, and
 * then BOTH are shown — `≈ ~` reads "at least this much, and the sum is an
 * estimate". Dropping the `~` the moment a leg went missing would pass a
 * derived figure off as measured, which is the one mistake the marker exists to
 * stop.
 *
 * The format and the unit stay with the caller: this is only the marker, so the
 * card's compact cell and the band's converted figure cannot spell it
 * differently. Returns `""` for a fully measured journey.
 */
export function distancePrefix(distance: JourneyDistance): string {
  return `${distance.unknownLegs > 0 ? "≈ " : ""}${distance.estimated ? "~" : ""}`;
}

/**
 * The distinct airports the journey touches, by IATA — the ONE rule the
 * logbook strip and the table facets already share
 * (`flightSummaryFigures.ts`, `routes/flights/facets.ts`), so the band and the
 * logbook cannot disagree. ICAO is deliberately not folded in.
 */
export function distinctAirports(
  flights: readonly Pick<JourneyFlight, "depIata" | "arrIata">[]
): number {
  const airports = new Set<string>();
  for (const flight of flights) {
    if (flight.depIata) airports.add(flight.depIata);
    if (flight.arrIata) airports.add(flight.arrIata);
  }
  return airports.size;
}

/** The distinct cities a journey's airports sit in, and how many airports had no city to give. */
export interface JourneyCities {
  count: number;
  /**
   * Distinct airports the catalogue could not name a city for. Above zero the
   * count is a lower bound and the band says so; the figure is still drawn
   * rather than hidden, because a city that is known is known.
   */
  airportsWithoutCity: number;
}

export function distinctCities(flights: readonly JourneyFlight[]): JourneyCities {
  const cities = new Set<string>();
  const airportsWithCity = new Set<string>();
  const airports = new Set<string>();

  for (const flight of flights) {
    const ends = [
      [flight.depIata, flight.depCity],
      [flight.arrIata, flight.arrCity],
    ] as const;
    for (const [code, city] of ends) {
      if (code) airports.add(code);
      if (city) {
        cities.add(city);
        if (code) airportsWithCity.add(code);
      }
    }
  }

  let airportsWithoutCity = 0;
  for (const code of airports) {
    if (!airportsWithCity.has(code)) airportsWithoutCity += 1;
  }
  return { count: cities.size, airportsWithoutCity };
}

/** The journey's nights, from its stays; `null` means there is no stay to count. */
export interface JourneyNights {
  nights: number;
  /** True when at least one stay's length is itself only a bound — the band's `≈`. */
  approximate: boolean;
  /** How many stays were counted — cancelled stays are skipped whole. */
  stays: number;
}

/**
 * Sum the nights recorded on the journey's lodging stays.
 *
 * `null` (not zero) when there is no stay: a flight trip usually has none, and
 * the owner has not yet ruled on whether an untracked journey should count its
 * calendar nights instead (open question, 2026-10-08). Until they do, the
 * honest answer is a dash with its reason, never a fabricated number and never
 * `days − 1` — which is a different thing the recon explicitly ruled out.
 *
 * A cancelled stay is a night that did not happen (`roadtripView.ts`) and is
 * skipped whole, so a journey whose only stay was cancelled reads as no stay.
 * Uses `lodgingDateDisplay.stayNights`, which already resolves how much of a
 * stay's dates are known, rather than re-deriving nights from the two fields.
 */
export function nightsFromStays(stays: readonly JourneyStay[]): JourneyNights | null {
  const countables = stays.filter((stay) => stay.status !== "cancelled");
  if (countables.length === 0) return null;

  let nights = 0;
  let approximate = false;
  for (const stay of countables) {
    nights += stayNights(stay);
    if (hasUnknownLength(stay)) approximate = true;
  }
  return { nights, approximate, stays: countables.length };
}
