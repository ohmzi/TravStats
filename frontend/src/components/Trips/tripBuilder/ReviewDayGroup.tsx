import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { DraftEdit, ReviewArea, ReviewState } from "../../../lib/tripBuilder/draftEdits";
import { refusesExistingEdit } from "../../../lib/tripBuilder/existingReview";
import { sleepNight } from "../../../lib/tripBuilder/nightRules";
import { effectiveNights } from "../../../lib/tripBuilder/planRules";
import { nightChoices, type DayStation } from "../../../lib/tripBuilder/reviewView";
import { foldDayTrip, mergeWithNext } from "../../../lib/tripBuilder/stationOps";
import type { Day, DraftDay, TripBuilderDraft } from "../../../types/tripBuilder";
import { useExistingDiff } from "./ExistingDiffContext";
import ReviewLegRow from "./ReviewLegRow";
import ReviewNightChip from "./ReviewNightChip";
import ReviewStationRow from "./ReviewStationRow";

interface ReviewDayGroupProps {
  draft: TripBuilderDraft;
  state: ReviewState;
  area: ReviewArea;
  day: DraftDay;
  /** The stations that start on this day, with their place in the area. */
  rows: readonly DayStation[];
  /** The night after this day, when its chip is drawn here. */
  night: Day | null;
  /** The stations that hold a night. */
  slept: ReadonlySet<string>;
  onEdit: (edit: DraftEdit) => void;
}

/**
 * One day of an area: when it was and how many photos it has, the flights that
 * left on it, the stations that begin on it with the leg that led to each, the
 * places only passed through, and the chip for the night that follows.
 */
export default function ReviewDayGroup({
  draft,
  state,
  area,
  day,
  rows,
  night,
  slept,
  onEdit,
}: ReviewDayGroupProps): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  const { infoFor } = useExistingDiff();
  const chain = { stations: area.stations, legs: area.legs };
  const flights = day.flightIds.flatMap((id) => draft.flights.filter((f) => f.id === id));
  const places = day.stationKeys
    .flatMap((key) => state.areas.flatMap((a) => a.stations).filter((s) => s.key === key))
    .map((s) => s.title);

  // A collapsed unchanged station leaves with the leg that leads to it, not only its row.
  const drawn = rows.filter(({ station }) => !infoFor(station).hidden);

  return (
    <section
      data-day={day.day}
      aria-label={fmt.localDate(day.day, { weekday: true })}
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
    >
      <header className="flex flex-wrap items-baseline" style={{ gap: "var(--ts-space-md)" }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--ts-text-bright)" }}>
          {fmt.localDate(day.day, { weekday: true })}
        </h3>
        <span className="t-caption">
          {day.photos === 0
            ? t("tripBuilder:review.day.noPhotos")
            : t("tripBuilder:review.day.photos", { photos: day.photos, located: day.located })}
        </span>
      </header>

      {flights.map((flight) => (
        <span key={flight.id} className="t-caption">
          {t("tripBuilder:review.day.flight", { label: flight.label })}
        </span>
      ))}

      {rows.length === 0 && places.length > 0 && (
        <span className="t-caption">
          {t("tripBuilder:review.day.continuesAt", { places: [...new Set(places)].join(", ") })}
        </span>
      )}

      {drawn.map(({ station, index }) => (
        <div key={station.key} className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          {index > 0 && area.legs[index - 1] !== undefined && (
            <ReviewLegRow
              leg={area.legs[index - 1]}
              fromTitle={area.stations[index - 1].title}
              toTitle={station.title}
              onMode={(mode) =>
                onEdit({
                  type: "setLegMode",
                  fromKey: area.stations[index - 1].key,
                  toKey: station.key,
                  mode,
                })
              }
            />
          )}
          <ReviewStationRow
            station={station}
            draftId={draft.id}
            slept={slept.has(station.key)}
            canSleep={sleepNight(draft, state, station.key) !== null}
            canMerge={mergeWithNext(chain, index) !== null}
            canFold={foldDayTrip(chain, index) !== null}
            canDelete={!refusesExistingEdit(draft, { type: "delete", stationKey: station.key })}
            onEdit={onEdit}
          />
        </div>
      ))}

      {day.passedThrough.map((chip) => (
        <span key={`${chip.title}-${chip.firstLocal}`} className="t-caption">
          {t("tripBuilder:review.day.passedThrough", {
            title: chip.title,
            time: fmt.localClock(chip.firstLocal.slice(11)),
          })}
        </span>
      ))}

      {night !== null && (
        <ReviewNightChip
          day={night}
          assign={effectiveNights(state)[night]}
          choices={nightChoices(draft, state, night)}
          onAssign={(assign) => onEdit({ type: "assignNight", day: night, assign })}
        />
      )}
    </section>
  );
}
