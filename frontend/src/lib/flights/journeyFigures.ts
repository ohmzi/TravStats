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
 *
 * NIGHTS ARE THE JOURNEY'S SPAN, NOT THE SUM OF ITS STAYS. The owner ruled that
 * a flight journey's nights run from the day it left to the day it came back to
 * the city it left from — or, one-way, from the start to the last arrival
 * (owner, 2026-10-08). That is a property of the LEGS, not of the lodging, so
 * it is `journeyNights` below and reads no stays. `nightsFromStays` still
 * holds its own rule and is kept, but the journey's nights are no longer it.
 */

const DAY_MS = 86_400_000;

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
  /** The leg's own times — the span fold orders the legs by the first. */
  departureTime?: string | null;
  arrivalTime?: string | null;
  /** ICAO and name — the other aliases `placeAliases` reads when a leg has no city. */
  depIcao?: string | null;
  arrIcao?: string | null;
  depName?: string | null;
  arrName?: string | null;
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

/**
 * Every name an endpoint answers to: the catalogue's city, its IATA and ICAO
 * codes, the plain name. Empty and absent values are dropped, so a leg that
 * says nothing yields an empty set.
 *
 * A RETURN IS MATCHED BY ANY SHARED ALIAS, not one canonical field. The owner's
 * rule is "return back to the same city" (owner, 2026-10-08), and one place can
 * be named on one leg and left to its code on another — a partial airport
 * catalogue is a first-class case (`distinctCities` reports it as
 * `airportsWithoutCity`), so the origin's departure may carry a city while the
 * returning leg's arrival carries only `YYZ`. Comparing a single field per
 * endpoint misses that return and stretches the span over the legs AFTER it;
 * intersecting the alias sets also keeps the intended "same city, a different
 * airport" case, which keying on a code alone would break.
 */
function placeAliases(flight: JourneyFlight, end: "dep" | "arr"): Set<string> {
  const city = end === "dep" ? flight.depCity : flight.arrCity;
  const iata = end === "dep" ? flight.depIata : flight.arrIata;
  const icao = end === "dep" ? flight.depIcao : flight.arrIcao;
  const name = end === "dep" ? flight.depName : flight.arrName;
  const aliases = new Set<string>();
  for (const value of [city, iata, icao, name]) {
    if (value) aliases.add(value);
  }
  return aliases;
}

/** Whether two endpoints name the same place — by city, code, icao or name. */
function sharesAlias(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

/** The UTC midnight of an instant's calendar day, or `null` when it does not parse. */
function utcDay(iso: string): number | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The journey's nights, as its SPAN (owner, 2026-10-08): "counted from the day
 * of leaving to return back to the same city otherwise if its one way then
 * start to end of journey".
 *
 * The legs are ordered by departure and walked; the journey ENDS at the first
 * leg that arrives back at the city the first leg left from, so the count runs
 * from the day of leaving to the day of returning. A journey that never comes
 * back — a one-way — ends at the LAST arrival: start to end of journey. What
 * that yields is the number of whole calendar days between the two end dates,
 * which is the nights away, and NOT the sum of the journey's recorded stays:
 * that fold is `nightsFromStays`, a different figure, and it is no longer the
 * journey's nights.
 *
 * `null` — the dash, never a fabricated number — when no leg carries a
 * departure to order by, when the terminating leg carries no arrival, or when
 * the two dates come out in the wrong order. The day difference is read in UTC
 * date parts, the rule the backend's `daySpan` uses
 * (`shared/tour/roadtrip.ts`), so the card and the band cannot disagree about
 * where a leg falls. A same-day return is honestly `0`.
 */
export function journeyNights(flights: readonly JourneyFlight[]): number | null {
  const ordered = flights
    .filter((f): f is JourneyFlight & { departureTime: string } => Boolean(f.departureTime))
    .sort((a, b) => Date.parse(a.departureTime) - Date.parse(b.departureTime));
  if (ordered.length === 0) return null;

  const origin = placeAliases(ordered[0], "dep");
  let terminating = ordered[ordered.length - 1];
  if (origin.size > 0) {
    // The first leg back to the origin closes the journey; the legs after it
    // are a further trip and are not part of this span. A leg is the return
    // when its arrival shares ANY alias with the origin's departure — city,
    // code, icao or name — because a partial catalogue can name one end and
    // leave the other to its code (see `placeAliases`).
    const returned = ordered.find((f) => sharesAlias(placeAliases(f, "arr"), origin));
    if (returned) terminating = returned;
  }

  const start = ordered[0].departureTime;
  const end = terminating.arrivalTime;
  if (!start || !end) return null;
  const from = utcDay(start);
  const to = utcDay(end);
  if (from === null || to === null) return null;
  const nights = Math.round((to - from) / DAY_MS);
  return nights < 0 ? null : nights;
}

/** The night sum of the journey's stays — `nightsFromStays`, not the journey's nights. */
export interface JourneyNights {
  nights: number;
  /** True when at least one stay's length is itself only a bound — the `≈`. */
  approximate: boolean;
  /** How many stays were counted — cancelled stays are skipped whole. */
  stays: number;
}

/**
 * Sum the nights recorded on the journey's lodging stays.
 *
 * NO LONGER the journey's nights (owner, 2026-10-08): the journey's nights are
 * now its SPAN, folded by `journeyNights` above, and the card and the band both
 * read that. This fold stays because it holds a correct reading of the stays —
 * the night sum of the accommodation — and its tests still pass; it is currently
 * unread in production (the band was its only caller). A surface that wants
 * "nights in a stay" may read it; a surface that says "the journey's nights"
 * must not, or it will disagree with the card and the band.
 *
 * `null` (not zero) when there is no stay, so a caller reads a dash with its
 * reason rather than a fabricated zero.
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
