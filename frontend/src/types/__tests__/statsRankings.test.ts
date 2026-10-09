import { describe, expect, expectTypeOf, it } from "vitest";

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

  it("still describes what the countries ranking answers", () => {
    const ranking: Index.CountryStatsResponse = {
      countries: [{ country: "Westshire", count: 3 }],
      total: 3,
      countriesIso: ["ZZ"],
      byYear: { "2031": ["ZZ"] },
    };
    expect(ranking.countries[0].count).toBe(ranking.total);
  });
});
