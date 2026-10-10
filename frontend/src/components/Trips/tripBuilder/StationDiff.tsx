import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import { nightCount, type StationRowFacts } from "../../../lib/tripBuilder/existingReview";
import type { StationBefore } from "../../../types/tripBuilder";

function Side({
  startDate,
  endDate,
  slept,
}: {
  startDate: string | null;
  endDate: string | null;
  slept: boolean;
}): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  const nights = nightCount(startDate, endDate, slept);
  const range =
    startDate === null || endDate === null
      ? null
      : `${fmt.localDate(startDate)} – ${fmt.localDate(endDate)}`;
  return (
    <span>
      {range ?? <span>{t("tripBuilder:existing.diff.undated")}</span>}
      {" · "}
      {nights === 0 ? (
        <span>{t("tripBuilder:existing.diff.noNights")}</span>
      ) : (
        <span>{t("tripBuilder:existing.diff.nights", { count: nights })}</span>
      )}
    </span>
  );
}

/** What the stored station says now, and what the photos give: "was 4–6 May · no night → 4–7 May · 3 nights". */
export default function StationDiff({
  before,
  facts,
}: {
  before: StationBefore;
  facts: StationRowFacts;
}): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  return (
    <p className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
      <span>{t("tripBuilder:existing.diff.was")} </span>
      <Side startDate={before.startDate} endDate={before.endDate} slept={before.slept} />
      <span aria-hidden="true"> → </span>
      <Side
        startDate={facts.startDate}
        endDate={facts.endDate}
        slept={facts.slept || before.stay}
      />
    </p>
  );
}
