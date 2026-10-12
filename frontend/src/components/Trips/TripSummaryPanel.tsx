import type { JSX } from "react";
import { tripsApi } from "../../lib/api";
import type { useTranslation } from "../../hooks/useTranslation";
import type { Trip } from "../../types";
import SummaryCard from "./SummaryCard";

export { summaryLanguageOf } from "./SummaryCard";

/**
 * The journey's LLM summary card on its overview (iter 9).
 *
 * A thin wrapper around the shared card (`SummaryCard`) since the trip level
 * gained its own summary (template spec §3, §6): the trip's panel renders the
 * same card against `POST /roadtrips/:id/summarize` with the `roadtrips`
 * namespace, so layout, gating and refusals cannot drift between the two
 * Regenerate flows. The journey's sentences stay under `trips:summary.*`; the
 * demo refusal and the no-model sentence are the card's, unchanged.
 */
export function TripSummaryPanel({
  trip,
  t,
  language,
  onChanged,
}: {
  trip: Trip;
  t: ReturnType<typeof useTranslation>["t"];
  /** The reader's UI language (`i18n.language`); the summary is written in it. */
  language: string;
  onChanged: () => void;
}): JSX.Element | null {
  return (
    <SummaryCard
      summary={trip.summary}
      keyPrefix="trips:summary"
      t={t}
      language={language}
      onChanged={onChanged}
      unavailableTestId="trip-summary-unavailable"
      generate={async (summaryLanguage) => {
        await tripsApi.summarize(trip.id, summaryLanguage);
      }}
    />
  );
}

export default TripSummaryPanel;
