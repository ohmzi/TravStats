import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * The band, rendered: the flag(s) a trip's countries earn, and the legibility
 * rule that has to hold under them.
 *
 * jsdom paints nothing and lays nothing out, so the pixel part of legibility is
 * a MODEL over the component's own stops (below), not a reading of the render.
 * What the DOM assertions can prove — which flags paint, that an unbundled
 * country paints nothing — they prove directly.
 */
const settings = vi.hoisted(() => ({
  value: {
    features: { enableCostTracking: false },
    enabledDomains: ["flight", "rail", "rental", "roadtrip"],
  },
}));
vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(settings.value) : settings.value,
}));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => true }),
}));
vi.mock("../../../hooks/useRailVisible", () => ({ useRailVisible: () => true }));
vi.mock("../../../hooks/useRentalVisible", () => ({ useRentalVisible: () => true }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => {
      if (!o) return k;
      if (typeof o.count === "number") return `${k}/${o.count}`;
      return Object.entries(o).reduce((s, [key, val]) => s.replace(`{{${key}}}`, String(val)), k);
    },
    i18n: { language: "de" },
  }),
}));

import TripCard from "../TripCard";
import {
  BAND_MASK_MID,
  SCRIM_BASE,
  SCRIM_OVER_PILL,
  SPECTRUM_MASK,
  ribbonMask,
} from "../TripBandFlags";

const TRIP_COLOR = "#3b82f6";

const trip = (countries: string[]): Trip =>
  ({
    id: "t1",
    name: "QA Herbstreise",
    status: "planned",
    countries,
    bookings: [],
    flights: [],
    cruises: [],
    tags: [],
    category: null,
    color: TRIP_COLOR,
    coverImageUrl: null,
    destinationLabel: null,
    startDate: null,
    endDate: null,
    _count: { flights: 0, cruises: 0, lodgingStays: 0, routes: 0, photos: 0 },
  }) as unknown as Trip;

function renderCard(countries: string[]): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <TripCard trip={trip(countries)} onOpen={() => {}} />
    </MemoryRouter>
  );
  return container;
}

const flagLayers = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("[data-flag]"),
];

/**
 * The solid body of a ribbon mask: the two stops at FULL opacity, in order.
 * A degenerate body (from === to, or no such stops) means the ribbon never
 * stays opaque across any width — the exact failure the pilot's growing
 * feather hit at five flags.
 */
function solidBody(mask: string): { from: number; to: number } {
  const stops = [...mask.matchAll(/rgba\(0, 0, 0, 1\) ([\d.]+)%/g)].map((m) => Number(m[1]));
  return { from: stops[0] ?? NaN, to: stops[stops.length - 1] ?? NaN };
}

