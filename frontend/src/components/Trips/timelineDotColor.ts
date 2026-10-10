import type { TimelineEvent } from "../../lib/tripTimelineEvents";

/**
 * The colour of a timeline entry's dot on the rail. Moved out of
 * `pages/TripDetailPage.tsx`, which the file-size ratchet freezes at its size.
 *
 * Every entry reads a token, never a literal: the fallbacks the page carried
 * were hex copies of values `index.css` already defines, and a second copy of
 * a colour is a second colour as soon as one of them is adjusted. A diary
 * entry's dot therefore reads `--ts-info`, the token its card's icon has used
 * since the journal card moved.
 */
export function dotColor(ev: Pick<TimelineEvent, "kind">): string {
  switch (ev.kind) {
    case "flight":
      return "var(--domain-flight)";
    case "cruise":
      return "var(--domain-cruise)";
    case "rail":
      return "var(--domain-rail)";
    case "rental-pickup":
    case "rental-return":
      return "var(--ts-domain-rental)";
    case "stop":
    case "place-visit":
      return "var(--domain-poi)";
    case "journal":
      return "var(--ts-info)";
    case "lodging-checkin":
    case "lodging-checkout":
      return "var(--domain-lodging)";
  }
}
