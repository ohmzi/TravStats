import { describe, it, expect } from "vitest";
import { formatLoggedKm } from "../tripInsights";

/**
 * The journeys page's "Total logged km" tile value. The figure is the server's
 * (uncapped, every flight/cruise/roadtrip km); this only formats it, and it
 * must read in the reader's locale like the `longest` tile beside it.
 */
describe("formatLoggedKm", () => {
  it("formats whole kilometres in the English locale", () => {
    expect(formatLoggedKm(24727, "en")).toBe("24,727 km");
  });

  it("formats whole kilometres in the German locale", () => {
    expect(formatLoggedKm(24727, "de")).toBe("24.727 km");
  });

  it("rounds to whole kilometres", () => {
    expect(formatLoggedKm(24123.6, "en")).toBe("24,124 km");
  });
});
