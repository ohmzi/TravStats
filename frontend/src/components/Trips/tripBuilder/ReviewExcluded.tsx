import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { ExcludedCounts } from "../../../types/tripBuilder";
import ReviewSection from "./ReviewSection";

const REASONS: ReadonlyArray<readonly [keyof ExcludedCounts, string]> = [
  ["partner", "tripBuilder:review.excluded.partner"],
  ["hiddenLivePart", "tripBuilder:review.excluded.hiddenLivePart"],
  ["misdated", "tripBuilder:review.excluded.misdated"],
  ["inFlight", "tripBuilder:review.excluded.inFlight"],
  ["atSea", "tripBuilder:review.excluded.atSea"],
  ["unlocated", "tripBuilder:review.excluded.unlocated"],
  ["locationCarried", "tripBuilder:review.excluded.locationCarried"],
  ["dayGuessed", "tripBuilder:review.excluded.dayGuessed"],
];

/**
 * What the scan left out and why, so a missing photo is explained and not just
 * absent. Own photos kept off the route (taken in the air, at sea, without a
 * place, with the wrong date) stay in the album; other people's and the hidden
 * halves of live photos were never counted.
 */
export default function ReviewExcluded({
  excluded,
}: {
  excluded: ExcludedCounts;
}): JSX.Element | null {
  const { t } = useTranslation(["tripBuilder"]);
  const shown = REASONS.filter(([name]) => excluded[name] > 0);
  if (shown.length === 0) return null;
  return (
    <ReviewSection
      title={t("tripBuilder:review.excluded.title")}
      aside={t("tripBuilder:review.excluded.hint")}
    >
      <ul className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
        {shown.map(([name, key]) => (
          <li key={name} className="t-caption">
            {t(key, { count: excluded[name] })}
          </li>
        ))}
      </ul>
    </ReviewSection>
  );
}
