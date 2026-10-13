import { describe, it, expect } from "vitest";
import {
  PHONE_COLUMN_RESERVED,
  PHONE_COLUMN_TOP,
  PHONE_KEY_BOTTOM,
  PHONE_PANEL_BOTTOM,
  PHONE_STRIP_HEIGHT,
  PHONE_STRIP_TOP,
  PHONE_TOP_ROW_BOTTOM,
  phoneBottomOffset,
  phonePanelMaxHeight,
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
 * bottom" case fails; move PHONE_PANEL_BOTTOM down to PHONE_KEY_BOTTOM and
 * the key/panel case fails.
 */
describe("phone chrome bands", () => {
  it("starts the strip's row below the top row's controls", () => {
    expect(PHONE_STRIP_TOP).toBeGreaterThan(PHONE_TOP_ROW_BOTTOM);
  });

  it("leaves a gap between the strip's tallest state and the right column", () => {
    expect(PHONE_COLUMN_TOP).toBeGreaterThanOrEqual(PHONE_STRIP_TOP + PHONE_STRIP_HEIGHT + 8);
  });

  it("keeps the key pill's row above the Domänen button's row", () => {
    // The button is 16px from the bottom edge and ~34px tall; the key pill
    // sits in the row above it rather than on it.
    expect(PHONE_KEY_BOTTOM).toBeGreaterThanOrEqual(16 + 34);
  });

  it("puts the map panel's bottom edge above the key pill's row", () => {
    // 34px of pill + a 8px gap.
    expect(PHONE_PANEL_BOTTOM).toBeGreaterThanOrEqual(PHONE_KEY_BOTTOM + 34 + 8);
  });

  it("stops the panel's height above the right column it would otherwise cover", () => {
    const maxHeight = phonePanelMaxHeight();
    // The measured column top the dashboard writes, with the phone's own
    // column top as the fallback for a map with no next-up card.
    expect(maxHeight).toContain(`var(--ts-map-chrome-top, ${PHONE_COLUMN_TOP}px)`);
    expect(maxHeight).toContain(`${PHONE_COLUMN_RESERVED}px`);
    expect(maxHeight).toContain(`${PHONE_PANEL_BOTTOM}px`);
    expect(maxHeight.startsWith("calc(100vh - ")).toBe(true);
  });

  it("adds the safe-area inset to a phone bottom offset without changing the distance", () => {
    // env() is 0 today (no viewport-fit=cover), so the number is unchanged —
    // the case pins that the inset is ADDED, never substituted for it.
    expect(phoneBottomOffset(100)).toBe("calc(100px + env(safe-area-inset-bottom, 0px))");
  });
});
