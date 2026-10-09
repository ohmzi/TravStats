import type { JSX } from "react";
import { bannerFlags } from "../../lib/tripFlags";

/**
 * The trip card's header band, painted as the flags of the trip's countries.
 *
 * This is the place the band's colour gradient used to be. The owner asked for
 * "their flag or flags to overlap in the background … still light to dark
 * spectrum but instead of colour, it to be a flag" (owner, 2026-10-09), so the
 * band keeps its exact geometry (110px tall, a 135deg ramp from the light
 * top-left to the dark bottom-right, landing on `--ts-surface2`) and only what
 * sits UNDER the ramp changes: a colour tint becomes the flags.
 *
 * HOW THE SPECTRUM STAYS. Two things do two different jobs, the way
 * `LoginBackdrop` keeps its pictures under a scrim rather than trusting them:
 *
 *  - a MASK on the flag stack fades the flags themselves along the 135deg axis,
 *    strong at the light corner, to nothing at the dark corner — so the flag
 *    IS the spectrum, and the dark end is `--ts-surface2` for a white flag and
 *    a dark one alike (the invariant the band's legibility test pins);
 *  - a SCRIM over the stack caps the brightest pixel, because the status pill
 *    is a 12 %-alpha fill tuned for dark surfaces and a mostly-white flag would
 *    otherwise break its contrast. The scrim is strongest where the pill sits
 *    (top-right) and settles to a light wash everywhere else, so the flag stays
 *    visible in the open band; its numbers are measured in
 *    `__tests__/TripCard.band.test.tsx`.
 *
 * OVERLAP, NOT A MOSAIC. Several flags are cut into equal diagonal ribbons on
 * the same axis with feathered seams, so neighbours cross-fade over each other.
 * There are no borders, dividers or shadows: a drawn edge is what would turn
 * the wash back into a collage of strips, which is the one reading of
 * "overlap" the owner did not write.
 *
 * Renders NOTHING when the trip has no bundled flag, so the caller keeps its
 * own gradient — a country with no asset is dropped, never stood in for.
 */

/**
 * The 135deg spectrum mask on the flag stack: near-opaque at the light corner,
 * exactly zero at the dark corner so the band always lands on `--ts-surface2`.
 * The 0.55 mid-stop keeps a flag present through the middle rather than fading
 * it out by the halfway mark.
 */
const BAND_MASK_PEAK = 0.95;
export const BAND_MASK_MID = 0.55;
export const SPECTRUM_MASK =
  `linear-gradient(135deg, rgba(0, 0, 0, ${BAND_MASK_PEAK}) 0%, ` +
  `rgba(0, 0, 0, ${BAND_MASK_MID}) 52%, rgba(0, 0, 0, 0) 100%)`;

/** The scrim's alphas, exported so the legibility test models the real stops. */
export const SCRIM_OVER_PILL = 0.88;
export const SCRIM_BASE = 0.3;
export const SCRIM_PILL_SPAN = "130px";
export const SCRIM_SETTLE = "340px";
export const SCRIM =
  `linear-gradient(225deg, color-mix(in srgb, var(--ts-surface2) ${SCRIM_OVER_PILL * 100}%, transparent) 0, ` +
  `color-mix(in srgb, var(--ts-surface2) ${SCRIM_OVER_PILL * 100}%, transparent) ${SCRIM_PILL_SPAN}, ` +
  `color-mix(in srgb, var(--ts-surface2) ${SCRIM_BASE * 100}%, transparent) ${SCRIM_SETTLE})`;

/**
 * One flag's ribbon along the 135deg axis: solid across its own nth of the
 * diagonal, feathered at the seams so neighbours cross-fade instead of meeting
 * at a line. The first ribbon is solid from the light corner and the last is
 * solid to the dark corner, so nothing is left bare at either end.
 */
export function ribbonMask(index: number, count: number): string {
  const seg = 100 / count;
  const feather = Math.min(seg * 0.5, 10);
  const start = index * seg;
  const end = (index + 1) * seg;
  const inFrom = index === 0 ? 0 : start - feather;
  const inTo = index === 0 ? 0 : start + feather;
  const outFrom = index === count - 1 ? 100 : end - feather;
  const outTo = index === count - 1 ? 100 : end + feather;
  return (
    `linear-gradient(135deg, rgba(0, 0, 0, 0) ${inFrom}%, rgba(0, 0, 0, 1) ${inTo}%, ` +
    `rgba(0, 0, 0, 1) ${outFrom}%, rgba(0, 0, 0, 0) ${outTo}%)`
  );
}

export default function TripBandFlags({
  countries,
}: {
  countries: readonly string[];
}): JSX.Element | null {
  const flags = bannerFlags(countries);
  if (flags.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{ background: "var(--ts-surface2)" }}
    >
      <div
        className="absolute inset-0"
        style={{ maskImage: SPECTRUM_MASK, WebkitMaskImage: SPECTRUM_MASK }}
      >
        {flags.map((flag, index) => (
          <div
            key={flag.cc}
            data-flag={flag.cc}
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${flag.url})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              ...(flags.length > 1
                ? {
                    maskImage: ribbonMask(index, flags.length),
                    WebkitMaskImage: ribbonMask(index, flags.length),
                  }
                : undefined),
            }}
          />
        ))}
      </div>
      <div
        data-testid="trip-band-scrim"
        className="absolute inset-0"
        style={{ background: SCRIM }}
      />
    </div>
  );
}
