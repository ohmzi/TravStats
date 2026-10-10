import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { CommitResult } from "../../../types/tripBuilder";

/**
 * The success panel's diff of an updated trip (spec §K.4): what happened to each
 * roadtrip, the stops and the album. Draws nothing for a new trip, or for an
 * update that changed none of those (a flights-only save).
 */
export default function ExistingSuccessSummary({
  result,
}: {
  result: CommitResult;
}): JSX.Element | null {
  const { t } = useTranslation(["tripBuilder"]);
  if (result.created) return null;
  const { album, stops } = result;
  const lines = [
    ...result.roadtrips.flatMap(({ name, diff }) =>
      diff
        ? [
            t("tripBuilder:existing.success.roadtrip", {
              name,
              updated: diff.updated,
              unchanged: diff.unchanged,
              added: diff.added,
              removed: diff.removed,
              kept: diff.kept,
            }),
          ]
        : []
    ),
    ...(stops
      ? [
          t("tripBuilder:existing.success.stops", {
            updated: stops.updated,
            unchanged: stops.unchanged,
            added: stops.added,
            removed: stops.removed,
            kept: stops.kept,
          }),
        ]
      : []),
    ...(album.status === "linked"
      ? [
          t("tripBuilder:existing.success.album", {
            added: album.added ?? 0,
            alreadyIn: album.alreadyIn ?? 0,
            removed: album.removed ?? 0,
          }),
        ]
      : []),
    ...(album.removeSkipped
      ? [t(`tripBuilder:existing.success.removeSkipped.${album.removeSkipped}`)]
      : []),
  ];
  if (lines.length === 0) return null;
  return (
    <ul className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      {lines.map((line, index) => (
        // The lines are derived whole on every render and never reordered.
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}
