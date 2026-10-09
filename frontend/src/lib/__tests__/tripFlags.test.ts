import { describe, it, expect } from "vitest";
import { BANNER_FLAG_CAP, bannerFlags, flagAssetUrl, knownCountries } from "../tripFlags";

/**
 * The band's rule, on its own: which of a trip's countries paints a flag.
 *
 * Every case the fallback table names is here, because the pilot is judged on
 * the two cards it ships AND on the mechanism behind them being general — an
 * unbundled country must drop out by the same rule that draws a bundled one,
 * never by a special case.
 */
describe("bannerFlags — the flag rule every journey obeys", () => {
  it("draws nothing for a trip that records no countries", () => {
    expect(bannerFlags([])).toEqual([]);
  });

  it("draws the one bundled flag a single-country trip holds", () => {
    expect(bannerFlags(["CA"])).toEqual([{ cc: "CA", url: "/flags/ca.svg" }]);
    expect(bannerFlags(["PK"])).toEqual([{ cc: "PK", url: "/flags/pk.svg" }]);
  });

  it("draws both pilot flags, in the order the trip records them", () => {
    expect(bannerFlags(["CA", "PK"]).map((f) => f.cc)).toEqual(["CA", "PK"]);
    // Order is positional (which flag reads as more prominent), never a route,
    // so reversing the input reverses the band and nothing else.
    expect(bannerFlags(["PK", "CA"]).map((f) => f.cc)).toEqual(["PK", "CA"]);
  });

  it("resolves a country NAME to its code, in the language the field holds", () => {
    expect(bannerFlags(["Canada"]).map((f) => f.cc)).toEqual(["CA"]);
    expect(bannerFlags(["Pakistan"]).map((f) => f.cc)).toEqual(["PK"]);
    expect(bannerFlags(["Kanada"]).map((f) => f.cc)).toEqual(["CA"]);
  });

  it("collapses a duplicate country", () => {
    expect(bannerFlags(["CA", "CA"])).toEqual([{ cc: "CA", url: "/flags/ca.svg" }]);
  });

  it("drops an entry that names no country — 'null' is not one", () => {
    expect(bannerFlags(["null", "", "undefined", "Fohnsdorf"])).toEqual([]);
  });

  // The pinned missing-asset rule: a country that resolves but has no bundled
  // asset is DROPPED, and the drawable flags on either side of it are kept, in
  // their order. This is the drop-by-rule the pilot stands on.
  it("keeps the drawable flags and drops the unbundled one between them", () => {
    expect(bannerFlags(["CA", "FR", "PK"]).map((f) => f.cc)).toEqual(["CA", "PK"]);
  });

  it("draws nothing when no recorded country has a bundled flag", () => {
    expect(bannerFlags(["FR"])).toEqual([]);
    expect(bannerFlags(["FR", "ES", "IT"])).toEqual([]);
  });

  // The pilot's mixed shape: five recorded countries, only two bundled. The
  // band draws the two it can and the card keeps the true count — the pilot
  // working as intended rather than a guess about the other three.
  it("draws only the bundled subset of a many-country trip", () => {
    expect(bannerFlags(["CA", "PK", "FR", "ES", "IT"]).map((f) => f.cc)).toEqual(["CA", "PK"]);
  });

  it("caps the band at BANNER_FLAG_CAP, so four flags cannot muddy into one", () => {
    // The pilot bundles two flags, so the cap is exercised against a wider
    // allow-list — the same code path production runs, given more assets.
    const allow = {
      CA: "/flags/ca.svg",
      PK: "/flags/pk.svg",
      FR: "/flags/fr.svg",
      ES: "/flags/es.svg",
    };
    expect(bannerFlags(["CA", "PK", "FR", "ES"], allow)).toHaveLength(BANNER_FLAG_CAP);
    expect(bannerFlags(["CA", "PK", "FR", "ES"], allow).map((f) => f.cc)).toEqual([
      "CA",
      "PK",
      "FR",
    ]);
  });
});

describe("knownCountries — the true country set the band counts against", () => {
  it("resolves, dedupes and keeps order", () => {
    expect(knownCountries(["Canada", "CA", "FR", "Pakistan"])).toEqual(["CA", "FR", "PK"]);
  });

  it("counts nothing for entries that name no country", () => {
    expect(knownCountries(["null", "Fohnsdorf"])).toEqual([]);
  });
});

describe("flagAssetUrl", () => {
  it("answers only for the two bundled flags", () => {
    expect(flagAssetUrl("ca")).toBe("/flags/ca.svg");
    expect(flagAssetUrl("PK")).toBe("/flags/pk.svg");
    expect(flagAssetUrl("FR")).toBeNull();
  });
});
