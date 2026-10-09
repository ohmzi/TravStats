import { describe, it, expect } from "vitest";
import { bannerFlags, flagAssetUrl, knownCountries } from "../tripFlags";

/**
 * The band's rule, on its own: which of a trip's countries paints a flag.
 *
 * Every case the fallback table names is here, because the band is judged on
 * the mechanism being general — an unbundled or unplaceable country must drop
 * out by the same rule that draws a bundled one, never by a special case. The
 * fixtures are synthetic codes only; no trip from anyone's data is named.
 */
describe("bannerFlags — the flag rule every journey obeys", () => {
  it("draws nothing for a trip that records no countries", () => {
    expect(bannerFlags([])).toEqual([]);
  });

  it("draws the flag a single-country trip holds", () => {
    expect(bannerFlags(["CA"])).toEqual([{ cc: "CA", url: "/flags/ca.svg" }]);
    expect(bannerFlags(["PK"])).toEqual([{ cc: "PK", url: "/flags/pk.svg" }]);
  });

  it("draws the flags in the order the trip records them", () => {
    expect(bannerFlags(["CA", "PK"]).map((f) => f.cc)).toEqual(["CA", "PK"]);
    // Order is positional (which flag reads as more prominent), never a route,
    // so reversing the input reverses the band and nothing else.
    expect(bannerFlags(["PK", "CA"]).map((f) => f.cc)).toEqual(["PK", "CA"]);
  });

  it("resolves a country NAME to its code, in the language the field holds", () => {
    expect(bannerFlags(["Canada"]).map((f) => f.cc)).toEqual(["CA"]);
    expect(bannerFlags(["Pakistan"]).map((f) => f.cc)).toEqual(["PK"]);
    expect(bannerFlags(["Kanada"]).map((f) => f.cc)).toEqual(["CA"]);
    // German names too: the app is bilingual and the field arrives in either.
    expect(bannerFlags(["Vereinigte Arabische Emirate"]).map((f) => f.cc)).toEqual(["AE"]);
  });

  it("collapses a duplicate country", () => {
    expect(bannerFlags(["CA", "CA"])).toEqual([{ cc: "CA", url: "/flags/ca.svg" }]);
  });

  it("drops an entry that names no country — 'null' is not one", () => {
    expect(bannerFlags(["null", "", "undefined", "Fohnsdorf"])).toEqual([]);
  });

  // The owner's five-country shape, pinned without naming his trip: every one
  // of the five has an asset in the app's domain, so all five draw, in order.
  it("draws all five flags of a five-country trip", () => {
    expect(bannerFlags(["CA", "PK", "AE", "OM", "TR"]).map((f) => f.cc)).toEqual([
      "CA",
      "PK",
      "AE",
      "OM",
      "TR",
    ]);
  });

  // The pinned missing-asset rule: a code that resolves but is OUTSIDE the
  // app's country domain has no asset, is DROPPED, and the drawable flags on
  // either side of it are kept, in their order.
  it("keeps the drawable flags and drops the out-of-domain one between them", () => {
    expect(bannerFlags(["CA", "XX", "PK"]).map((f) => f.cc)).toEqual(["CA", "PK"]);
  });

  it("draws nothing when no recorded country is in the app's domain", () => {
    expect(bannerFlags(["XX"])).toEqual([]);
    expect(bannerFlags(["XX", "ZZ"])).toEqual([]);
  });

  // No silent cap: the band draws every drawable country, whatever the count.
  it("draws every country of a wide trip, with no cap", () => {
    expect(bannerFlags(["CA", "PK", "AE", "OM"])).toHaveLength(4);
    expect(bannerFlags(["CA", "PK", "AE", "OM", "TR"])).toHaveLength(5);
    expect(bannerFlags(["CA", "PK", "AE", "OM", "TR", "DE"])).toHaveLength(6);
    expect(
      bannerFlags(["CA", "PK", "AE", "OM", "TR", "DE", "FR", "ES"])
    ).toHaveLength(8);
  });

  // The `allow` seam exists so the drop rule can be pinned against a narrow
  // set without depending on which countries the app happens to bundle.
  it("drops a country the (test-injected) allow-list does not carry", () => {
    const allow = { CA: "/flags/ca.svg" };
    expect(bannerFlags(["CA", "PK"], allow).map((f) => f.cc)).toEqual(["CA"]);
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
  it("answers for every code in the app's country domain", () => {
    expect(flagAssetUrl("ca")).toBe("/flags/ca.svg");
    expect(flagAssetUrl("PK")).toBe("/flags/pk.svg");
    expect(flagAssetUrl("AE")).toBe("/flags/ae.svg");
    expect(flagAssetUrl("OM")).toBe("/flags/om.svg");
    expect(flagAssetUrl("TR")).toBe("/flags/tr.svg");
  });

  it("answers nothing for a code outside the domain — never a stand-in", () => {
    expect(flagAssetUrl("XX")).toBeNull();
    expect(flagAssetUrl("ZZ")).toBeNull();
    expect(flagAssetUrl("")).toBeNull();
  });
});
