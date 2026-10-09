import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_TRIP_SPEND_SETTING,
  isValidUsdCadRate,
  normalizeTripSpendSetting,
  otherCurrency,
  type RateMode,
  type SpendCurrency,
  type TripSpendSetting,
} from "../lib/tripSpendCurrency";

/**
 * Settings → Trip spending, and the swap button on the trip page's "Paid from
 * your accounts" card: which currency is printed large and which rate puts a
 * foreign amount into the other one.
 *
 * One store for both surfaces, so a change in either re-renders the other at
 * once; it follows the account as the `tripSpend` web preference
 * (`lib/webPrefs/registry.ts`), so the phone shows what the computer chose.
 */
interface TripSpendState extends TripSpendSetting {
  /**
   * The latest market rate a card has read, kept only to prefill the rate
   * field's placeholder. Per device and never synced: it is an observation,
   * not a choice.
   */
  seenMarketUsdCad: number | null;
  setPrimary: (primary: SpendCurrency) => void;
  swapPrimary: () => void;
  setRateMode: (rateMode: RateMode) => void;
  /** Null clears it; anything not above zero is refused (the field says why). */
  setCustomUsdCad: (rate: number | null) => void;
  noteMarketRate: (rate: number | null) => void;
}

export const TRIP_SPEND_STORAGE_KEY = "travstats.tripSpend.v1";

export const useTripSpendStore = create<TripSpendState>()(
  persist(
    (set) => ({
      ...DEFAULT_TRIP_SPEND_SETTING,
      seenMarketUsdCad: null,
      setPrimary: (primary) => set({ primary }),
      swapPrimary: () => set((s) => ({ primary: otherCurrency(s.primary) })),
      setRateMode: (rateMode) => set({ rateMode }),
      setCustomUsdCad: (rate) => {
        if (rate === null || isValidUsdCadRate(rate)) set({ customUsdCad: rate });
      },
      noteMarketRate: (rate) => {
        if (isValidUsdCadRate(rate)) set({ seenMarketUsdCad: rate });
      },
    }),
    {
      name: TRIP_SPEND_STORAGE_KEY,
      partialize: ({ primary, rateMode, customUsdCad, seenMarketUsdCad }) => ({
        primary,
        rateMode,
        customUsdCad,
        seenMarketUsdCad,
      }),
      // A hand-edited or older blob is read back through the same check a
      // synced value passes, rather than trusted into the store.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...current,
          ...(normalizeTripSpendSetting(stored) ?? {}),
          seenMarketUsdCad: isValidUsdCadRate(stored.seenMarketUsdCad)
            ? stored.seenMarketUsdCad
            : null,
        };
      },
    }
  )
);

/**
 * The setting alone, without the per-device observation — what follows the
 * account. A fresh object on every call, so not a hook selector: components
 * select the three fields one by one.
 */
export function selectTripSpendSetting(s: TripSpendSetting): TripSpendSetting {
  return { primary: s.primary, rateMode: s.rateMode, customUsdCad: s.customUsdCad };
}
