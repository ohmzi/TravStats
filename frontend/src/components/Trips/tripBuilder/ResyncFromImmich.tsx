import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import ActionLink from "../../ui/ActionLink";

/**
 * "Re-sync from Immich" (spec 2026-10-09 §K.1): scan the trip's saved dates again
 * and update the trip in place. It is the `ui/ActionLink` the detail pages draw
 * beside their primary button — the trip page's row (Edit · Re-sync · Delete)
 * and the roadtrip band's journey cell both take their size from that one
 * component, so no copy of the recipe can drift again (owner, 2026-10-11:
 * "all these should be same size").
 *
 * A `routeId` makes it the TRIP's own Re-sync (owner request 2026-10-12): the
 * journey-wide entry names only the journey; the trip edit page's names the
 * roadtrip, whose page scans and updates that trip alone.
 */
export default function ResyncFromImmich({
  tripId,
  routeId,
}: {
  tripId: string;
  routeId?: string;
}): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const to = routeId === undefined ? `/trips/${tripId}/resync` : `/roadtrips/${routeId}/resync`;
  return <ActionLink to={to}>{t("tripBuilder:resync.action")}</ActionLink>;
}
