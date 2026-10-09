/**
 * What a trip cost the owner, in Canadian AND US dollars at once — the view
 * math behind the trip page's "Paid from your accounts" card. Pure: no store,
 * no fetch, no clock. The figures come from the host trip-reconciler
 * (`lib/reconcilerNote.ts` reads them), which already summed every
 * transaction; this file only decides how two currencies are shown, so the
 * card can say both without adding amounts the server never added.
 *
 * Every amount here is an integer in MINOR units (cents for CAD and USD).
 * Number, not bigint: the parser refuses anything past
 * `Number.MAX_SAFE_INTEGER`, which is ninety trillion dollars.
 *
 * Two ways to put a foreign amount into the other currency, and the user picks
 * one in Settings → Trip spending:
 *
 * - **market** — each transaction at the market rate of its own date. The
 *   reconciler did that conversion already (`atDate`), so this is a read.
 * - **custom** — the user's own "1 USD = r CAD", the rate a card or a bank
 *   actually charged them. Re-converted here from the per-currency sums.
 */

export const SPEND_CURRENCIES = ["CAD", "USD"] as const;
export type SpendCurrency = (typeof SPEND_CURRENCIES)[number];

export type RateMode = "market" | "custom";

/** The user's choice (synced as the `tripSpend` web preference). */
export interface TripSpendSetting {
  /** Which currency the card prints large. */
  primary: SpendCurrency;
  rateMode: RateMode;
  /** CAD per 1 USD, used in custom mode. Null until the user enters one. */
  customUsdCad: number | null;
}

export const DEFAULT_TRIP_SPEND_SETTING: TripSpendSetting = {
  primary: "CAD",
  rateMode: "market",
  customUsdCad: null,
};

/** A usable rate: a finite number above zero. */
export function isValidUsdCadRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * What the user typed into "1 USD = [x] CAD": a usable rate, `null` for an
 * empty field (no rate), or `"invalid"`. A comma is a decimal separator too —
 * the German keyboard's — and nothing else is guessed at: "1.234,5" is
 * refused rather than read as one of its two possible numbers.
 */
export function parseRateInput(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d*[.,]?\d*$/.test(trimmed)) return "invalid";
  const value = Number(trimmed.replace(",", "."));
  return isValidUsdCadRate(value) ? value : "invalid";
}

/**
 * A stored or synced value read back as a setting; null when it is not one.
 * A rate that is not a usable number reads as "no rate", not as a refusal of
 * the whole setting — the currency choice beside it is still good.
 */
export function normalizeTripSpendSetting(value: unknown): TripSpendSetting | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!SPEND_CURRENCIES.includes(v.primary as SpendCurrency)) return null;
  if (v.rateMode !== "market" && v.rateMode !== "custom") return null;
  return {
    primary: v.primary as SpendCurrency,
    rateMode: v.rateMode,
    customUsdCad: isValidUsdCadRate(v.customUsdCad) ? v.customUsdCad : null,
  };
}

export const otherCurrency = (c: SpendCurrency): SpendCurrency => (c === "CAD" ? "USD" : "CAD");

/** One figure in both currencies. Null is "cannot be derived" — never zero. */
export type CurrencyPair = Record<SpendCurrency, number | null>;

/** A sum as the reconciler reports it: converted per transaction date, and per original currency. */
export interface SpendSums {
  /** The sum with each transaction converted at its own date's market rate. */
  atDate: CurrencyPair;
  /** The sum per ORIGINAL currency, unconverted (`{CAD: …, USD: …, EUR: …}`). */
  native: Record<string, number>;
}

/** Everything the view needs from the reconciler. */
export interface SpendFigures {
  /** Paid from the owner's accounts, excluding what TravStats already prices. */
  spend: SpendSums;
  /** What TravStats prices (flights, bookings, stays); null when not reported. */
  priced: SpendSums | null;
  /** CAD per 1 USD at the latest market quote; null when the reconciler had none. */
  latestUsdCad: number | null;
  /** Transactions the reconciler could not convert at all. */
  unconverted: number;
}

/** Why custom mode was asked for and market figures are shown instead. */
export type RateFallback = "noCustomRate" | "noLatestRate";

export interface TripSpendView {
  paid: CurrencyPair;
  /** `paid` plus `priced`: the whole trip. */
  full: CurrencyPair;
  /** The mode the figures are in — a custom request can fall back to market. */
  mode: RateMode;
  fallback: RateFallback | null;
  /** The CAD-per-USD rate applied in custom mode; null in market mode. */
  rate: number | null;
  /** A figure could not be derived, or the reconciler reported unconverted rows. */
  incomplete: boolean;
}

/** Half away from zero, and never a negative zero (Intl prints "-$0.00" for one). */
export function roundMinor(x: number): number {
  return (x < 0 ? -Math.round(-x) : Math.round(x)) + 0;
}

const add = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a + b;

/**
 * Whether a sum holds money in a currency other than CAD and USD — the part
 * custom mode cannot re-convert itself. A native map that is EMPTY while the
 * converted total is not counts too: then nothing explains the total, and
 * treating it as all-CAD-and-USD would print a zero for real money.
 */
