import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { DraftPhotoJourney } from "../../../types/tripBuilder";
import { Switch } from "../../ui/Field";
import ReviewSection from "./ReviewSection";

interface ReviewPhotoJourneysProps {
  journeys: readonly DraftPhotoJourney[];
  ticks: Readonly<Record<string, boolean>>;
  onTick: (id: string, ticked: boolean) => void;
}

/**
 * Photo-journey suggestions from the inbox that cover these dates. The trip is
 * what they were suggesting, so they start ticked and are marked as handled
 * when it is created; untick one to leave it in the inbox.
 */
export default function ReviewPhotoJourneys({
  journeys,
  ticks,
  onTick,
}: ReviewPhotoJourneysProps): JSX.Element | null {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  if (journeys.length === 0) return null;
  return (
    <ReviewSection
      title={t("tripBuilder:review.journeys.title")}
      aside={t("tripBuilder:review.journeys.hint")}
    >
      <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        {journeys.map((journey) => (
          <li key={journey.id}>
            <Switch
              id={`journey-${journey.id}`}
              label={t("tripBuilder:review.journeys.item", {
                start: fmt.localDate(journey.startDay),
                end: fmt.localDate(journey.endDay),
              })}
              checked={ticks[journey.id] === true}
              onChange={(ticked) => onTick(journey.id, ticked)}
            />
          </li>
        ))}
      </ul>
    </ReviewSection>
  );
}
