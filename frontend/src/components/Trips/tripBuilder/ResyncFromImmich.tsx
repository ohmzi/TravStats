import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../../hooks/useTranslation";

/**
 * "Re-sync from Immich" (spec 2026-10-09 §K.1): scan the trip's saved dates again
 * and update the trip in place. A link, in the look of a secondary button, so the
 * trip page and the roadtrip page share one launch (`/trips/:id/resync`).
 */
export default function ResyncFromImmich({ tripId }: { tripId: string }): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  return (
    <Link
      to={`/trips/${tripId}/resync`}
      className="inline-flex items-center"
      style={{
        height: "var(--ts-size-button-secondary)",
        padding: "0 var(--ts-space-lg)",
        borderRadius: "var(--ts-radius-button)",
        border: "1px solid var(--ts-border-button)",
        color: "var(--ts-text)",
        fontSize: 16,
        fontWeight: 700,
      }}
    >
      {t("tripBuilder:resync.action")}
    </Link>
  );
}
