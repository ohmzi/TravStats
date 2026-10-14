import type { Flight } from "../types";
import { localWallClockOf } from "../shared/localWallClock";

/**
 * The fields the leg order reads. A `Flight` satisfies it, and so does the
 * narrower `Pick` a `Trip`'s flights arrive as (`GET /trips/:id`) — the journey
 * page orders the same rows with the same rule the logbook's timeline does,
 * without pretending the whole row is present.
 */
type LegOrderRow = Pick<
  Flight,
  "departureTime" | "depIata" | "arrIata" | "depTimezone" | "depTimeSemantics"
>;

/**
 * Order flights for trip-leg display: stable timestamp sort first, then a
 * topological repair pass for same-day groups whose timestamp order does
 * not reflect the IATA chain.
 *
 * Why this is needed: DATE_ONLY rows carry a placeholder time — the form
 * writes 12:00 LOCAL, the cruise import 00:00 local, each converted through
 * the airport's zone. A timed flight on the same day sorts after the
 * placeholder even when chronologically it must come first (e.g. OGG→HNL
 * precedes HNL→SFO in a Hawaii return leg). Pure timestamp sort gets it wrong.
 *
 * "Same day" is the departure airport's LOCAL day (`localWallClockOf`, the
 * clock every flight statistic reads), not the UTC date: east of UTC a
 * placeholder and a timed flight of one local day straddle UTC midnight, and a
 * UTC window would never put them together (forgejo#273).
 *
 * The repair walks each contiguous same-day window and reorders it as a
 * chain: pick the head whose `depIata` is not used as any other flight's
 * `arrIata` within the window, then extend by `prev.arrIata === next.depIata`.
 * Falls back to the original timestamp order if the window cannot be
 * resolved into a single chain (e.g. two disjoint trips on the same day,
 * or ambiguous data) — better stable than re-shuffled.
 */
export function sortFlightsByLegOrder<T extends LegOrderRow>(flights: T[]): T[] {
  const sorted = [...flights].sort((a, b) => {
    const ta = a.departureTime ? new Date(a.departureTime).getTime() : 0;
    const tb = b.departureTime ? new Date(b.departureTime).getTime() : 0;
    return ta - tb;
  });

  // Walk same-day windows and try to chain-repair each.
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sameLocalDay(sorted[i], sorted[j])) {
      j++;
    }
    if (j - i >= 2) {
      const repaired = repairSameDayChain(sorted.slice(i, j));
      if (repaired) {
        for (let k = 0; k < repaired.length; k++) sorted[i + k] = repaired[k];
      }
    }
    i = j;
  }

  return sorted;
}

/**
 * Try to reorder a same-day window into a single connected IATA chain.
 * Returns null when no unique head exists (= can't pick a deterministic
 * starting flight) so the caller keeps the timestamp order.
 */
function repairSameDayChain<T extends LegOrderRow>(window: T[]): T[] | null {
  if (window.length < 2) return null;
  const arrIatas = new Set(
    window.map((f) => f.arrIata).filter((x): x is string => typeof x === "string")
  );
  const heads = window.filter((f) => f.depIata && !arrIatas.has(f.depIata));
  if (heads.length !== 1) return null;

  const remaining = new Set(window);
  const out: T[] = [];
  let current: T | undefined = heads[0];
  while (current) {
    out.push(current);
    remaining.delete(current);
    const next: T | undefined = [...remaining].find(
      (f) => f.depIata && current!.arrIata && f.depIata === current!.arrIata
    );
    current = next;
  }
  // Disconnected segment (some flights left unchained) → keep original.
  if (remaining.size > 0) return null;
  return out;
}

/** The departure's day on its airport's clock; the stored date without a zone. */
function departureDay(flight: LegOrderRow): string | null {
  if (!flight.departureTime) return null;
  return localWallClockOf(
    new Date(flight.departureTime),
    flight.depTimezone,
    flight.depTimeSemantics
  ).date;
}

function sameLocalDay(a: LegOrderRow, b: LegOrderRow): boolean {
  const day = departureDay(a);
  return day !== null && day === departureDay(b);
}
