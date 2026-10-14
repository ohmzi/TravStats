import { prisma } from "../../db";
import { toCountryCode } from "../../shared/countryEvidence";
import { getCountryResolver } from "../../services/geo/countryFromCoordinates";
import { STATION_SELECT, stationCountries } from "../../services/roadtrip/roadtripSummary";
import { flownCountries, type VisitableFlight } from "../../services/trip/flightVisits";

/**
 * Where a trip's countries come from — the stored list, or the flights,
 * cruises and stays linked to it.
 *
 * Split out of `routes/trips.ts` unchanged: that file is frozen at 1441 lines
 * in `scripts/file-size-baseline.json` and had grown past it, and these
 * functions are the one group there that reads no request and writes no
 * response. Both the list and the detail endpoint call them — 2.5.0 fixed
 * only one of the two, which is the drift a shared module makes harder.
 *
 * `journeyDestinationCountries` is the band's list (owner ruling 2026-10-13),
 * a second reading of the same legs: where they went, in travel order, home
 * dropped. It rides the SAME airport catalogue and roadtrip rule as
 * `tripCountries`, so nothing here resolves a country two ways.
 */

/**
 * Airport facts (country + IANA zone) for a trip's flights, keyed by IATA.
 *
 * Two gaps share one lookup. The flight row stores UTC plus time semantics and
 * carries no zone of its own, so rendering each end in ITS airport's clock
 * needs the airport. And `trips.countries` is a stored column nobody derives,
 * while `flights.overflownCountries` is empty for manually created flights —
 * a hand-entered FRA-JFK left the trip reading "0 countries" for a route that
 * plainly spans two. The stored column still wins when the user filled it.
 */
export async function airportFactsFor(
  flights: Array<{ depIata: string | null; arrIata: string | null }>
): Promise<Map<string, { country: string | null; timezone: string | null }>> {
  const codes = [
    ...new Set(flights.flatMap((f) => [f.depIata, f.arrIata]).filter((c): c is string => !!c)),
  ];
  if (codes.length === 0) return new Map();
  const airports = await prisma.airport.findMany({
    where: { iata: { in: codes } },
    select: { iata: true, country: true, timezone: true },
  });
  return new Map(
    airports
      .filter((a): a is typeof a & { iata: string } => !!a.iata)
      .map((a) => [a.iata, { country: a.country, timezone: a.timezone }])
  );
}

/**
 * Countries of a trip: the stored list when it has one, otherwise derived from
 * the countries the trip's flights, cruises, stays and roadtrips put it in.
 *
 * `trips.countries` is a column nobody writes, and `overflownCountries` is
 * empty for manually created flights, so without the fallback the tile reads
 * zero for a trip that plainly visited five countries. 2.5.0 added that
 * fallback to GET /trips/:id only — and the LIST endpoint is what feeds the
 * trip cards, so every card on the Reisen overview kept showing "?" next to a
 * detail page showing five. Both call this now; a third caller must too.
 *
 * WHAT A COUNTRY HAS TO BE TRUE OF, which is the part that changed: the flights
 * contribute the countries the trip spent a NIGHT in, not every airport a leg
 * touches (`services/trip/flightVisits.ts`). Both ends of every leg used to
 * count, so a trip that flew out of Canada and changed planes twice read as five
 * countries when it had been to one (owner, 2026-10-09). The other three
 * sources are already time-bearing evidence rather than airport touches and are
 * taken at face value: a stay is nights by definition, a cruise's ports are the
 * itinerary the traveller typed, and a roadtrip reaches every country its
 * stations stand in by the one rule the roadtrip page uses.
 */
