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
 */
export default function ResyncFromImmich({ tripId }: { tripId: string }): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  return <ActionLink to={`/trips/${tripId}/resync`}>{t("tripBuilder:resync.action")}</ActionLink>;
}
