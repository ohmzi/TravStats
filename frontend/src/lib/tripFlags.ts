import { resolveCountryCode } from "../shared/geo/countryCode";

/**
 * The bundled flag assets, and the one rule that decides which of a trip's
 * countries paints into its card's header band.
 *
 * WHY A SEPARATE MODULE FROM `countryFlag.tsx`. That module's `FlagImg` loads
 * `https://flagcdn.com` at RUNTIME — right for the small chips it was written
 * for, wrong for the card band, where nothing may be fetched at build or at
 * runtime (owner, 2026-10-09). The band paints only files this repository
 * ships, so the two needs do not share a source. The network that stays in
 * `countryFlag.tsx` is why this module exists at all.
 *
 * WHY EXACTLY TWO FLAGS. This is a PILOT, and it is deliberately small: the
 * owner wants the mechanism proved on two journeys before any other card
 * design is built on it (owner, 2026-10-09). `BUNDLED_FLAGS` is the allow-list
 * and the only place "exactly two" is enforced, so a third flag cannot slip in
 * merely by being dropped into `public/flags/` — the file would be dead.
 *
 * A COUNTRY WITH NO ASSET IS DROPPED, NEVER GUESSED. No generic flag, no ISO
 * letters, no emoji, no colour: exactly the rule the codebase already applies
 * to a number it does not know. The card's own figures line still prints the
 * true country count, and when at least one flag IS drawn the band carries a
 * `title` saying how many were left out — the "dash with a reason" of
 * `ListSummaryStrip.tsx` and `TripCard`.
 *
 * ORDER IS POSITIONAL, NOT CHRONOLOGICAL. `bannerFlags` keeps the array order
 * it is handed, but that order only decides which flag reads as more prominent
 * (first = the light corner). A trip's `countries` is a SET, never a route: the
 * stored array is the user's own order and the derived one is sorted
 * alphabetically (`backend/src/routes/trips/tripCountries.ts`). The band must
 * never be read as first-visited-to-last.
 */

/**
 * Code → the URL the band paints, and the whole of the pilot's allow-list.
 *
 * Keys are ISO 3166-1 alpha-2, uppercase, matching `resolveCountryCode`'s
 * output. The paths are absolute (`/flags/…`) because `public/` is served from
 * the site root by Vite and nginx alike; see the asset headers for provenance.
 */
export const BUNDLED_FLAGS: Readonly<Record<string, string>> = {
  CA: "/flags/ca.svg",
  PK: "/flags/pk.svg",
};

/**
 * How many flags the band will draw before the rest are dropped.
 *
 * A judgement, not a measurement: past three equal ribbons the overlapped
 * wash stops reading as flags and starts reading as mud. The cap is written
 * down rather than silent — the figures line still prints the true count.
 */
export const BANNER_FLAG_CAP = 3;

export interface BannerFlag {
  /** The resolved ISO 3166-1 alpha-2 code. */
  cc: string;
  /** Where the band paints it from — always a local asset. */
  url: string;
}

/** The asset URL for a bundled code, or null when this repo ships no flag. */
export function flagAssetUrl(cc: string): string | null {
  return BUNDLED_FLAGS[cc.toUpperCase()] ?? null;
}

/**
 * The distinct countries a trip records, resolved to codes, in array order.
 *
 * Each entry runs through `resolveCountryCode`, which takes a code OR a name
 * in any language and returns `null` for anything it cannot identify — a wrong
 * flag being worse than none (`countryFlag.tsx`). Nulls are dropped and
 * duplicates collapsed, so this is the trip's true country SET, the number the
 * band's `title` counts against.
 */
export function knownCountries(countries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of countries) {
    const cc = resolveCountryCode(entry);
    if (!cc || seen.has(cc)) continue;
    seen.add(cc);
    out.push(cc);
  }
  return out;
}

/**
 * The drawable flags for a trip's band. Pure: same input, same output, no
 * network and no trip name — every journey renders this way by construction.
 *
 * Resolve → drop the undrawable → cap. `allow` is injectable only so a test
 * can exercise the cap when the pilot bundles two flags; production always
 * uses the default, which is the single seam the app reads.
 */
export function bannerFlags(
  countries: readonly string[],
  allow: Readonly<Record<string, string>> = BUNDLED_FLAGS
): BannerFlag[] {
  const out: BannerFlag[] = [];
  for (const cc of knownCountries(countries)) {
    const url = allow[cc];
    if (!url) continue;
    out.push({ cc, url });
    if (out.length >= BANNER_FLAG_CAP) break;
  }
  return out;
}
