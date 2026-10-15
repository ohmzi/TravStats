import { useEffect, useRef, useState, type JSX } from "react";

import Button from "../ui/Button";
import { Field, Input } from "../ui/Field";
import SectionHeader from "../ui/SectionHeader";
import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import { dayKey } from "../../lib/roadtrip/roadtripView";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { useToastStore } from "../../store/toastStore";
import type { TourRoute } from "../../types/tour";

/** The trip's effective span, as the roadtrip detail serves it. */
export interface TripDatesSpan {
  startDate: string | null;
  endDate: string | null;
}

interface Props {
  route: TourRoute;
  /** The trip in the path when the section is edited on a trip's page. */
  tripId: string | undefined;
  /** The span the trip already shows — the prefill where a side has no stored day. */
  span?: TripDatesSpan | null;
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
 * The boxes open at the trip's effective dates (owner 2026-10-13): "start and
 * end date of trip shoild be prepopukatef in edit mode with the saved date of
 * trip". A stored day wins on its own side; a side without one is pre-filled
 * from `span`, the span the trip already shows (the roadtrip detail's
 * `startDate`/`endDate`), so saving an untouched form keeps the dates the
 * reader sees as the trip's own. Only a box the reader CLEARS hands its side
 * back — that sends null, never the span's day.
 *
 * Its own component rather than more lines on `TripRouteEditorPage`, which
 * sits close to the 800-line cap.
 */
export default function RoadtripDatesSection({
  route,
  tripId,
  span,
  onSaved,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["roadtrips", "trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [startDay, setStartDay] = useState(route.startDay ?? dayKey(span?.startDate) ?? "");
  const [endDay, setEndDay] = useState(route.endDay ?? dayKey(span?.endDate) ?? "");
  const [saving, setSaving] = useState(false);

  /* The stored days the form last followed. The boxes open from the span, so
     the first pass must not read the stored (possibly empty) days as a change
     — and a plain "first run" flag would not survive StrictMode's second mount
     pass, which would wipe the prefill. A route the page answers with IS
     followed: a stored day that appears lands in its box, and one the server
     cleared empties it again (that side is the stations' once more) rather
     than refilling it from the span the form opened with. */
  const followedRef = useRef<{ start: string | null; end: string | null }>({
    start: route.startDay ?? null,
    end: route.endDay ?? null,
  });
  useEffect(() => {
    const start = route.startDay ?? null;
    const end = route.endDay ?? null;
    if (start === followedRef.current.start && end === followedRef.current.end) return;
    followedRef.current = { start, end };
    setStartDay(start ?? "");
    setEndDay(end ?? "");
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

  return (
    <section>
      <SectionHeader title={t("roadtrips:dates.heading")} />
      <p className="text-sm text-(--text-muted) mb-3">{t("roadtrips:dates.hint")}</p>
      <div className="flex flex-wrap items-end" style={{ gap: 12 }}>
        {/* The shared Field/Input recipe — the same control the change-dates
            dialog draws its own date boxes with — so these sit at the design
            system's control height (44) beside the 46px Save, not the
            hand-rolled ~38px they used to. */}
        <Field label={t("trips:modal.startDateLabel")} htmlFor="trip-dates-start">
          <Input
            id="trip-dates-start"
            type="date"
            value={startDay}
            onChange={(e) => setStartDay(e.target.value)}
          />
        </Field>
        <Field label={t("trips:modal.endDateLabel")} htmlFor="trip-dates-end">
          <Input
            id="trip-dates-end"
            type="date"
            value={endDay}
            invalid={outOfOrder}
            aria-invalid={outOfOrder || undefined}
            onChange={(e) => setEndDay(e.target.value)}
          />
        </Field>
        {/* `size="toolbar"`: the row it saves is the two date boxes beside it,
            so it joins the row's shared height (one control size, 2026-10-11;
            owner's 2026-10-13 screenshot named the tall amber Save). The
            `default` primary's 52 is for a CTA that stands alone — the same
            treatment the change-dates dialog's amber action already takes.

            `ml-auto` sends it to the right edge, where every other commit
            control on these pages now ends (owner, 2026-10-15: "lets move all
            the interactive buttons on the right side of screen"). The date
            fields keep the left, because they are what the reader fills in
            first and `items-end` keeps the button on their baseline. */}
        <Button
          variant="primary"
          size="toolbar"
          className="ml-auto"
          disabled={outOfOrder || saving}
          onClick={() => void save()}
        >
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
