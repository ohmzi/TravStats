import type { SummaryFigure } from "../../components/table/ListSummaryStrip";

/**
 * The three numbers above the roadtrip list, read straight off the rows the
 * list is showing.
 *
 * NO DISTANCE HEADLINE. The card prints a distance per row, but that distance
 * is not always measured: a leg with no drawn line and no routing is stored as
 * the great-circle chord between its endpoints (`services/tour/legRecompute.ts`,
 * `source: "straight"`), and routing is optional on an instance
 * (`resolveProvider.ts` returns `configured: false` without a provider key).
 * Summing chords and routed kilometres into one figure would pass a mix of
 * measured and estimated off as a single measured number — exactly what
 * `railSummaryFigures` ("DISTANCE IS DELIBERATELY ABSENT"), `rentalSummaryFigures`
 * ("Kilometres are left out like rail's distance") and `flightSummaryFigures`
 * all refuse, and what `ListSummaryStrip`'s own doc forbids ("anything
 * estimated ... has no business being silently summed into a headline number").
 * A roadtrip distance total keeps its home on `/stats`, where its own wording
 * can say what it contains. The first figure is the row count every sibling
 * strip carries.
 *
 * DRIVES IS THE ROAD-LEG COUNT, not `stationCount - 1`. A via point is a full
 * leg ENDPOINT — the route bends through it and the leg writer joins it to its
 * neighbours — so counting station pairs would undercount every route that
 * bends. The owner fixed this figure as "drives — one per leg ... every road
 * stretch between two stations" (owner, 2026-10-08); the backend emits it as
 * `driveCount` (`services/roadtrip/roadtripSummary.ts`), filtered by the SAME
 * allow-list `drivenKm` uses, so a ferry, rail, foot or bike leg is NOT counted
 * as a drive and the figure cannot disagree with the kilometres the card shows.
 * Legs are keyed by endpoint pair (`shared/tour/legPlan.ts`), so a repeated
 * ordered pair — an out-and-back — is ONE drive, not two.
 *
 * The third figure is CITIES — the places the shown roadtrips touched. The
 * owner asked for "how many cities i touched in all the road trips" (owner,
 * 2026-10-08), so it is the UNION of the rows' city names, not a sum of their
 * counts: one city touched by three roadtrips is ONE city. The grammar is the
 * flights strip's ("41 Flights · 15 Airlines · 21 Airports" counts distinct
 * airlines and airports over the shown flights rather than summing them).
 *
 * A city here is exactly what the roadtrip CARD's cities cell counts: a station
 * title, trimmed, empties skipped, deduplicated by the exact string. The owner
 * was shown and accepted that a title is free text, so "Oakville" and
 * "Oakville, Ontario" count as two; a via point is a bend in the route, never a
 * place. The backend computes the per-row names (`stationCityNames`, over ALL
 * stations, not the placed-only array) and sends them as `cityNames`, so the
 * strip and the card read one field and cannot disagree.
 *
 * All three fold every SHOWN row, planned roadtrips included: the strip's
 * promise is "computed from exactly the rows the list is showing", and the
 * Planned section is part of what is shown. Leaving planned rows out here would
 * put the strip and the list back into the contradiction this component was
 * built to remove; "a planned roadtrip counts for nothing in any statistic"
 * (`roadtripView.ts`) governs the dated /stats rollups, a different surface.
 *
 * Lives here rather than in the page, like `flightSummaryFigures.ts` and
 * `railSummaryFigures.ts`, so it can be tested without rendering. The default
 * formatter is `String`, which keeps it testable without `Intl`; the page
 * passes `nf.format`.
 */

/**
 * The fields of a roadtrip row this summary reads. Minimal on purpose, like
 * `SummarisableFlight`: the full DTO is not needed to fold three counts.
 */
export interface SummarisableRoadtrip {
  /** Road legs only — counted by `drivenLegs` (tourDistance), a ferry excluded. */
  driveCount: number;
  /** Distinct station titles this row carries — its cities. Folding UNIONS them. */
  cityNames: string[];
}

/**
 * Each label takes the count it describes, so `t()` can pick the singular
 * (`forgejo#160`).
 */
export interface RoadtripSummaryLabels {
  roadtrips: (count: number) => string;
  drives: (count: number) => string;
  cities: (count: number) => string;
}

export function roadtripSummaryFigures(
  rows: readonly SummarisableRoadtrip[],
  labels: RoadtripSummaryLabels,
  format: (n: number) => string = (n) => String(n)
): SummaryFigure[] {
  const drives = rows.reduce((sum, r) => sum + r.driveCount, 0);
  // UNION, not sum: a city touched by three roadtrips is one city. The names
  // arrive per row already trimmed and deduped, so a plain Set is the whole rule.
  const cities = new Set<string>();
  for (const r of rows) for (const name of r.cityNames) cities.add(name);

  return [
    { key: "roadtrips", value: format(rows.length), label: labels.roadtrips(rows.length) },
    { key: "drives", value: format(drives), label: labels.drives(drives) },
    { key: "cities", value: format(cities.size), label: labels.cities(cities.size) },
  ];
}
