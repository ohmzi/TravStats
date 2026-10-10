import { useEffect, useId, useState, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { tripBuilderApi } from "../../../lib/api/tripBuilder";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { DraftEdit } from "../../../lib/tripBuilder/draftEdits";
import type { DraftStation, StationKind } from "../../../types/tripBuilder";
import Button from "../../ui/Button";
import { Field, Input, Switch, TextArea } from "../../ui/Field";
import Pill from "../../ui/Pill";
import { useExistingDiff } from "./ExistingDiffContext";
import StationDiff from "./StationDiff";
import StationStatusPill from "./StationStatusPill";

const KIND_LABEL: Partial<Record<StationKind, string>> = {
  brief: "tripBuilder:review.station.kind.brief",
  dayTrip: "tripBuilder:review.station.kind.dayTrip",
  home: "tripBuilder:review.station.kind.home",
  airport: "tripBuilder:review.station.kind.airport",
};

interface ReviewStationRowProps {
  station: DraftStation;
  draftId: string;
  /** The station holds at least one night. */
  slept: boolean;
  /** An unknown night is within the station's reach, so "slept here" can be switched on. */
  canSleep: boolean;
  /** The station can be joined with the one after it. */
  canMerge: boolean;
  /** The station is an excursion that can be folded back into its base. */
  canFold: boolean;
  onEdit: (edit: DraftEdit) => void;
}

/**
 * One stop of the route, collapsed to a line: its name, its days, its photos.
 * Opened, it shows a few thumbnails (loaded only then, by index through the
 * draft, never by asset id) and everything the user may do with it: rename,
 * note, "slept here", join with the next, fold a day trip, remove.
 */
export default function ReviewStationRow({
  station,
  draftId,
  slept,
  canSleep,
  canMerge,
  canFold,
  onEdit,
}: ReviewStationRowProps): JSX.Element | null {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(station.title);
  const [note, setNote] = useState(station.notes ?? "");
  useEffect(() => setTitle(station.title), [station.title]);
  useEffect(() => setNote(station.notes ?? ""), [station.notes]);
  const info = useExistingDiff().infoFor(station);
  if (info.hidden) return null;

  const anchor = station.kind === "home" || station.kind === "airport";
  const kindLabel = KIND_LABEL[station.kind];
  const days =
    station.firstDay === station.lastDay
      ? fmt.localDate(station.firstDay)
      : `${fmt.localDate(station.firstDay)} – ${fmt.localDate(station.lastDay)}`;

  const commitTitle = (): void => {
    const next = title.trim();
    if (next === "") setTitle(station.title);
    else if (next !== station.title) {
      onEdit({ type: "rename", stationKey: station.key, title: next });
    }
  };
  const commitNote = (): void => {
    if (note !== (station.notes ?? "")) {
      onEdit({ type: "setNote", stationKey: station.key, notes: note });
    }
  };

  return (
    <div
      data-station={station.key}
      style={{
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center text-left"
        style={{
          gap: "var(--ts-space-md)",
          padding: "var(--ts-space-lg)",
          minHeight: "var(--ts-size-touch-min)",
          color: "var(--ts-text)",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ts-text-bright)" }}>
          {station.title}
        </span>
        {info.status !== null && <StationStatusPill status={info.status} />}
        {kindLabel !== undefined && <Pill color="var(--ts-muted)">{t(kindLabel)}</Pill>}
        {slept && <Pill color="var(--ts-good)">{t("tripBuilder:review.station.slept")}</Pill>}
        <span className="t-caption">{days}</span>
        {station.photoCount > 0 && (
          <span className="t-caption">
            {t("tripBuilder:review.station.photos", { count: station.photoCount })}
          </span>
        )}
      </button>
      {info.status === "changed" && station.before && info.facts && (
        <div style={{ padding: "0 var(--ts-space-lg) var(--ts-space-md)" }}>
          <StationDiff before={station.before} facts={info.facts} />
        </div>
      )}

      {open && (
        <div
          className="flex flex-col"
          style={{ gap: "var(--ts-space-lg)", padding: "0 var(--ts-space-lg) var(--ts-space-lg)" }}
        >
          {station.previewIdx.length > 0 && (
            <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
              {station.previewIdx.map((index) => (
                <img
                  key={index}
                  src={tripBuilderApi.previewUrl(draftId, index, "thumbnail")}
                  alt=""
                  loading="lazy"
                  width={84}
                  height={84}
                  style={{ objectFit: "cover", borderRadius: "var(--ts-radius-tile)" }}
                />
              ))}
            </div>
          )}
          {station.snappedKm !== null && (
            <span className="t-caption">
              {t("tripBuilder:review.station.snapped", { km: station.snappedKm.toFixed(1) })}
            </span>
          )}

          <Field label={t("tripBuilder:review.station.name")} htmlFor={`${fieldId}-name`}>
            <Input
              id={`${fieldId}-name`}
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </Field>
          <Field label={t("tripBuilder:review.station.note")} htmlFor={`${fieldId}-note`}>
            <TextArea
              id={`${fieldId}-note`}
              rows={2}
              value={note}
              maxLength={5000}
              onChange={(event) => setNote(event.target.value)}
              onBlur={commitNote}
            />
          </Field>

          {!anchor && (
            <Switch
              id={`${fieldId}-slept`}
              label={t("tripBuilder:review.station.slept")}
              sub={!slept && !canSleep ? t("tripBuilder:review.station.sleptNone") : undefined}
              checked={slept}
              disabled={!slept && !canSleep}
              onChange={(next) =>
                onEdit({ type: "toggleSlept", stationKey: station.key, slept: next })
              }
            />
          )}

          <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
            {!anchor && (
              <Button
                disabled={!canMerge}
                onClick={() => onEdit({ type: "merge", stationKey: station.key })}
              >
                {t("tripBuilder:review.station.merge")}
              </Button>
            )}
            {station.kind === "dayTrip" && (
              <Button
                disabled={!canFold}
                onClick={() => onEdit({ type: "foldDayTrip", stationKey: station.key })}
              >
                {t("tripBuilder:review.station.fold")}
              </Button>
            )}
            {station.kind !== "home" && (
              <Button onClick={() => onEdit({ type: "delete", stationKey: station.key })}>
                {t("tripBuilder:review.station.delete")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
