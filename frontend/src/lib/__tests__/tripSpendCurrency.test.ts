import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRIP_SPEND_SETTING,
  categoryAmount,
  normalizeTripSpendSetting,
  parseRateInput,
  roundMinor,
  tripSpendView,
  type SpendFigures,
  type TripSpendSetting,
} from "../tripSpendCurrency";

/**
 * The two-currency view math behind "Paid from your accounts". Amounts are
 * minor units (cents). The fixture is the contract's own example: CAD 1,000
 * and USD 170 paid, CAD 1,234.56 / USD 900.12 at each transaction's date, and
 * CAD 980 priced by TravStats.
 */
const figures = (over: Partial<SpendFigures> = {}): SpendFigures => ({
  spend: { atDate: { CAD: 123456, USD: 90012 }, native: { CAD: 100000, USD: 17000 } },
  priced: { atDate: { CAD: 98000, USD: 71500 }, native: { CAD: 98000 } },
  latestUsdCad: 1.3712,
  unconverted: 0,
  ...over,
});

const market: TripSpendSetting = { primary: "CAD", rateMode: "market", customUsdCad: null };
const custom = (rate: number | null): TripSpendSetting => ({
  primary: "CAD",
  rateMode: "custom",
  customUsdCad: rate,
});

describe("tripSpendView — market rate on each transaction's date", () => {
  it("reads the at-date sums as they are and adds the priced items for the full cost", () => {
    const view = tripSpendView(figures(), market);
    expect(view.paid).toEqual({ CAD: 123456, USD: 90012 });
    expect(view.full).toEqual({ CAD: 221456, USD: 161512 });
    expect(view).toMatchObject({ mode: "market", fallback: null, rate: null, incomplete: false });
  });

  it("does not depend on which currency is printed large", () => {
    const usdFirst = tripSpendView(figures(), { ...market, primary: "USD" });
    expect(usdFirst.paid).toEqual(tripSpendView(figures(), market).paid);
  });

  it("abstains where a rate was missing, and says the conversion is incomplete", () => {
    const view = tripSpendView(
      figures({ spend: { atDate: { CAD: 123456, USD: null }, native: { CAD: 100000 } } }),
      market
    );
    expect(view.paid).toEqual({ CAD: 123456, USD: null });
    expect(view.full).toEqual({ CAD: 221456, USD: null });
    expect(view.incomplete).toBe(true);
  });

  it("leaves the full cost unknown when the priced side is null, never adds a zero", () => {
    const view = tripSpendView(
      figures({ priced: { atDate: { CAD: null, USD: 71500 }, native: {} } }),
      market
    );
    expect(view.full).toEqual({ CAD: null, USD: 161512 });
    expect(view.incomplete).toBe(true);
  });

  it("has no full cost when the priced items were not reported — and that is not a failed conversion", () => {
    const view = tripSpendView(figures({ priced: null }), market);
    expect(view.full).toEqual({ CAD: null, USD: null });
    expect(view.incomplete).toBe(false);
  });

  it("flags transactions the reconciler could not convert even when every total is there", () => {
    expect(tripSpendView(figures({ unconverted: 2 }), market).incomplete).toBe(true);
  });
});

