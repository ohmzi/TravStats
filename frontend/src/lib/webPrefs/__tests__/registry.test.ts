import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real sections of `registry.ts` (forgejo#200) over jsdom's localStorage
 * and the real stores: what is read, what applying a server value changes,
 * and what is kept per device.
 *
 * Stores read storage once at import, so each case imports a fresh copy.
 */
async function fresh() {
  vi.resetModules();
  const registry = await import("../registry");
  const { useFlightColorStore } = await import("../../../store/flightColorStore");
  const { useOverlayAppearanceStore } = await import("../../../store/overlayAppearanceStore");
  const { useDashboardDomainFilterStore } =
    await import("../../../store/dashboardDomainFilterStore");
  const { useWebPrefsEpochStore } = await import("../prefEvents");
  const { saveMapAppearance } = await import("../../../components/map/mapAppearance");
  const section = (name: string) => registry.WEB_PREF_SECTIONS.find((s) => s.name === name)!;
  return {
    section,
    useFlightColorStore,
    useOverlayAppearanceStore,
    useDashboardDomainFilterStore,
    useWebPrefsEpochStore,
    saveMapAppearance,
  };
}

const stored = (key: string) => JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown;

describe("web prefs registry", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("names exactly the sections the server knows", async () => {
    const { section } = await fresh();
    const names = [
      "mapAppearance",
      "globeChrome",
      "domainColors",
      "dashboardHiddenDomains",
      "theme",
      "statsCompare",
      "statsHiddenSections",
      "tablePrefs",
      "tripSpend",
    ];
    for (const name of names) expect(section(name)).toBeDefined();
    const { WEB_PREF_SECTIONS } = await import("../registry");
    expect(WEB_PREF_SECTIONS.map((s) => s.name).sort()).toEqual([...names].sort());
  });

  describe("mapAppearance", () => {
    it("leaves the control-panel chrome out of what follows the user", async () => {
      window.localStorage.setItem(
        "mapAppearance.v2",
        JSON.stringify({ styleId: "satellite", panelExpanded: true, panelSections: { a: true } })
      );
      const { section } = await fresh();
      expect(section("mapAppearance").read()).toEqual({ styleId: "satellite" });
    });

    it("applies a server value to the colour and overlay stores and keeps this device's chrome", async () => {
      window.localStorage.setItem(
        "mapAppearance.v2",
        JSON.stringify({ styleId: "dark", panelExpanded: false, lodgingListOpen: false })
      );
      const { section, useFlightColorStore, useOverlayAppearanceStore, useWebPrefsEpochStore } =
        await fresh();

      section("mapAppearance").apply({
        flightColorMode: "solid",
        flightColors: { solid: [1, 2, 3] },
        railLineWidth: 2,
        styleId: "satellite",
        panelExpanded: true, // another device's chrome — must not land here
      });

      expect(useFlightColorStore.getState().config.mode).toBe("solid");
      expect(useFlightColorStore.getState().config.colors.solid).toEqual([1, 2, 3]);
      expect(useOverlayAppearanceStore.getState().appearance.railLineWidth).toBe(2);
      expect(stored("mapAppearance.v2")).toMatchObject({
        styleId: "satellite",
        panelExpanded: false,
        lodgingListOpen: false,
      });
      expect(useWebPrefsEpochStore.getState().epochs.mapAppearance).toBe(1);
    });

    it("reads what a map writes on mount as a default, and a real choice as not", async () => {
      const { section } = await fresh();
      const mapAppearance = section("mapAppearance");
      expect(
        mapAppearance.isDefault({ styleId: "dark", flightRouteWidth: 1, airportColor: null })
      ).toBe(true);
      expect(mapAppearance.isDefault({ styleId: "satellite" })).toBe(false);
      expect(mapAppearance.isDefault({ flightColorMode: "solid" })).toBe(false);
    });

    it("hears a write through saveMapAppearance", async () => {
      const { section, saveMapAppearance } = await fresh();
      const onChange = vi.fn();
      const unsubscribe = section("mapAppearance").subscribe(onChange);
      saveMapAppearance({ styleId: "light" });
      expect(onChange).toHaveBeenCalledTimes(1);
      unsubscribe();
      saveMapAppearance({ styleId: "dark" });
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  it("dashboardHiddenDomains applies to the filter store and its storage key", async () => {
    const { section, useDashboardDomainFilterStore } = await fresh();
    section("dashboardHiddenDomains").apply(["cruise", "not-a-domain"]);
    expect([...useDashboardDomainFilterStore.getState().hidden]).toEqual(["cruise"]);
    expect(stored("travstats.dashboard.hiddenDomains.v1")).toEqual(["cruise"]);
    expect(section("dashboardHiddenDomains").read()).toEqual(["cruise"]);
  });

  it("statsHiddenSections reads only chosen lists and replaces the family on apply", async () => {
    window.localStorage.setItem("stats.hiddenSections.flights", JSON.stringify(["costs"]));
    window.localStorage.setItem("stats.hiddenSections.cruises", JSON.stringify([]));
    window.localStorage.setItem("stats.hiddenSections.lodging", JSON.stringify(["ratings"]));
    const { section } = await fresh();
    const s = section("statsHiddenSections");
    expect(s.read()).toEqual({ flights: ["costs"], lodging: ["ratings"] });

    s.apply({ flights: ["seats"] });
    expect(stored("stats.hiddenSections.flights")).toEqual(["seats"]);
    expect(window.localStorage.getItem("stats.hiddenSections.lodging")).toBeNull();
  });

  it("tablePrefs carries columns and sort, never the page size", async () => {
    window.localStorage.setItem("travstats:table-hidden-columns:flights", JSON.stringify(["seat"]));
    window.localStorage.setItem(
      "travstats:table-sort:flights",
      JSON.stringify({ by: "date", order: "asc" })
    );
    window.localStorage.setItem("travstats:table-page-size:flights", "100");
    const { section } = await fresh();
    const s = section("tablePrefs");
    expect(s.read()).toEqual({
      hiddenColumns: { flights: ["seat"] },
      sort: { flights: { by: "date", order: "asc" } },
    });

    s.apply({ hiddenColumns: {}, sort: { lodging: { by: "name", order: "desc" } } });
    expect(window.localStorage.getItem("travstats:table-hidden-columns:flights")).toBeNull();
    expect(window.localStorage.getItem("travstats:table-sort:flights")).toBeNull();
    expect(stored("travstats:table-sort:lodging")).toEqual({ by: "name", order: "desc" });
    expect(window.localStorage.getItem("travstats:table-page-size:flights")).toBe("100");
  });

  describe("tripSpend", () => {
    it("follows the account with the three choices, and keeps the seen market rate on the device", async () => {
      const { section } = await fresh();
      const { useTripSpendStore } = await import("../../../store/tripSpendStore");
      useTripSpendStore.setState({
        primary: "USD",
        rateMode: "custom",
        customUsdCad: 1.35,
        seenMarketUsdCad: 1.3712,
      });
      expect(section("tripSpend").read()).toEqual({
        primary: "USD",
        rateMode: "custom",
        customUsdCad: 1.35,
      });

      section("tripSpend").apply({ primary: "CAD", rateMode: "market", customUsdCad: 1.4 });
      expect(useTripSpendStore.getState()).toMatchObject({
        primary: "CAD",
        rateMode: "market",
        customUsdCad: 1.4,
        seenMarketUsdCad: 1.3712,
      });
      expect(stored("travstats.tripSpend.v1")).toMatchObject({
        state: { primary: "CAD", rateMode: "market", customUsdCad: 1.4 },
      });
    });

    it("ignores a value this version cannot read, and calls only the defaults default", async () => {
      const { section } = await fresh();
      const { useTripSpendStore } = await import("../../../store/tripSpendStore");
      section("tripSpend").apply({ primary: "EUR", rateMode: "market" });
      expect(useTripSpendStore.getState().primary).toBe("CAD");

      const s = section("tripSpend");
      expect(s.isDefault({ primary: "CAD", rateMode: "market", customUsdCad: null })).toBe(true);
      expect(s.isDefault({ primary: "USD", rateMode: "market", customUsdCad: null })).toBe(false);
      expect(s.isDefault({ primary: "CAD", rateMode: "market", customUsdCad: 1.3 })).toBe(false);
    });

    it("hears a choice but not the card noting a market rate", async () => {
      const { section } = await fresh();
      const { useTripSpendStore } = await import("../../../store/tripSpendStore");
      const onChange = vi.fn();
      const unsubscribe = section("tripSpend").subscribe(onChange);
      useTripSpendStore.getState().noteMarketRate(1.37);
      expect(onChange).not.toHaveBeenCalled();
      useTripSpendStore.getState().swapPrimary();
      expect(onChange).toHaveBeenCalledTimes(1);
      unsubscribe();
    });
  });

  it("theme ignores a map theme this version does not know", async () => {
    const { section } = await fresh();
    section("theme").apply({ mapTheme: "neon" });
    expect(section("theme").read()).toEqual({ mapTheme: "glassmorphism" });
    section("theme").apply({ mapTheme: "classic" });
    expect(section("theme").read()).toEqual({ mapTheme: "classic" });
  });
});
