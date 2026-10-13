import { useEffect, useState, type JSX } from "react";

import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { useToastStore } from "../../store/toastStore";
import type { TourRoute } from "../../types/tour";

interface Props {
  route: TourRoute;
  /** The trip in the path when the section is edited on a trip's page. */
  tripId: string | undefined;
  onSaved: (route: TourRoute) => void;
}

/**
 * The trip's own start and end day (owner 2026-10-13, the primary ask):
 * "primarily if editing a trip should allow start and end date of a trip,
 * this feature is not even there". Two date inputs, the journey edit page's
 * own labels and its end-before-start sentence, and one Save that writes both
 * sides through the kind-agnostic route PATCH. An empty input sends an
 * explicit null and that side returns to the stations' span on the server;
 * the stored days (per side) are then what the list, the chain, the re-sync's
 * window and the timeline read.
 *
 * Its own component rather than more lines on `TripRouteEditorPage`, which
 * sits close to the 800-line cap.
 */
export default function RoadtripDatesSection({
  route,
  tripId,
  onSaved,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["roadtrips", "trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [startDay, setStartDay] = useState(route.startDay ?? "");
  const [endDay, setEndDay] = useState(route.endDay ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStartDay(route.startDay ?? "");
    setEndDay(route.endDay ?? "");
  }, [route.startDay, route.endDay]);

  // The pair is a roadtrip's own; a day tour's day is its `date`.
  if (route.kind !== "roadtrip") return null;

  const outOfOrder = startDay !== "" && endDay !== "" && endDay < startDay;

  const save = async (): Promise<void> => {
    if (outOfOrder || saving) return;
    setSaving(true);
    try {
      const updated = await toursApi.update(tripId, route.id, {
        startDay: startDay === "" ? null : startDay,
        endDay: endDay === "" ? null : endDay,
      });
      onSaved(updated);
      addToast("success", t("roadtrips:dates.saved"));
    } catch (err) {
      logger.warn("RoadtripDatesSection: saving the trip's dates failed", err);
      addToast("error", saveErrorMessage(err, t, "roadtrips:dates.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "rounded-lg px-3 py-2 text-sm";
  const inputStyle = { border: "1px solid var(--ts-border)", background: "var(--ts-surface)" };
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">{t("roadtrips:dates.heading")}</h2>
      <p className="text-sm text-(--text-muted) mb-3">{t("roadtrips:dates.hint")}</p>
      <div className="flex flex-wrap items-end" style={{ gap: 12 }}>
        <label className="flex flex-col" style={{ gap: 4, fontSize: 12, color: "var(--ts-muted)" }}>
          {t("trips:modal.startDateLabel")}
          <input
            type="date"
            value={startDay}
            onChange={(e) => setStartDay(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </label>
        <label className="flex flex-col" style={{ gap: 4, fontSize: 12, color: "var(--ts-muted)" }}>
          {t("trips:modal.endDateLabel")}
          <input
            type="date"
            value={endDay}
            aria-invalid={outOfOrder || undefined}
            onChange={(e) => setEndDay(e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </label>
        <Button variant="primary" disabled={outOfOrder || saving} onClick={() => void save()}>
          {t("roadtrips:dates.save")}
        </Button>
      </div>
      {outOfOrder && (
        <p role="alert" className="text-[11px] mt-2" style={{ color: "var(--color-danger)" }}>
          {t("trips:modal.endBeforeStart")}
        </p>
      )}
    </section>
  );
}
