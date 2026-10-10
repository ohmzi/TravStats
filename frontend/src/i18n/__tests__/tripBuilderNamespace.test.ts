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