function hasOtherCurrencies(sums: SpendSums): boolean {
  const entries = Object.entries(sums.native);
  if (entries.length === 0) return (sums.atDate.CAD ?? 0) !== 0 || (sums.atDate.USD ?? 0) !== 0;
  return entries.some(([code, amount]) => code !== "CAD" && code !== "USD" && amount !== 0);
}

/**
 * One sum at the user's rate `r` (CAD per USD).
 *
 * The CAD and USD parts are exact: each is kept as paid and the other
 * currency is converted at `r`. The OTHER currencies are not reported
 * separately, so their share is APPROXIMATED, honestly and simply: the
 * at-date total minus the CAD and USD parts converted at the latest market
 * rate `m`, clamped at zero. It is right when CAD/USD barely moved over the
 * trip and drifts with the CAD/USD rate otherwise — the drift lands in the
 * other-currency share, never in the CAD and USD parts. When the sum has no
 * other currency there is nothing to approximate, the share is exactly zero
 * and `m` is not needed at all.
 */
function customSum(sums: SpendSums, r: number, m: number | null): CurrencyPair {
  const cad = sums.native.CAD ?? 0;
  const usd = sums.native.USD ?? 0;
  const own: Record<SpendCurrency, number> = {
    CAD: cad + roundMinor(usd * r),
    USD: usd + roundMinor(cad / r),
  };
  if (!hasOtherCurrencies(sums)) return { CAD: own.CAD, USD: own.USD };
  if (m === null) return { CAD: null, USD: null };
  const atMarket: Record<SpendCurrency, number> = {
    CAD: cad + roundMinor(usd * m),
    USD: usd + roundMinor(cad / m),
  };
  const share = (v: SpendCurrency): number | null => {
    const total = sums.atDate[v];
    return total === null ? null : Math.max(0, total - atMarket[v]);
  };
  return { CAD: add(own.CAD, share("CAD")), USD: add(own.USD, share("USD")) };
}

const needsMarketRate = (figures: SpendFigures): boolean =>
  hasOtherCurrencies(figures.spend) ||
  (figures.priced !== null && hasOtherCurrencies(figures.priced));

function finish(
  paid: CurrencyPair,
  full: CurrencyPair,
  figures: SpendFigures,
  rest: Pick<TripSpendView, "mode" | "fallback" | "rate">
): TripSpendView {
  // A trip whose priced items were not reported has no full cost, which is
  // not a conversion that failed — only a figure that was asked for and
  // could not be derived counts.
  const asked =
    figures.priced === null ? [paid.CAD, paid.USD] : [paid.CAD, paid.USD, full.CAD, full.USD];
  const incomplete = figures.unconverted > 0 || asked.some((v) => v === null);
  return { paid, full, ...rest, incomplete };
}

function marketView(figures: SpendFigures, fallback: RateFallback | null): TripSpendView {
  const paid: CurrencyPair = { ...figures.spend.atDate };
  const priced = figures.priced?.atDate ?? { CAD: null, USD: null };
  const full: CurrencyPair = { CAD: add(paid.CAD, priced.CAD), USD: add(paid.USD, priced.USD) };
  return finish(paid, full, figures, { mode: "market", fallback, rate: null });
}

/**
 * The card's figures for one setting.
 *
 * Custom mode falls back to market, and says why, when the user has not set
 * a rate, or when the latest market rate is missing AND a sum holds other
 * currencies (the approximation above needs it). A trip paid only in CAD and
 * USD converts at the user's rate whether or not a market quote is at hand.
 */
export function tripSpendView(figures: SpendFigures, setting: TripSpendSetting): TripSpendView {
  if (setting.rateMode === "market") return marketView(figures, null);
  const r = setting.customUsdCad;
  if (!isValidUsdCadRate(r)) return marketView(figures, "noCustomRate");
  const m = isValidUsdCadRate(figures.latestUsdCad) ? figures.latestUsdCad : null;
  if (m === null && needsMarketRate(figures)) return marketView(figures, "noLatestRate");

  const paid = customSum(figures.spend, r, m);
  const priced = figures.priced ? customSum(figures.priced, r, m) : { CAD: null, USD: null };
  const full: CurrencyPair = { CAD: add(paid.CAD, priced.CAD), USD: add(paid.USD, priced.USD) };
  return finish(paid, full, figures, { mode: "custom", fallback: null, rate: r });
}

/**
 * A category's CAD amount in `currency`, by the same conversion as the total:
 * its share of the at-date CAD spend, applied to the paid figure the card
 * prints. In market mode with CAD in front that is the amount as reported;
 * otherwise the categories scale with the total, so they still add up to it.
 * Null when there is no base to take a share of.
 */
export function categoryAmount(
  cadMinor: number,
  view: TripSpendView,
  figures: SpendFigures,
  currency: SpendCurrency
): number | null {
  const base = figures.spend.atDate.CAD;
  const target = view.paid[currency];
  if (base === null || base === 0 || target === null) return null;
  return roundMinor((cadMinor * target) / base);
}
