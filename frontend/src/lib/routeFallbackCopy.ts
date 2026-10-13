import type { RouteFallbackDetail, RouteFallbackReason } from "../types/tour";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The reason a routing attempt left a leg a straight line — with the numbers
 * behind it when the server sent any.
 *
 * 2026-10-13, the owner's Muscat roadtrip: seven legs stayed straight and the
 * message said only "The routing provider's answer did not fit the two places
 * and was discarded." That is true but not enough to act on — it cannot tell
 * a stop 1.3 km off the nearest road (move the pin) apart from a provider
 * whose road graph has no data for the whole region and snapped the answer
 * ~9,500 km away (add the region to the router). The server sends the numbers
 * with the reason; this is the one place they are put into words, so the trip
 * editor's toasts and the roadtrip's leg dialog cannot drift apart.
 *
 * A reason without numbers (or `null`) reads exactly as it always did — the
 * headline stands alone.
 */
export function routeFallbackMessage(
  reason: RouteFallbackReason,
  detail: RouteFallbackDetail | null,
  t: Translate,
  locale: string
): string {
  const headline = t(`trips:tours.routing.reason.${reason}`);
  if (detail === null) return headline;

  // One decimal: a genuine off-road stop sits just past the 1 km tolerance
  // (1.3 km), a wrong-region answer thousands of km away — both read right.
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (detail.kind === "anchors") {
    return `${headline} ${t("trips:tours.routing.detail.anchors", {
      headOff: nf.format(detail.headOffKm),
      tailOff: nf.format(detail.tailOffKm),
    })}`;
  }
  if (detail.kind === "distance") {
    return `${headline} ${t("trips:tours.routing.detail.distance", {
      distance: nf.format(detail.distanceKm),
      chord: nf.format(detail.chordKm),
    })}`;
  }
  // An unknown kind — a newer server's field this build cannot read — has no
  // numbers to say: the headline stands alone rather than "NaN".
  return headline;
}
