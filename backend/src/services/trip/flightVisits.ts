/**
 * Which countries a trip's FLIGHTS show it was actually in.
 *
 * WHY THIS IS NOT "EVERY AIRPORT A LEG TOUCHES". The old derivation took both
 * ends of every leg, so a trip that flew out of Canada and changed planes twice
 * read as five countries when it had been to one — the country it left from
 * counted as visited, and so did every country it crossed a tarmac in (owner,
 * 2026-10-09: "it actually shouldnt even have canada because we only flew out
 * of there"). A country is somewhere the trip was, not somewhere a flight
 * touched.
 *
 * THE RULE, and it is about TIME because that is what the owner named: a
 * country counts when the trip spent a NIGHT in it. Walk the legs in order and
 * close a segment each time a leg arrives somewhere new; a segment that started
 * on one day and ended on a later one is a night away. "look at the cities
 * details where the flight landed and took the flight out of where most of the
 * time was spent" — landing and later leaving the same country is the segment,
 * and the night is what separates a stay from a plane change.
 *
 * WHAT THAT DOES TO THE CASES THAT ASKED FOR IT. A country the trip only flew
 * out of, and flew back into at the end, never gets a segment that starts and
 * ends a day apart — it is the origin, not a visit — so it drops. A country
 * where a plane was changed between two legs on one day gets a segment of zero
 * nights, so it drops too. A trip that never leaves one country still collects
 * its own segment and keeps it, because the whole trip was spent there.
 *
 * WHEN THE TIMES ARE MISSING. Imported legs often carry no times; a segment
 * with no leftAt to measure is counted rather than dropped, because "arrived
 * and later left" is evidence on its own and the alternative would silently
 * erase a country. The only segment that never counts without times is the one
 * the trip ENDS in when that country is also where it started — the origin
 * again. A trip that ends somewhere else counts that country: it ended there.
 */

/** The airport facts a leg needs: the country its IATA code stands in. */
export type AirportCountry = Map<string, { country: string | null }>;

/** The shape of a flight this rule reads. Dates are nullable, as stored. */
export interface VisitableFlight {
  depIata: string | null;
  arrIata: string | null;
  departureTime?: Date | null;
  arrivalTime?: Date | null;
}

/** Whole days between two instants, in UTC. Null when either end is unknown. */
function nightsBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * The countries the flights show a night spent in, sorted.
 *
 * Pure: no request, no database, no clock. `facts` is the caller's airport
 * catalogue, so this can be tested with a handful of literals.
 */
export function flownCountries(
  flights: readonly VisitableFlight[],
  facts: AirportCountry
): string[] {
  const countryAt = (code: string | null): string | null =>
    code ? facts.get(code)?.country ?? null : null;

  // The walk is only meaningful in chronological order, and the caller's order
  // is not guaranteed. An undated leg keeps its place rather than being moved
  // to one end, because "somewhere in the itinerary" beats "after everything".
  const legs = flights
    .map((f, index) => ({
      index,
      dep: countryAt(f.depIata),
      arr: countryAt(f.arrIata),
      depAt: f.departureTime ?? null,
      arrAt: f.arrivalTime ?? f.departureTime ?? null,
    }))
    .filter((l) => l.dep || l.arr)
    .sort((a, b) => {
      if (a.depAt && b.depAt) return a.depAt.getTime() - b.depAt.getTime();
      if (a.depAt === b.depAt) return a.index - b.index;
      return a.depAt ? -1 : 1;
    });

  const origin = legs[0]?.dep ?? null;
  const visited = new Set<string>();

  let open: { country: string; arrivedAt: Date | null; leftAt: Date | null } | null = null;

  /** A segment that ended: counted when it spanned a night, or when we cannot
   *  measure it and the itinerary says the trip was there at all. */
  const closeSegment = (segment: { country: string; arrivedAt: Date | null; leftAt: Date | null }): void => {
    const nights = nightsBetween(segment.arrivedAt, segment.leftAt);
    if (nights === null || nights >= 1) visited.add(segment.country);
  };

  for (const leg of legs) {
    if (open && leg.dep && leg.dep === open.country) {
      open.leftAt = leg.depAt ?? open.leftAt;
    }
    if (open && leg.arr && leg.arr !== open.country) {
      closeSegment(open);
      open = null;
    }
    if (!open && leg.arr) {
      open = { country: leg.arr, arrivedAt: leg.arrAt, leftAt: null };
    }
  }

  // The last segment. If the trip LEFT it, the night rule decides like any
  // other — and that is the case of a trip that never leaves its own country,
  // whose one segment is also its origin, so skipping it here would erase the
  // whole trip. If the trip never left it, the trip ended there: that counts
  // when it is not home, because the origin is where the trip started rather
  // than somewhere it went.
  if (open && open.leftAt) closeSegment(open);
  else if (open && open.country !== origin) visited.add(open.country);

  return [...visited].sort();
}
