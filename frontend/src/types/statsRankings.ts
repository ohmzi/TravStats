/**
 * The airline and country rankings of the stats page (`GET /stats/page`
 * sections `airlines` and `countries`, and `GET /stats/countries`).
 *
 * Moved out of `types/index.ts` to keep it under the 800-line limit. The index
 * re-exports them, so callers keep importing from `types`.
 */

export interface AirlineRankingItem {
  airline: string;
  count: number;
  percentage: number;
  /** IATA code resolved by the catalogue; absent when nothing matches. The API
   *  has carried it since 2.5.0 — this side simply never declared it, so the
   *  card could not render what the endpoint was already sending. */
  iata?: string;
  /**
   * The canonical `airlineGroupKey` identity ("iata:LH", "name:some carrier")
   * this row folds — always present. The evidence panel addresses a ranking
   * row by this, never by `airline` (a display label): the API has carried
   * it since the evidence resolvers landed (`routes/stats.ts`), this side
   * simply never declared it either.
   */
  key: string;
}

export interface AirlineRankingResponse {
  airlines: AirlineRankingItem[];
  /** Flights that carry an airline — the denominator of every percentage. */
  total: number;
  /** Flights with no airline at all. They used to be ranked as a carrier
   *  called "Unknown" and to sit in the denominator, diluting every real
   *  airline's share. Reported so the gap can be named instead. */
  flightsWithoutAirline?: number;
}

export interface CountryStat {
  country: string;
  count: number;
}

export interface CountryStatsResponse {
  /** Display vocabulary, ranked by flight count. */
  countries: CountryStat[];
  total: number;
  /** Counting vocabulary: lifetime departure countries as ISO alpha-2, so the
   *  cross-domain KPI can union them with the port catalogue without counting
   *  "Germany" and "DE" twice. Optional — an older backend omits it. */
  countriesIso?: string[];
  /** Departure countries keyed by year (the year on the clock at the
   *  departure airport), same ISO vocabulary. Optional so an older backend
   *  still parses. */
  byYear?: Record<string, string[]>;
}
