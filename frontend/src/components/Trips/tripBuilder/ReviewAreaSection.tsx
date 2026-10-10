import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { DraftEdit, ReviewArea, ReviewState } from "../../../lib/tripBuilder/draftEdits";
import { effectiveNights } from "../../../lib/tripBuilder/planRules";
import { spanOf } from "../../../lib/tripBuilder/reviewRules";
import { areaDays, nightChoices, stationsByDay } from "../../../lib/tripBuilder/reviewView";
import { ROADTRIP_VEHICLES, type RoadtripVehicle } from "../../../shared/tour/roadtrip";
import type { AreaChoice, Day, TripBuilderDraft } from "../../../types/tripBuilder";
import { Card } from "../../ui/Card";
import { Field, Input, Select, Switch } from "../../ui/Field";
import Pill from "../../ui/Pill";
import { Segmented } from "../../ui/Segmented";
import ReviewDayGroup from "./ReviewDayGroup";
import ReviewNightChip from "./ReviewNightChip";

const VEHICLE_LABEL: Record<RoadtripVehicle, string> = {
  motorhome: "tripBuilder:review.area.vehicles.motorhome",
  campervan: "tripBuilder:review.area.vehicles.campervan",
  caravan: "tripBuilder:review.area.vehicles.caravan",
  car: "tripBuilder:review.area.vehicles.car",
  motorcycle: "tripBuilder:review.area.vehicles.motorcycle",
  bicycle: "tripBuilder:review.area.vehicles.bicycle",
  other: "tripBuilder:review.area.vehicles.other",
};

const KIND_LABEL: Record<AreaChoice, string> = {
  roadtrip: "tripBuilder:review.area.kinds.roadtrip",
  stops: "tripBuilder:review.area.kinds.stops",
  skip: "tripBuilder:review.area.kinds.skip",
};

interface ReviewAreaSectionProps {
  draft: TripBuilderDraft;
  state: ReviewState;
  area: ReviewArea;
  /** 1, 2, … in travel order. */
  ordinal: number;
  /** The nights whose chips are drawn in this area. */
  nights: readonly Day[];
  /** The stations that hold a night. */
  slept: ReadonlySet<string>;
  /** Roadtrips are switched off for this account, so an area cannot become one. */
  roadtripsHidden: boolean;
  onEdit: (edit: DraftEdit) => void;
}

/**
 * One stretch of ground travel between flights. The header says what it
 * becomes (a roadtrip, a few timeline stops, or nothing), what it is called and
 * what it was driven in, and whether it starts and ends at home. Below it, day
 * by day, are the stations, the legs between them and the nights.
 */
export default function ReviewAreaSection({
  draft,
  state,
  area,
  ordinal,
  nights,
  slept,
  roadtripsHidden,
  onEdit,
}: ReviewAreaSectionProps): JSX.Element {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  const offered = draft.areas.find((candidate) => candidate.key === area.key);
  const span = spanOf(draft, area);
  const days = areaDays(draft, area);
  const rowsByDay = stationsByDay(
    area,
    days.map((day) => day.day)
  );
  const leadNights = nights.filter((night) => night < span.startDay);
  const flight = draft.flights.find((f) => f.id === offered?.afterFlightId);
  const kinds = (["roadtrip", "stops", "skip"] as const).filter(
    (kind) => kind !== "roadtrip" || !roadtripsHidden || area.as === "roadtrip"
  );
  const answers = effectiveNights(state);
  const keys = new Set(area.stations.map((station) => station.key));
  const sleptNights = nights.filter((night) => keys.has(answers[night])).length;

  return (
    <Card
      data-area={area.key}
      style={{ display: "flex", flexDirection: "column", gap: "var(--ts-space-lg)" }}
    >
      <header className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <div className="flex flex-wrap items-baseline" style={{ gap: "var(--ts-space-md)" }}>
          <h2 className="t-card-title">{t("tripBuilder:review.area.title", { n: ordinal })}</h2>
          <span className="t-caption">
            {`${fmt.localDate(span.startDay)} – ${fmt.localDate(span.endDay)}`}
          </span>
          <span className="t-caption">
            {t("tripBuilder:review.area.summary", {
              stations: area.stations.length,
              nights: sleptNights,
            })}
          </span>
          {offered?.home.unconfirmed === true && (
            <Pill color="var(--ts-warn)">{t("tripBuilder:review.area.homeUnconfirmed")}</Pill>
          )}
        </div>
        {flight !== undefined && (
          <span className="t-caption">
            {t("tripBuilder:review.area.afterFlight", { flight: flight.label })}
          </span>
        )}

        <Segmented<AreaChoice>
          label={t("tripBuilder:review.area.kind")}
          value={area.as}
          options={kinds.map((kind) => ({ value: kind, label: t(KIND_LABEL[kind]) }))}
          onChange={(as) => onEdit({ type: "setAreaKind", areaKey: area.key, as })}
        />

        {area.as === "roadtrip" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("tripBuilder:review.area.name")}>
              <Input
                value={area.name}
                maxLength={200}
                aria-label={t("tripBuilder:review.area.name")}
                onChange={(event) =>
                  onEdit({ type: "setAreaName", areaKey: area.key, name: event.target.value })
                }
              />
            </Field>
            <Field label={t("tripBuilder:review.area.vehicle")}>
              <Select
                aria-label={t("tripBuilder:review.area.vehicle")}
                value={area.vehicle}
                onChange={(event) =>
                  onEdit({
                    type: "setVehicle",
                    areaKey: area.key,
                    vehicle: event.target.value as RoadtripVehicle,
                  })
                }
              >
                {ROADTRIP_VEHICLES.map((vehicle) => (
                  <option key={vehicle} value={vehicle}>
                    {t(VEHICLE_LABEL[vehicle])}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {offered?.home.start.offered === true && (
          <Switch
            label={t("tripBuilder:review.area.homeStart")}
            checked={area.homeStart}
            onChange={(on) => onEdit({ type: "toggleHome", areaKey: area.key, end: "start", on })}
          />
        )}
        {offered?.home.end.offered === true && (
          <Switch
            label={t("tripBuilder:review.area.homeEnd")}
            checked={area.homeEnd}
            onChange={(on) => onEdit({ type: "toggleHome", areaKey: area.key, end: "end", on })}
          />
        )}
      </header>

      {area.as === "skip" ? (
        <span className="t-caption">{t("tripBuilder:review.area.skipped")}</span>
      ) : (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          {leadNights.map((night) => (
            <ReviewNightChip
              key={night}
              day={night}
              assign={answers[night]}
              choices={nightChoices(draft, state, night)}
              onAssign={(assign) => onEdit({ type: "assignNight", day: night, assign })}
            />
          ))}
          {days.map((day) => (
            <ReviewDayGroup
              key={day.day}
              draft={draft}
              state={state}
              area={area}
              day={day}
              rows={rowsByDay.get(day.day) ?? []}
              night={nights.includes(day.day) ? day.day : null}
              slept={slept}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
