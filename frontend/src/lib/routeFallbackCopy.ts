import type { RouteAutofetch, RouteFallbackDetail, RouteFallbackReason } from "../types/tour";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The second sentence when the refusal is so far off that the router started
 * fetching the region's map (spec 2026-10-13-osrm-autofetch-design §2.4).
 * `covered` deliberately says NOTHING: the graph already had the region, so
 * the refusal had a cause of its own and a sentence about map data would
 * blame the wrong thing. `blocked`/`unavailable` are the service's own
 * failures — today's message stands, caps and outages are for the operator.
 *
 * A `started`/`running` answer without a `region` also says nothing —
 * "Map data for null is downloading" is worse than the bare refusal.
 */
function autofetchSentence(
  autofetch: RouteAutofetch | null | undefined,
  t: Translate
): string | null {
  if (!autofetch) return null;
  if (autofetch.status === "started" || autofetch.status === "running") {
    if (!autofetch.region) return null;
    return t("trips:tours.routing.autofetch.downloading", {
      region: autofetch.region,
      // The service's own estimate is coarse (±5 min); when it did not name
      // one, ~25 is its typical single-region job (spec §3).
      minutes: autofetch.etaMinutes ?? 25,
    });
  }
  if (autofetch.status === "no_map_data") return t("trips:tours.routing.autofetch.noMapData");
  return null;
}

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
 * headline stands alone. The same holds for `autofetch` absent or `null`:
 * the message is byte-identical to before the feature, so an instance with
 * the auto-fetch turned off (or a server that predates it) is unchanged.
 */
export function routeFallbackMessage(
  reason: RouteFallbackReason,
  detail: RouteFallbackDetail | null,
  t: Translate,
  locale: string,
  autofetch: RouteAutofetch | null = null
): string {
  return [reasonAndDetail(reason, detail, t, locale), autofetchSentence(autofetch, t)]
    .filter((part): part is string => part !== null)
    .join(" ");
}

/** The message every surface had before the auto-fetch existed. */
function reasonAndDetail(
  reason: RouteFallbackReason,
  detail: RouteFallbackDetail | null,
  t: Translate,
  locale: string
): string {
  const headline = t(`trips:tours.routing.reason.${reason}`);
  if (detail === null) return headline;

  // One decimal: an `anchors` refusal now only arises when a snapped end sits
  // past the 25 km acceptance bound (routeLeg.ts's AUTO_SNAP_MAX_KM), so these
  // are large numbers — a wrong-region answer thousands of km away — and one
  // decimal keeps them readable without implying false precision.
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
