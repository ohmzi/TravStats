import { describe, expect, it } from "vitest";
import i18n from "../config";

describe("the tripBuilder namespace", () => {
  it("resolves in both languages, so no screen shows a raw key", () => {
    expect(i18n.getFixedT("en", "tripBuilder")("timeline.open")).toBe("Open roadtrip");
    expect(i18n.getFixedT("de", "tripBuilder")("timeline.open")).toBe("Roadtrip öffnen");
  });

  it("is among the namespaces i18next loads", () => {
    expect([i18n.options.ns].flat()).toContain("tripBuilder");
  });
});

/**
 * The synced pitstop's counts line inflects on the number its noun belongs to
 * (final review, finding Q3-7): i18next picks `_one`/`_other` from `count`, the
 * noun modifies the synced count, and the "now" count travels as its own
 * `now` param — so both numbers read true whichever of the two is 1. The
 * string was copied from the stopover card's, which keys the plural on the
 * wrong number; that older string is left as it was.
 */
describe("the synced pitstop's counts line", () => {
  it.each(["en", "de"] as const)(
    "%s: the noun follows the synced count, not the current one",
    (lng) => {
      const t = i18n.getFixedT(lng, "tripBuilder");
      expect(t("review.area.syncedCounts", { count: 18, now: 1 })).toBe(
        lng === "en" ? "18 photos when it was synced · 1 now" : "18 Fotos beim Abgleich · 1 jetzt"
      );
      expect(t("review.area.syncedCounts", { count: 1, now: 20 })).toBe(
        lng === "en" ? "1 photo when it was synced · 20 now" : "1 Foto beim Abgleich · 20 jetzt"
      );
    }
  );
});

/**
 * The popup tells the person where to go ("Settings › Services", "Settings ›
 * Modules"). A path that names a page Settings does not have sends them to a
 * dead end, which is what "Settings › Beta" did: the beta gate is an admin
 * switch, and the only user-side toggle for roadtrips is the Roadtrips row
 * under Modules. So each path is built from the label Settings itself shows.
 */
describe("the Settings paths in the popup's notes", () => {
  it.each(["en", "de"] as const)(
    "%s: the roadtrips note names the section that holds the Roadtrips switch",
    (lng) => {
      const modules = i18n.getFixedT(lng, "common")("settings.modules.title");
      const note = i18n.getFixedT(lng, "tripBuilder")("popup.roadtripsOff");
      expect(note).toContain(`› ${modules}`);
      expect(note).not.toMatch(/Beta/i);
    }
  );

  it.each(["en", "de"] as const)("%s: the not-connected banner names the Services group", (lng) => {
    const services = i18n.getFixedT(lng, "settings")("groups.services");
    const banner = i18n.getFixedT(lng, "tripBuilder")("popup.unpaired.banner");
    expect(banner).toContain(`› ${services}`);
  });
});
