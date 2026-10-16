import { describe, it, expect } from "vitest";
import { PHONE_MAX_WIDTH_PX, initialLegendOpen } from "../legendInitialState";

/**
 * At 390×844 the map key opened by default and covered the pinned card's
 * action button — the one control the card exists to offer (browser
 * verification, beta.12). On a desktop it has room and the reader wants it.
 *
 * So the DEFAULT is width-dependent and the CHOICE is not: someone who opens
 * the key on a desktop means it, and having it close again on the next
 * navigation is the same annoyance one page later (the reason it is
 * remembered at all).
 *
 * A phone is the exception since the key opens there as a modal sheet
 * (owner, 2026-10-16): a sheet already up on load hides the map behind a scrim.
 */
describe("whether the map key starts open", () => {
  it("opens on a desktop, where it has room", () => {
    expect(initialLegendOpen(null, false)).toBe(true);
  });

  it("stays closed on a phone, where it covers the card's own button", () => {
    expect(initialLegendOpen(null, true)).toBe(false);
  });

  it("never starts a phone with the key's sheet up, whatever was remembered", () => {
    // Deliberate break: drop the `isPhone` guard in initialLegendOpen and this fails.
    expect(initialLegendOpen("true", true)).toBe(false);
  });

  it("respects a reader who closed it on a desktop", () => {
    expect(initialLegendOpen("false", false)).toBe(false);
  });

  it("uses the breakpoint the rest of the design system uses", () => {
    // Every other phone rule in this tree is `max-width: 639px`.
    expect(PHONE_MAX_WIDTH_PX).toBe(639);
  });
});
