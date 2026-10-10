import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { NightChoice } from "../../../lib/tripBuilder/reviewView";
import {
  NIGHT_FLIGHT,
  NIGHT_HOME,
  NIGHT_UNKNOWN,
  type NightAssign,
} from "../../../shared/tour/builderNightPlan";
import type { Day } from "../../../types/tripBuilder";
import { Select } from "../../ui/Field";

interface ReviewNightChipProps {
  day: Day;
  assign: NightAssign;
  choices: readonly NightChoice[];
  onAssign: (assign: NightAssign) => void;
}

/**
 * Where the night after `day` was spent. A night in the air is a fact and
 * stays a fact; every other night is a choice among the places next to it, home
 * and unknown, with the scan's suggestion marked. An unknown night is drawn as
 * the open question it is: the builder never guesses (spec decision 11).
 */
export default function ReviewNightChip({
  day,
  assign,
  choices,
  onAssign,
}: ReviewNightChipProps): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const date = useDisplayFormat().localDate(day);
  const unknown = assign === NIGHT_UNKNOWN;

  if (assign === NIGHT_FLIGHT) {
    return (
      <div className="t-caption" data-night={day} style={{ padding: "var(--ts-space-sm) 0" }}>
        {t("tripBuilder:review.night.flight", { date })}
      </div>
    );
  }

  const labelOf = (choice: NightChoice): string => {
    if (choice.title !== null) {
      return choice.suggested
        ? t("tripBuilder:review.night.suggested", { title: choice.title })
        : choice.title;
    }
    return choice.value === NIGHT_HOME
      ? t("tripBuilder:review.night.home")
      : t("tripBuilder:review.night.unknown");
  };

  return (
    <div
      data-night={day}
      className="flex flex-wrap items-center"
      style={{
        gap: "var(--ts-space-md)",
        padding: "var(--ts-space-sm) var(--ts-space-lg)",
        borderRadius: "var(--ts-radius-button)",
        border: `1px solid ${unknown ? "var(--ts-warn)" : "var(--ts-border)"}`,
        background: "var(--ts-surface2)",
      }}
    >
      <span className="t-caption">{t("tripBuilder:review.night.label", { date })}</span>
      <div style={{ minWidth: 200, flex: "1 1 200px" }}>
        <Select
          aria-label={t("tripBuilder:review.night.choose", { date })}
          value={assign}
          onChange={(event) => onAssign(event.target.value)}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {labelOf(choice)}
            </option>
          ))}
        </Select>
      </div>
      {unknown && <span className="t-caption">{t("tripBuilder:review.night.unknownHint")}</span>}
    </div>
  );
}