export function tripCountries(
  stored: string[],
  flights: readonly VisitableFlight[],
  facts: Map<string, { country: string | null; timezone: string | null }>,
  cruiseCountries: string[] = [],
  lodgingCountries: string[] = [],
  roadtripCountries: string[] = []
): string[] {
  // A list the user filled in themselves is theirs — returned untouched.
  if (stored.length) return stored;

  const derived = [
    // Nights spent, not tarmac touched: see services/trip/flightVisits.ts.
    ...flownCountries(flights, facts),
    // Cruise-only trips carry no flights at all, so a flight-only derivation
    // left them reading "?" for a voyage that plainly called at six countries.
    // Their countries come from the ports they visited.
    ...cruiseCountries,
    // Same shape for hotel-only trips: a stay linked to the trip is itinerary
    // evidence even when no flight or cruise exists.
    ...lodgingCountries,
    // A roadtrip in the trip reaches every country its stations stand in,
    // free pitches and pass-throughs included — not only where a stay was.
    ...roadtripCountries,
  ];

  // The two catalogues speak different languages — airports store ISO alpha-2,
  // ports store English names — so a trip with BOTH a flight and a cruise to
  // Germany would otherwise carry "DE" and "Germany" and count it twice. Fold
  // to one vocabulary, and keep anything unresolvable under its own name so a
  // country is never silently dropped from the list.
  return [...new Set(derived.map((c) => toCountryCode(c) ?? c))].sort();
}

/**
 * Countries reached by each trip's cruises, keyed by trip id.
 *
 * One query for every trip on the page rather than one per trip. Covers the
 * itinerary the way the cruise stats do: the port calls, plus the voyage's own
 * departure and arrival ports, which are not always repeated as stops.
 */
export async function cruiseCountriesByTrip(tripIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (tripIds.length === 0) return out;

  const cruises = await prisma.cruise.findMany({
    where: { tripId: { in: tripIds }, status: { not: "cancelled" } },
    select: {
      tripId: true,
      departurePort: { select: { country: true } },
      arrivalPort: { select: { country: true } },
      stops: { select: { port: { select: { country: true } } } },
    },
  });

  for (const c of cruises) {
    if (!c.tripId) continue;
    const acc = out.get(c.tripId) ?? [];
    for (const country of [
      c.departurePort?.country,
      c.arrivalPort?.country,
      ...c.stops.map((s) => s.port?.country),
    ]) {
      if (country) acc.push(country);
    }
    out.set(c.tripId, acc);
  }
  return out;
}

/**
 * Countries reached by each trip's lodging stays, keyed by trip id.
 *
 * A linked stay is part of the trip itinerary just like a linked flight or
 * cruise. Use the lodging's ISO code when it exists, because the free-text
 * country field intentionally preserves the source wording.
 */
export async function lodgingCountriesByTrip(tripIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (tripIds.length === 0) return out;

  const stays = await prisma.lodgingStay.findMany({
    // A cancelled booking never put anyone in that country. Planned stays do
    // count — a trip's itinerary is what it will visit, like its flights.
    where: { tripId: { in: tripIds }, status: { not: "cancelled" } },
    select: {
      tripId: true,
      lodging: { select: { isoCountryCode: true, country: true } },
    },
  });

  for (const stay of stays) {
    if (!stay.tripId) continue;
    const country = stay.lodging.isoCountryCode ?? stay.lodging.country;
    if (!country) continue;

    const acc = out.get(stay.tripId) ?? [];
    acc.push(country);
    out.set(stay.tripId, acc);
  }

  return out;
}

/** One leg a journey's destinations are read from, and when it began. */
export interface JourneyLeg {
  /**
   * When the leg started — a flight's departure, a roadtrip's own first day.
   * Null when unknown, which sorts it after the dated legs (the same
   * convention `services/trip/flightVisits.ts` keeps).
   */
  at: Date | null;
  /**
   * The country the leg put the traveller in: a flight's ARRIVAL airport, a
   * car leg's country (one per country its stations stand in).
   */
  countries: string[];
}

/** The earliest day any station of a roadtrip began. */
function earliestStopDay(stops: ReadonlyArray<{ startDate: Date | null }>): Date | null {
  let earliest: Date | null = null;
  for (const s of stops) {
    if (s.startDate && (earliest === null || s.startDate < earliest)) earliest = s.startDate;
  }
  return earliest;
}

