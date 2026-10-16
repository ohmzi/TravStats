import { describe, it, expect } from "vitest";
import {
  PHONE_BOTTOM_ROW,
  PHONE_COLUMN_TOP,
  PHONE_KEY_BOTTOM,
  PHONE_PANEL_BOTTOM,
  PHONE_PILL_HEIGHT,
  PHONE_STRIP_HEIGHT,
  PHONE_STRIP_TOP,
  PHONE_TOP_ROW_BOTTOM,
  PHONE_TOP_ROW_TOP,
  phoneBottomOffset,
} from "./phoneChrome";

/**
 * The phone bands, top to bottom. These are the numbers the four collisions
 * of 2026-10-12 came from: every one of them was two overlays sharing a band
 * because each had been placed by corner instead. jsdom has no layout, so
 * what can be pinned here is the ARITHMETIC — the ordering and the gaps —
 * and the components' own suites pin that they actually read these numbers.
 *
 * Deliberate-break protocol: set PHONE_COLUMN_TOP to PHONE_STRIP_TOP (its
 * value before the strip had a row of its own) and the "strip's tallest
 * bottom" case fails; set PHONE_KEY_BOTTOM to PHONE_BOTTOM_ROW and the
 * key/filter case fails.
 */
describe("phone chrome bands", () => {
  it("draws every pill a finger high — the design's minimum hit area", () => {
    // `--ts-size-touch-min`; `.ts-chrome-pill` reads the token on a phone.
    expect(PHONE_PILL_HEIGHT).toBe(44);
  });

  it("starts the strip's row below the top row's pills", () => {
    expect(PHONE_TOP_ROW_BOTTOM).toBe(PHONE_TOP_ROW_TOP + PHONE_PILL_HEIGHT);
    expect(PHONE_STRIP_TOP).toBeGreaterThan(PHONE_TOP_ROW_BOTTOM);
  });

  it("leaves a gap between the strip's tallest state and the right column", () => {
    expect(PHONE_COLUMN_TOP).toBeGreaterThanOrEqual(PHONE_STRIP_TOP + PHONE_STRIP_HEIGHT + 8);
  });

  it("keeps the key pill's row above the Domänen button's row", () => {
    expect(PHONE_KEY_BOTTOM).toBeGreaterThanOrEqual(PHONE_BOTTOM_ROW + PHONE_PILL_HEIGHT + 8);
  });

  it("puts the map panel's pill in the bottom row, opposite the filter", () => {
    // The panel opens as a sheet now, so its pill no longer needs a band of
    // its own above the key — it shares the bottom row with "Domänen".
    expect(PHONE_PANEL_BOTTOM).toBe(PHONE_BOTTOM_ROW);
  });

  it("adds the safe-area inset to a phone bottom offset without changing the distance", () => {
    // env() is 0 today (no viewport-fit=cover), so the number is unchanged —
    // the case pins that the inset is ADDED, never substituted for it.
    expect(phoneBottomOffset(100)).toBe("calc(100px + env(safe-area-inset-bottom, 0px))");
  });
});