describe("TripCard band flags", () => {
  it("paints the flag a single-country trip earned", () => {
    const layers = flagLayers(renderCard(["CA"]));
    expect(layers).toHaveLength(1);
    expect(layers[0].getAttribute("data-flag")).toBe("CA");
    expect(layers[0].style.backgroundImage).toContain("/flags/ca.svg");
  });

  it("paints Pakistan's flag for a PK trip", () => {
    const layers = flagLayers(renderCard(["PK"]));
    expect(layers[0].style.backgroundImage).toContain("/flags/pk.svg");
  });

  // The pinned no-asset rule, at the component level: a country with no asset
  // paints NOTHING, and the band keeps the trip's own colour gradient. `XX` is
  // a two-letter code outside the app's country domain, so it never resolves to
  // a shipped flag — the fallback path, not a bundled country.
  it("paints no flag for an out-of-domain country and keeps the trip colour", () => {
    const container = renderCard(["XX"]);
    expect(flagLayers(container)).toHaveLength(0);
    const band = container.querySelector<HTMLElement>("[data-testid='trip-band']");
    expect(band?.getAttribute("style")).toContain(TRIP_COLOR);
    expect(band?.getAttribute("style")).toContain("var(--ts-surface2)");
  });

  // The invariant grafted from the losing design: one painted layer per
  // drawable country, and nothing drawn for the country that has no asset.
  it("paints exactly the drawable countries of a mixed trip", () => {
    const layers = flagLayers(renderCard(["CA", "XX", "PK"]));
    expect(layers.map((l) => l.getAttribute("data-flag"))).toEqual(["CA", "PK"]);
  });

  // The owner's five-country shape, pinned without naming his trip: all five
  // draw, in order — the band drops nothing to hit a number.
  it("paints all five flags of a five-country trip, in order", () => {
    const layers = flagLayers(renderCard(["CA", "PK", "AE", "OM", "TR"]));
    expect(layers.map((l) => l.getAttribute("data-flag"))).toEqual([
      "CA",
      "PK",
      "AE",
      "OM",
      "TR",
    ]);
  });

  it("paints nothing when the trip records no countries", () => {
    const container = renderCard([]);
    expect(flagLayers(container)).toHaveLength(0);
    expect(container.querySelector("[data-testid='trip-band-scrim']")).toBeNull();
  });

  it("says so on the band when some countries were left out", () => {
    const container = renderCard(["CA", "XX"]);
    const band = container.querySelector<HTMLElement>("[data-testid='trip-band']");
    expect(band?.getAttribute("title")).toBe("trips:card.flagsPartial");
  });

  it("stays silent when every country it records is drawn", () => {
    const container = renderCard(["CA", "PK"]);
    const band = container.querySelector<HTMLElement>("[data-testid='trip-band']");
    expect(band?.getAttribute("title")).toBeNull();
  });

  it("carries the scrim layer that protects the status pill", () => {
    const container = renderCard(["CA"]);
    expect(container.querySelector("[data-testid='trip-band-scrim']")).not.toBeNull();
  });

  it("feathers the seam when two flags overlap, and not when there is one", () => {
    // A single flag is a full-band wash; two are ribbons with feathered seams.
    expect(ribbonMask(0, 2)).toContain("linear-gradient(135deg");
    expect(ribbonMask(0, 2)).not.toEqual(ribbonMask(1, 2));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The seam regime. The one-to-three-flag pilot must not move; from four flags
// the seam is small and fixed, so every ribbon keeps a solid body. The old
// growing feather (`min(seg*0.5, 10)`) collapsed to a zero-width body at five
// flags — this is the property that forced the count-keyed rule.
describe("ribbon seam regime", () => {
  it("keeps the pilot's seam for one to three flags", () => {
    // Two flags: seg 50, feather 10, so the first ribbon reads opaque to 40%.
    expect(ribbonMask(0, 2)).toContain("rgba(0, 0, 0, 1) 40%");
  });

  it("gives every interior ribbon a real solid body at four, five, six and eight", () => {
    for (const count of [4, 5, 6, 8]) {
      for (let index = 0; index < count; index += 1) {
        const { from, to } = solidBody(ribbonMask(index, count));
        expect(Number.isFinite(from) && Number.isFinite(to), `${index}/${count} has stops`).toBe(
          true
        );
        expect(to, `ribbon ${index} of ${count} is never fully washed`).toBeGreaterThan(from);
      }
    }
  });

  it("would have no solid body at five flags under the pilot's old feather", () => {
    // The degenerate case the change removes, stated so it cannot creep back.
    const seg = 100 / 5;
    const oldFeather = Math.min(seg * 0.5, 10);
    const body = seg - 2 * oldFeather;
    expect(body).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The legibility model. jsdom cannot read rendered pixels, so this recomputes
// the composited band from the component's OWN stop constants — the numbers
// the browser will paint — rather than asserting a pass nothing measured.
// Compositing is sRGB, the CSS default; `--ts-surface2` is the band's dark end.
const SURFACE2 = "#101317";
const WHITE = "#ffffff";
/** The only two status tones a TripCard can show: planned→scheduled, else flown. */
const TRIP_PILL_COLOURS = { scheduled: "#6fa0d6", flown: "#5ec2b2" };

const channels = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (rgb: number[]): number =>
  0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
const over = (top: number[], alpha: number, bottom: number[]): number[] =>
  top.map((c, i) => alpha * c + (1 - alpha) * bottom[i]);
const contrast = (a: number[], b: number[]): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("band legibility", () => {
  it("lands on --ts-surface2 at the dark end whatever flag is painted", () => {
    // The spectrum mask ends at alpha 0, so the dark corner is the base for a
    // white flag and a dark one alike — the invariant the whole band rests on.
    expect(SPECTRUM_MASK).toContain("rgba(0, 0, 0, 0) 100%");
    const white = over(channels(WHITE), 0, channels(SURFACE2));
    const green = over(channels("#0c590b"), 0, channels(SURFACE2));
    expect(white).toEqual(channels(SURFACE2));
    expect(green).toEqual(channels(SURFACE2));
  });

  it("keeps the status pill readable over a mostly-white flag", () => {
    // Worst case: a pure-white flag under the pill. The pill sits past the
    // light corner along the 135deg axis, so its flag alpha is mid-spectrum;
    // BAND_MASK_MID is used as a conservative stand-in for that position, and
    // the scrim is at its peak where the pill sits.
    const flag = over(channels(WHITE), BAND_MASK_MID, channels(SURFACE2));
    const band = over(channels(SURFACE2), SCRIM_OVER_PILL, flag);
    for (const [name, hex] of Object.entries(TRIP_PILL_COLOURS)) {
      const pillText = channels(hex);
      const pillBg = over(pillText, 0.12, band); // the pill's 12% fill over the band
      expect(contrast(pillText, pillBg), `${name} pill over a white flag`).toBeGreaterThanOrEqual(
        4.5
      );
    }
  });

  it("keeps the status pill readable with five ribbons under it", () => {
    // At five flags more ribbons pass beneath the pill, so the model is re-run
    // at count 5. A flag's alpha under the pill is ribbonAlpha * spectrumAlpha,
    // and the ribbon only ever MULTIPLIES alpha down, so the composite can
    // never exceed the plain spectrum case — which is why the same conservative
    // stand-in (BAND_MASK_MID) still bounds it, provided a solid body exists.
    const core = solidBody(ribbonMask(1, 5));
    expect(core.to).toBeGreaterThan(core.from);
    const flag = over(channels(WHITE), BAND_MASK_MID, channels(SURFACE2));
    const band = over(channels(SURFACE2), SCRIM_OVER_PILL, flag);
    for (const [name, hex] of Object.entries(TRIP_PILL_COLOURS)) {
      const pillText = channels(hex);
      const pillBg = over(pillText, 0.12, band);
      expect(contrast(pillText, pillBg), `${name} pill over five flags`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("concentrates the scrim at the pill, not across the open band", () => {
    // The scrim protects the pill without flattening the flag everywhere: the
    // band under the pill is markedly darker than the open band.
    const flag = over(channels(WHITE), BAND_MASK_MID, channels(SURFACE2));
    const openBand = over(channels(SURFACE2), SCRIM_BASE, flag);
    const pillBand = over(channels(SURFACE2), SCRIM_OVER_PILL, flag);
    expect(luminance(openBand)).toBeGreaterThan(luminance(pillBand) * 5);
  });
});
