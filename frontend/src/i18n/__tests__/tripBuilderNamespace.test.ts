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