describe("tripSpendView — my rate", () => {
  it("re-converts the CAD and USD parts at the user's rate", () => {
    const view = tripSpendView(figures(), custom(1.35));
    // 1000.00 + 170.00 × 1.35 = 1229.50 CAD; 170.00 + 1000.00 / 1.35 = 910.74 USD
    expect(view.paid).toEqual({ CAD: 122950, USD: 91074 });
    // priced: 980.00 CAD, and 980.00 / 1.35 = 725.93 USD
    expect(view.full).toEqual({ CAD: 122950 + 98000, USD: 91074 + 72593 });
    expect(view).toMatchObject({ mode: "custom", fallback: null, rate: 1.35, incomplete: false });
  });

  it("does not need the at-date sums when everything was paid in CAD and USD", () => {
    const view = tripSpendView(
      figures({ spend: { atDate: { CAD: null, USD: null }, native: { CAD: 100000, USD: 17000 } } }),
      custom(1.35)
    );
    expect(view.paid).toEqual({ CAD: 122950, USD: 91074 });
    expect(view.incomplete).toBe(false);
  });

  it("approximates the other currencies' share from the at-date total and the latest market rate", () => {
    const view = tripSpendView(
      figures({
        spend: {
          atDate: { CAD: 131000, USD: 95500 },
          native: { CAD: 100000, USD: 17000, EUR: 5000 },
        },
      }),
      custom(1.35)
    );
    // CAD: the CAD+USD parts at market 1.3712 are 1000.00 + 233.10 = 1233.10,
    // so the EUR share is 1310.00 − 1233.10 = 76.90; at my rate 1229.50 + 76.90.
    // USD: 170.00 + 729.29 = 899.29 at market, share 955.00 − 899.29 = 55.71.
    expect(view.paid).toEqual({ CAD: 122950 + 7690, USD: 91074 + 5571 });
  });

  it("clamps an other-currency share that the rate drift pushes below zero", () => {
    const view = tripSpendView(
      figures({
        spend: {
          atDate: { CAD: 120000, USD: 85000 },
          native: { CAD: 100000, USD: 17000, EUR: 5000 },
        },
      }),
      custom(1.35)
    );
    expect(view.paid).toEqual({ CAD: 122950, USD: 91074 });
  });

  it("cannot approximate the other currencies when their at-date total is missing", () => {
    const view = tripSpendView(
      figures({
        spend: { atDate: { CAD: 131000, USD: null }, native: { CAD: 100000, EUR: 5000 } },
      }),
      custom(1.35)
    );
    expect(view.paid.USD).toBeNull();
    expect(view.paid.CAD).not.toBeNull();
    expect(view.incomplete).toBe(true);
  });

  it("treats an empty native map under a non-zero total as other currencies, not as nothing", () => {
    const view = tripSpendView(
      figures({ priced: { atDate: { CAD: 98000, USD: 71500 }, native: {} } }),
      custom(1.35)
    );
    // Nothing explains the priced total, so all of it is the at-date share.
    expect(view.full).toEqual({ CAD: 122950 + 98000, USD: 91074 + 71500 });
  });

  it("falls back to market, and says so, when no rate of my own is set", () => {
    const view = tripSpendView(figures(), custom(null));
    expect(view).toMatchObject({ mode: "market", fallback: "noCustomRate", rate: null });
    expect(view.paid).toEqual({ CAD: 123456, USD: 90012 });
  });

  it("falls back to market when the latest market rate is missing and other currencies need it", () => {
    const view = tripSpendView(
      figures({
        latestUsdCad: null,
        spend: {
          atDate: { CAD: 131000, USD: 95500 },
          native: { CAD: 100000, USD: 17000, EUR: 5000 },
        },
      }),
      custom(1.35)
    );
    expect(view).toMatchObject({ mode: "market", fallback: "noLatestRate" });
    expect(view.paid).toEqual({ CAD: 131000, USD: 95500 });
  });

  it("falls back the same way when only the priced side holds another currency", () => {
    const view = tripSpendView(
      figures({
        latestUsdCad: null,
        priced: { atDate: { CAD: 98000, USD: 71500 }, native: { JPY: 10000 } },
      }),
      custom(1.35)
    );
    expect(view.fallback).toBe("noLatestRate");
  });

  it("still uses my rate without a latest market rate when only CAD and USD were paid", () => {
    const view = tripSpendView(figures({ latestUsdCad: null }), custom(1.35));
    expect(view).toMatchObject({ mode: "custom", fallback: null });
    expect(view.paid).toEqual({ CAD: 122950, USD: 91074 });
  });
});

describe("categoryAmount", () => {
  const data = figures();

  it("is the reported CAD figure in market mode with CAD in front", () => {
    expect(categoryAmount(61240, tripSpendView(data, market), data, "CAD")).toBe(61240);
  });

  it("scales with the total it belongs to in the other currency and at my rate", () => {
    // 612.40 of 1234.56 CAD, applied to 900.12 USD
    expect(categoryAmount(61240, tripSpendView(data, market), data, "USD")).toBe(44650);
    const mine = tripSpendView(data, custom(1.35));
    expect(categoryAmount(61240, mine, data, "CAD")).toBe(60989);
    expect(categoryAmount(61240, mine, data, "USD")).toBe(45177);
  });

  it("has no conversion when there is no CAD total to take a share of", () => {
    const noBase = figures({ spend: { atDate: { CAD: null, USD: 90012 }, native: {} } });
    expect(categoryAmount(61240, tripSpendView(noBase, market), noBase, "USD")).toBeNull();
  });
});

describe("settings and input", () => {
  it("reads a synced value back, keeping the currency choice when the rate is unusable", () => {
    expect(
      normalizeTripSpendSetting({ primary: "USD", rateMode: "custom", customUsdCad: 1.4 })
    ).toEqual({ primary: "USD", rateMode: "custom", customUsdCad: 1.4 });
    expect(
      normalizeTripSpendSetting({ primary: "USD", rateMode: "custom", customUsdCad: -1 })
    ).toEqual({ primary: "USD", rateMode: "custom", customUsdCad: null });
    expect(normalizeTripSpendSetting({ primary: "EUR", rateMode: "market" })).toBeNull();
    expect(normalizeTripSpendSetting(["CAD"])).toBeNull();
    expect(DEFAULT_TRIP_SPEND_SETTING).toEqual(market);
  });

  it("parses the typed rate with either decimal separator, and refuses what is not one", () => {
    expect(parseRateInput("1.37")).toBe(1.37);
    expect(parseRateInput(" 1,37 ")).toBe(1.37);
    expect(parseRateInput("")).toBeNull();
    expect(parseRateInput("0")).toBe("invalid");
    expect(parseRateInput("-1.2")).toBe("invalid");
    expect(parseRateInput("1.234,5")).toBe("invalid");
    expect(parseRateInput("abc")).toBe("invalid");
  });

  it("rounds half away from zero and never yields a negative zero", () => {
    expect(roundMinor(2.5)).toBe(3);
    expect(roundMinor(-2.5)).toBe(-3);
    expect(Object.is(roundMinor(-0.2), 0)).toBe(true);
  });
});
