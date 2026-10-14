import { prisma } from "../../db";
import { toCountryCode } from "../../shared/countryEvidence";
import { isStation } from "../../shared/tour/roadtrip";
import { getCountryResolver } from "../../services/geo/countryFromCoordinates";
import {
  STATION_SELECT,
  stationCountries,
  stationCountry,
} from "../../services/roadtrip/roadtripSummary";
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
 * `journeyPrimaryCountry` is the band's ONE flag (owner ruling 2026-10-14):
 * the country the journey spent most of its days in, read off its roadtrip
 * stations, with its flights the fallback when it has none. It rides the SAME
 * airport catalogue and roadtrip rule as `tripCountries`, so nothing here
 * resolves a country two ways.
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
  roadtripCountries: string[] = [],
  rideCountries: string[] = []
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
    // Train and bus rides: a rail- or coach-only trip crossed borders too
    // (forgejo#288 sweep) — the terminals' own countries, never guessed.
    ...rideCountries,
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

/**
 * Countries reached by each trip's roadtrips, keyed by trip id — by the one
 * station-country rule the roadtrip page uses (`stationCountries`), so a
 * trip and its roadtrip never disagree about where it went.
 */
export async function roadtripCountriesByTrip(tripIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (tripIds.length === 0) return out;

  const roadtrips = await prisma.tripRoute.findMany({
    where: { tripId: { in: tripIds }, kind: "roadtrip" },
    select: { tripId: true, stops: { select: STATION_SELECT } },
  });
  if (roadtrips.length === 0) return out;

  const resolver = await getCountryResolver();
  for (const r of roadtrips) {
    if (!r.tripId) continue;
    out.set(r.tripId, [...(out.get(r.tripId) ?? []), ...stationCountries(r.stops, resolver)]);
  }
  return out;
}

/** One station of a journey's roadtrip: where it stood and which days it covers. */
export interface JourneyStop {
  /** The station's country, by the one `stationCountries` rule; null when unknown. */
  country: string | null;
  /**
   * The distinct calendar days the station covers, as UTC-midnight keys — its
   * start date through its end date INCLUSIVE. Empty when the station is
   * undated: `stationWinner` weighs it as one synthetic day instead, so it can
   * collide neither with a real day nor with another undated station.
   */
  days: readonly number[];
  /** The station's start day, the ordering key. Null when undated. */
  at: Date | null;
}

const DAY_MS = 86_400_000;

