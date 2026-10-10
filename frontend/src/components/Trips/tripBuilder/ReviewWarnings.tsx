import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat, type DisplayFormatter } from "../../../lib/displayFormat";
import type { BuilderWarning, Day, WarningCode } from "../../../types/tripBuilder";
import Button from "../../ui/Button";
import ReviewSection from "./ReviewSection";

const WARNING_KEY: Record<WarningCode, string> = {
  truncated: "tripBuilder:warnings.truncated",
  possibleUnrecordedFlight: "tripBuilder:warnings.possibleUnrecordedFlight",
  noRouting: "tripBuilder:warnings.noRouting",
  cannotSnap: "tripBuilder:warnings.cannotSnap",
  noRoadData: "tripBuilder:warnings.noRoadData",
  roadtripsHidden: "tripBuilder:warnings.roadtripsHidden",
  overlappingTrip: "tripBuilder:warnings.overlappingTrip",
  flightOutsideDates: "tripBuilder:warnings.flightOutsideDates",
  movementOutsideDates: "tripBuilder:warnings.movementOutsideDates",
  pendingPhotoJourneys: "tripBuilder:warnings.pendingPhotoJourneys",
  albumLinkedElsewhere: "tripBuilder:warnings.albumLinkedElsewhere",
  homeUnconfirmed: "tripBuilder:warnings.homeUnconfirmed",
  emptyWindow: "tripBuilder:warnings.emptyWindow",
  noLocatedPhotos: "tripBuilder:warnings.noLocatedPhotos",
};

/** Said elsewhere on the page: the empty-window screen, and the album section. */
const SAID_ELSEWHERE: ReadonlySet<WarningCode> = new Set(["emptyWindow", "albumLinkedElsewhere"]);
/** Notes rather than cautions: nothing the user must act on. */
const NOTES: ReadonlySet<WarningCode> = new Set(["noRouting", "cannotSnap", "noLocatedPhotos"]);

function paramsOf(warning: BuilderWarning, fmt: DisplayFormatter): Record<string, unknown> {
  switch (warning.code) {
    case "possibleUnrecordedFlight":
      return {
        from: fmt.localDate(warning.params.fromDay),
        to: fmt.localDate(warning.params.toDay),
        fromAirport: warning.params.nearestAirports.from ?? "?",
        toAirport: warning.params.nearestAirports.to ?? "?",
      };
    case "noRoadData":
      return { count: warning.params.stations.length };
    case "overlappingTrip":
      return {
        name: warning.params.name,
        start: fmt.localDate(warning.params.startDay),
        end: fmt.localDate(warning.params.endDay),
      };
    case "movementOutsideDates":
      return { day: fmt.localDate(warning.params.day), km: Math.round(warning.params.km) };
    case "pendingPhotoJourneys":
      return { count: warning.params.ids.length };
    default:
      return {};
  }
}

interface ExtendChip {
  id: string;
  label: string;
  range: { startDay?: Day; endDay?: Day };
}

interface ReviewWarningsProps {
  warnings: readonly BuilderWarning[];
  /** The window the draft was scanned for: a chip moves one end of it. */
  window: { startDay: Day; endDay: Day };
  /** Scan again for a longer window; the page re-applies the edits by their keys. */
  onExtend: (range: { startDay?: Day; endDay?: Day }) => void;
}

/**
 * What the scan noticed that the user should know before saving. Where the fix
 * is a different window (a flight just outside the dates, photos from home the
 * day before) the warning carries a chip that scans again with it.
 */
export default function ReviewWarnings({
  warnings,
  window,
  onExtend,
}: ReviewWarningsProps): JSX.Element | null {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  const shown = warnings.filter((warning) => !SAID_ELSEWHERE.has(warning.code));
  if (shown.length === 0) return null;

  const chipsOf = (warning: BuilderWarning): ExtendChip[] => {
    const start = (day: Day): ExtendChip => ({
      id: `start-${day}`,
      label: t("tripBuilder:warnings.extendStart", { day: fmt.localDate(day) }),
      range: { startDay: day },
    });
    const end = (day: Day): ExtendChip => ({
      id: `end-${day}`,
      label: t("tripBuilder:warnings.extendEnd", { day: fmt.localDate(day) }),
      range: { endDay: day },
    });
    if (warning.code === "flightOutsideDates") {
      const { suggestStartDay, suggestEndDay } = warning.params;
      return [
        ...(suggestStartDay ? [start(suggestStartDay)] : []),
        ...(suggestEndDay ? [end(suggestEndDay)] : []),
      ];
    }
    if (warning.code === "movementOutsideDates") {
      const { day } = warning.params;
      if (day < window.startDay) return [start(day)];
      if (day > window.endDay) return [end(day)];
    }
    return [];
  };

  return (
    <ReviewSection title={t("tripBuilder:review.warnings.title")}>
      <ul className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        {shown.map((warning, index) => {
          const chips = chipsOf(warning);
          return (
            <li
              key={`${warning.code}-${index}`}
              data-warning={warning.code}
              className="flex flex-col"
              style={{
                gap: "var(--ts-space-sm)",
                paddingLeft: "var(--ts-space-lg)",
                borderLeft: `3px solid ${NOTES.has(warning.code) ? "var(--ts-info)" : "var(--ts-warn)"}`,
              }}
            >
              <span>{t(WARNING_KEY[warning.code], paramsOf(warning, fmt))}</span>
              {warning.code === "overlappingTrip" && warning.params.suspiciouslyLong && (
                <span className="t-caption">{t("tripBuilder:warnings.suspiciouslyLong")}</span>
              )}
              {chips.length > 0 && (
                <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                  {chips.map((chip) => (
                    <Button key={chip.id} onClick={() => onExtend(chip.range)}>
                      {chip.label}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </ReviewSection>
  );
}
