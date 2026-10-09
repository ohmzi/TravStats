import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The trip-spend choice as this device keeps it. The store reads storage once
 * at import, so each case imports a fresh copy.
 */
async function fresh() {
  vi.resetModules();
  return (await import("../tripSpendStore")).useTripSpendStore;
}

describe("tripSpendStore", () => {
  afterEach(() => window.localStorage.clear());

  it("starts at CAD and the market rate", async () => {
    const store = await fresh();
    expect(store.getState()).toMatchObject({
      primary: "CAD",
      rateMode: "market",
      customUsdCad: null,
      seenMarketUsdCad: null,
    });
  });

  it("reads a stored choice back through the same check a synced one passes", async () => {
    window.localStorage.setItem(
      "travstats.tripSpend.v1",
      JSON.stringify({
        state: { primary: "USD", rateMode: "custom", customUsdCad: 0, seenMarketUsdCad: "1.3" },
        version: 0,
      })
    );
    const store = await fresh();
    expect(store.getState()).toMatchObject({
      primary: "USD",
      rateMode: "custom",
      customUsdCad: null,
      seenMarketUsdCad: null,
    });
  });

  it("ignores a stored blob that is not a choice at all", async () => {
    window.localStorage.setItem(
      "travstats.tripSpend.v1",
      JSON.stringify({ state: { primary: "EUR" }, version: 0 })
    );
    const store = await fresh();
    expect(store.getState().primary).toBe("CAD");
  });

  it("refuses a rate that is not above zero and swaps the primary currency", async () => {
    const store = await fresh();
    store.getState().setCustomUsdCad(1.35);
    store.getState().setCustomUsdCad(0);
    store.getState().setCustomUsdCad(Number.NaN);
    expect(store.getState().customUsdCad).toBe(1.35);
    store.getState().setCustomUsdCad(null);
    expect(store.getState().customUsdCad).toBeNull();

    store.getState().swapPrimary();
    expect(store.getState().primary).toBe("USD");
    store.getState().swapPrimary();
    expect(store.getState().primary).toBe("CAD");
  });
});