/** A date's own UTC calendar day, as that day's midnight — one key per day. */
function dayKey(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The distinct calendar days a station covers, as UTC-midnight keys: its start
 * date through its end date INCLUSIVE, so a single-day stop is one day and a
 * five-day stay is five. A station without both ends covers none — it is a
 * place the journey was, and `stationWinner` weighs it as one synthetic day.
 * A station whose end precedes its start still covers its start day, the floor
 * a dated station can be.
 *
 * This is the band's own count of days SPENT, not `shared/tour/roadtrip.ts`'s
 * `daySpan`, which measures the gap between two days and answers 0 for a
 * single-day stop. The two are not the same rule and this module does not
 * borrow that one.
 */
function stationDayKeys(station: { startDate: Date | null; endDate: Date | null }): number[] {
  if (!station.startDate || !station.endDate) return [];
  const start = dayKey(station.startDate);
  const end = Math.max(start, dayKey(station.endDate));
  const days: number[] = [];
  for (let day = start; day <= end; day += DAY_MS) days.push(day);
  return days;
}

/** startDate first (undated last), stable — the itinerary order the band reads. */
function byTravelOrder(a: JourneyStop, b: JourneyStop): number {
  if (a.at && b.at) return a.at.getTime() - b.at.getTime();
  if (a.at === b.at) return 0;
  return a.at ? -1 : 1;
}

/**
 * Every journey's roadtrip stations, in start-date order, keyed by trip id.
 *
 * This is the band's whole input (owner ruling 2026-10-14): the country the
 * journey spent most of its days in is read off these stations. The country of
 * a station comes from the ONE rule the roadtrip page uses (`stationCountry`),
 * and a route correction (`isStation`) is not a station — it counts for
 * nothing here exactly as it counts for nothing in every station count.
 *
 * The order is `startDate` first, then the route's own station order (the
 * routes are read in their own order, their stops by `routeOrderIdx`), so a
 * tie on days can be settled by the earliest station. A station without a
 * start day keeps its place after the dated ones — the convention every
 * itinerary walk in this codebase keeps.
 */
export async function journeyStopsByTrip(tripIds: string[]): Promise<Map<string, JourneyStop[]>> {
  const out = new Map<string, JourneyStop[]>();
  if (tripIds.length === 0) return out;

  const routes = await prisma.tripRoute.findMany({
    where: { tripId: { in: tripIds }, kind: "roadtrip" },
    select: {
      tripId: true,
      stops: { select: STATION_SELECT, orderBy: { routeOrderIdx: "asc" } },
    },
  });
  if (routes.length === 0) return out;

  const resolver = await getCountryResolver();
  for (const route of routes) {
    if (!route.tripId) continue;
    const stops: JourneyStop[] = route.stops.filter(isStation).map((stop) => ({
      country: stationCountry(stop, resolver),
      days: stationDayKeys(stop),
      at: stop.startDate,
    }));
    out.set(route.tripId, [...(out.get(route.tripId) ?? []), ...stops]);
  }

  // A stable sort leaves the undated stations after the dated ones, in the
  // order they arrived — route order, then the route's own station order.
  for (const stops of out.values()) stops.sort(byTravelOrder);
  return out;
}

/**
 * The ONE flag the journey's card shows (owner ruling 2026-10-14): the country
 * the journey spent the MOST time in — an array of at most one code, or an
 * empty list when nothing can be resolved (the card keeps its gradient).
 *
 * The journey's STATIONS decide it, because that is where its own data holds
 * real time. Each station contributes the distinct calendar days it covers,
 * unioned per country — a day two stations share counts once, so the weight is
 * days SPENT, not spans summed. The country with the most distinct days wins; a
 * tie goes to the country present on the earliest day, then to the earlier
 * station — `stops` arrives in start-date order, so the first time a country
 * appears is its earliest station's place in the journey.
 *
 * A journey whose stations resolve NO country falls back to its flights: the
 * country with the most arrivals, a tie settled by the earliest flight. This
 * keeps a journey whose places were never recorded from showing nothing. Both
 * rules resolve a country through the same catalogues this module already
 * reads — `facts` for a flight's arrival, `stationCountries`' rule for a
 * station's land — so a country is never worked out two ways.
 *
 * The answer is folded to ISO alpha-2 like every other country this module
 * emits, so a catalogue spelling ("Mexico") and a code ("MX") cannot disagree.
 */
export function journeyPrimaryCountry(
  flights: readonly VisitableFlight[],
  facts: Map<string, { country: string | null }>,
  stops: readonly JourneyStop[] = []
): string[] {
  const winner = stationWinner(stops) ?? flightArrivalWinner(flights, facts);
  return winner ? [toCountryCode(winner) ?? winner] : [];
}

/**
 * The country with the most distinct days spent; a tie goes to the earliest day
 * the country was present, then to the earliest station.
 */
function stationWinner(stops: readonly JourneyStop[]): string | null {
  // The union of each country's days: a day two stations share is counted once,
  // which is the whole point — the weight is days SPENT, not spans summed.
  const days = new Map<string, Set<number>>();
  // The earliest real day a country was present, for the tie-break. An undated
  // station offers no day here.
  const firstDay = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  stops.forEach((stop, index) => {
    if (!stop.country) return;
    const covered = days.get(stop.country) ?? new Set<number>();
    if (stop.days.length) {
      for (const day of stop.days) covered.add(day);
      const seen = firstDay.get(stop.country);
      if (seen === undefined || stop.days[0] < seen) firstDay.set(stop.country, stop.days[0]);
    } else {
      // An undated station weighs one synthetic day, keyed off its own index, so
      // it collides neither with a real day nor with another undated station.
      covered.add(-(index + 1));
    }
    days.set(stop.country, covered);
    if (!firstSeen.has(stop.country)) firstSeen.set(stop.country, index);
  });

  let winner: string | null = null;
  for (const country of days.keys()) {
    if (winner === null) {
      winner = country;
      continue;
    }
    const leaderDays = (days.get(winner) as Set<number>).size;
    const challengerDays = (days.get(country) as Set<number>).size;
    if (challengerDays !== leaderDays) {
      if (challengerDays > leaderDays) winner = country;
      continue;
    }
    const leaderDay = firstDay.get(winner);
    const challengerDay = firstDay.get(country);
    // A country with a real day beats one known only by undated stations; when
    // both are, the earlier day wins; with no days to compare, the earlier
    // station does.
    const earliestDayWins =
      challengerDay !== undefined && (leaderDay === undefined || challengerDay < leaderDay);
    const earliestStationWins =
      challengerDay === leaderDay &&
      (firstSeen.get(country) as number) < (firstSeen.get(winner) as number);
    if (earliestDayWins || earliestStationWins) winner = country;
  }
  return winner;
}

/** The country with the most flight arrivals; a tie goes to the earliest flight. */
function flightArrivalWinner(
  flights: readonly VisitableFlight[],
  facts: Map<string, { country: string | null }>
): string | null {
  // Chronological, undated after the dated and stable — the convention every
  // itinerary walk here keeps.
  const ordered = [...flights].sort((a, b) => {
    const at = a.departureTime ?? null;
    const bt = b.departureTime ?? null;
    if (at && bt) return at.getTime() - bt.getTime();
    if (at === bt) return 0;
    return at ? -1 : 1;
  });

  const arrivals = new Map<string, number>();
  const firstArrival = new Map<string, number>();
  ordered.forEach((flight, index) => {
    const place = flight.arrIata ? (facts.get(flight.arrIata)?.country ?? null) : null;
    const code = place ? (toCountryCode(place) ?? place) : null;
    if (!code) return;
    arrivals.set(code, (arrivals.get(code) ?? 0) + 1);
    if (!firstArrival.has(code)) firstArrival.set(code, index);
  });

  let winner: string | null = null;
  for (const country of arrivals.keys()) {
    if (winner === null) {
      winner = country;
      continue;
    }
    const leader = arrivals.get(winner) as number;
    const challenger = arrivals.get(country) as number;
    if (
      challenger > leader ||
      (challenger === leader &&
        (firstArrival.get(country) as number) < (firstArrival.get(winner) as number))
    ) {
      winner = country;
    }
  }
  return winner;
}

/**
 * Countries at the two ends of each trip's train and bus rides, keyed by trip
 * id. Only what the row records (`depCountry`/`arrCountry` come from the
 * geocoder and are null when unknown): a ride with no country adds none. A
 * cancelled ride never went there.
 */
export async function rideCountriesByTrip(tripIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (tripIds.length === 0) return out;
  const where = { tripId: { in: tripIds }, status: { not: "cancelled" } };
  const select = { tripId: true, depCountry: true, arrCountry: true } as const;
  const [rail, bus] = await Promise.all([
    prisma.railJourney.findMany({ where, select }),
    prisma.busJourney.findMany({ where, select }),
  ]);
  for (const ride of [...rail, ...bus]) {
    if (!ride.tripId) continue;
    const acc = out.get(ride.tripId) ?? [];
    for (const country of [ride.depCountry, ride.arrCountry]) if (country) acc.push(country);
    out.set(ride.tripId, acc);
  }
  return out;
}
