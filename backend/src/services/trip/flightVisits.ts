/**
 * Which countries a trip's FLIGHTS show it went to.
 *
 * THE RULE, in the owner's words (2026-10-09): "the start of journey country
 * shouldnt count. and if start and end are the same then again it shouldnt
 * count. but if end is different then it should count. and if any other country
 * is in the middle of trip and considered layover then it should count."
 *
 * So: every country a leg touches counts — BOTH ends, and a layover is a
 * country the trip was in, not a tarmac to be argued away ("take example of
 * karachi 2025 trip. Istanbul shoild count"). The one exclusion is where the
 * trip STARTED, which is why a trip out of Canada and back into Canada no longer
 * reads as five countries (owner: "it actually shouldnt even have canada because
 * we only flew out of there"). Excluding the start covers the return leg too:
 * when start and end are the same country there is nothing to add back.
 *
 * THAT LAST SENTENCE IS WHY THIS IS NOT SIMPLY "DROP THE ORIGIN". A trip that
 * never leaves its own country touches exactly one country, and it is the origin
 * — dropping it would leave the card with no countries and therefore no flags
 * at all, erasing a trip rather than correcting it. So the origin is dropped
 * only when something else remains; when it is all the trip has, it is what the
 * trip has. (The alternative — a literal reading that blanks such a card — is a
 * one-line change if the owner ever wants it.)
 *
 * WHY THIS IS NOT THE NIGHT COUNT IT FIRST WAS. An earlier draft counted only
 * countries where a night was spent, which correctly killed the departure
 * country but also killed every layover — and the owner counts layovers. The
 * distinction he draws is start versus everywhere-else, not stay versus
 * plane change, so the walk over times is gone and this is a set.
 */

/** The airport facts a leg needs: the country its IATA code stands in. */
export type AirportCountry = Map<string, { country: string | null }>;

/** The shape of a flight this rule reads. Only the ends and the clock matter. */
export interface VisitableFlight {
  depIata: string | null;
  arrIata: string | null;
  departureTime?: Date | null;
  arrivalTime?: Date | null;
}

/**
 * The countries the flights show the trip in, sorted — the start excluded.
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

  // Only the START needs an order, and the caller's is not guaranteed. An
  // undated leg keeps its place rather than being moved to one end: "somewhere
  // in the itinerary" beats "after everything".
  const legs = flights
    .map((f, index) => ({
      index,
      dep: countryAt(f.depIata),
      arr: countryAt(f.arrIata),
      depAt: f.departureTime ?? null,
    }))
    .filter((l) => l.dep || l.arr)
    .sort((a, b) => {
      if (a.depAt && b.depAt) return a.depAt.getTime() - b.depAt.getTime();
      if (a.depAt === b.depAt) return a.index - b.index;
      return a.depAt ? -1 : 1;
    });

  const origin = legs[0]?.dep ?? null;

  const touched = new Set<string>();
  for (const leg of legs) {
    if (leg.dep) touched.add(leg.dep);
    if (leg.arr) touched.add(leg.arr);
  }

  if (origin && touched.size > 1) touched.delete(origin);
  // A trip that never left its own country is that country; see the note above.

  return [...touched].sort();
}