/**
 * Countries reached by each trip's roadtrips, keyed by trip id, as travel
 * legs: each roadtrip's country — by the one station-country rule the
 * roadtrip page and the `countries` derivation both use (`stationCountries`),
 * so a trip and its roadtrip never disagree about where it went — and the day
 * it began, so the caller can place it among the trip's flights in travel
 * order (the `destinationCountries` rule).
 *
 * A roadtrip's OWN stored day wins over its stations' (`TripRoute.startDay`),
 * the `spanOf` rule one level up: a stored side travels as it was and only a
 * side nobody set reads the stations.
 */
export async function roadtripLegsByTrip(tripIds: string[]): Promise<Map<string, JourneyLeg[]>> {
  const out = new Map<string, JourneyLeg[]>();
  if (tripIds.length === 0) return out;

  const roadtrips = await prisma.tripRoute.findMany({
    where: { tripId: { in: tripIds }, kind: "roadtrip" },
    select: { tripId: true, startDay: true, stops: { select: STATION_SELECT } },
  });
  if (roadtrips.length === 0) return out;

  const resolver = await getCountryResolver();
  for (const r of roadtrips) {
    if (!r.tripId) continue;
    const countries = stationCountries(r.stops, resolver);
    const at = r.startDay ?? earliestStopDay(r.stops);
    out.set(r.tripId, [...(out.get(r.tripId) ?? []), { at, countries }]);
  }
  return out;
}

/**
 * The places the journey went (owner ruling 2026-10-13): the country of every
 * flight's ARRIVAL airport and of every car leg, in travel order, with the
 * FINAL element of the raw sequence DROPPED — the last flight lands home, and
 * home never shows — then deduped keeping first occurrence.
 *
 * WHY A SECOND LIST. `countries` above is a SET a card's figures count; it is
 * sorted, keeps home, and reads nothing of the route's order. The band's flags
 * are the journey itself — where it went, in the order it went — so they read
 * the arrival of each flight and the ground of each car leg, and the last
 * arrival (home) leaves the list. Karachi 2025 (arrivals `TR,PK,AE,OM,AE,TR,CA`
 * after dropping the final CA) reads `["TR","PK","AE","OM"]`.
 *
 * SIMPLICITY CASES, all intended: a round trip abroad reads `[<the
 * destination>]` (arrivals MX, CA → drop CA); a car-only journey in one
 * country reads `[]` (its one leg is the whole sequence, and the last element
 * goes); no legs reads `[]`. An empty list is not an error — the card keeps
 * the gradient it drew when no flag was drawable.
 *
 * PURE, and sharing one country lookup: `facts` is the same airport catalogue
 * `flownCountries` reads, so a flight's country is resolved one way in this
 * module, never two. The car legs come from `roadtripLegsByTrip`, whose
 * countries are already folded the same way.
 */
export function journeyDestinationCountries(
  flights: readonly VisitableFlight[],
  facts: Map<string, { country: string | null }>,
  roadtrips: readonly JourneyLeg[] = []
): string[] {
  const legs: JourneyLeg[] = [];
  for (const f of flights) {
    const country = f.arrIata ? (facts.get(f.arrIata)?.country ?? null) : null;
    if (country) legs.push({ at: f.departureTime ?? null, countries: [country] });
  }
  for (const leg of roadtrips) {
    if (leg.countries.length > 0) legs.push(leg);
  }

  // Travel order. Undated legs keep their place after the dated ones, in the
  // order they arrived — "somewhere in the itinerary" beats "after
  // everything", as in the walk above.
  legs.sort((a, b) => {
    if (a.at && b.at) return a.at.getTime() - b.at.getTime();
    if (a.at === b.at) return 0;
    return a.at ? -1 : 1;
  });

  const raw = legs.flatMap((l) => l.countries);
  // Drop the final element: the last arrival is home, and home never shows.
  const trimmed = raw.slice(0, Math.max(0, raw.length - 1));
  // Fold to one vocabulary (airports store ISO, a stay's free text may not),
  // keeping anything unresolvable under its own name, and dedupe the FIRST
  // occurrence so the order is the order travelled.
  return [...new Set(trimmed.map((c) => toCountryCode(c) ?? c))];
}
