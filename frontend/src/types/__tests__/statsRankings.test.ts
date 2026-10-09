import { describe, expectTypeOf, it } from "vitest";

import type * as Index from "../index";
import type * as Rankings from "../statsRankings";

/**
 * The ranking responses moved out of `types/index.ts` (800-line limit) into
 * `types/statsRankings.ts`. Every caller still imports them from the index,
 * so both names must be one type, not two copies that can drift apart.
 */
describe("stats ranking types", () => {
  it("are the same types from the index and from their own module", () => {
    expectTypeOf<Index.AirlineRankingItem>().toEqualTypeOf<Rankings.AirlineRankingItem>();
    expectTypeOf<Index.AirlineRankingResponse>().toEqualTypeOf<Rankings.AirlineRankingResponse>();
    expectTypeOf<Index.CountryStat>().toEqualTypeOf<Rankings.CountryStat>();
    expectTypeOf<Index.CountryStatsResponse>().toEqualTypeOf<Rankings.CountryStatsResponse>();
  });

  it("still declares the fields the stats page reads", () => {
    // Compile-time only: `expectTypeOf` is erased at runtime, so `tsc --noEmit`
    // is the check that fails when a field is dropped or renamed in the move.
    expectTypeOf<Index.CountryStatsResponse>().toHaveProperty("countriesIso");
    expectTypeOf<Index.CountryStatsResponse>().toHaveProperty("byYear");
    expectTypeOf<Index.AirlineRankingItem>().toHaveProperty("iata");
    expectTypeOf<Index.AirlineRankingItem>().toHaveProperty("key");
    expectTypeOf<Index.AirlineRankingResponse>().toHaveProperty("flightsWithoutAirline");
  });
});
