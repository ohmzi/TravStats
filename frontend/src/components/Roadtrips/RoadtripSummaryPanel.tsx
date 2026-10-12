import type { JSX } from "react";

import SummaryCard from "../Trips/SummaryCard";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The trip's own AI summary (template spec §6): generated and stored like the
 * journey's — same provider, same provenance rules, the trip's own span and
 * stations — and drawn in the same card, below the trip's map, with its own
 * Regenerate against `POST /roadtrips/:id/summarize`.
 *
 * The page mounts it only for a trip filed under a journey (spec §8): a
 * detached trip shows no summary section until it is filed again.
 */
export default function RoadtripSummaryPanel({
  roadtripId,
  summary,
  language,
  onChanged,
}: {
  roadtripId: string;
  /** The roadtrip row's stored summary (J2's columns, read through the detail). */
  summary: string | null | undefined;
  /** The reader's UI language (`i18n.language`); the summary is written in it. */
  language: string;
  onChanged: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["roadtrips"]);
  return (
    <SummaryCard
      summary={summary}
      keyPrefix="roadtrips:summary"
      t={t}
      language={language}
      onChanged={onChanged}
      unavailableTestId="roadtrip-summary-unavailable"
      generate={async (summaryLanguage) => {
        await roadtripsApi.summarize(roadtripId, summaryLanguage);
      }}
    />
  );
}
