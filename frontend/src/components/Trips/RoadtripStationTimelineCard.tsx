import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatTimeValueShown } from "../../lib/displayFormat";
import { formatTimelineDate } from "../../lib/tripTimeline";
import type { TimelineEvent } from "../../lib/tripTimelineEvents";
import { ExpandableEventCard } from "../Trip/ExpandableEventCard";
import { DetailRow, OpenFullLink } from "./TimelineDetailParts";

type StationEvent = Extract<TimelineEvent, { kind: "roadtrip-station" }>;

/** The station's days as the panel shows them: one day, or "first → last". */
function spanLabel(station: StationEvent["station"]): string | null {
  const start = station.times?.start;
  if (!start) return null;
  const first = formatTimeValueShown(start, { dateOnly: true });
  const end = station.times?.end;
  const last = end ? formatTimeValueShown(end, { dateOnly: true }) : first;
  return last === first ? first : `${first} → ${last}`;
}

/**
 * A roadtrip station on its trip's timeline (spec 2026-10-09 §E): read-only,
 * because the station is edited on its roadtrip, which the panel links to.
 * Built on the shared `ExpandableEventCard`, in the roadtrip colour.
 */
export function RoadtripStationTimelineCard({ ev }: { ev: StationEvent }): JSX.Element {
  const { t } = useTranslation(["tripBuilder", "roadtrips", "trips"]);
  const [open, setOpen] = useState(false);
  const { station } = ev;
  const state = t(`roadtrips:night.${station.state}`);
  const nights = station.nights > 0 ? t("roadtrips:nightsCount", { count: station.nights }) : state;
  return (
    <ExpandableEventCard
      icon="🛣"
      bg="var(--domain-roadtrip-soft)"
      iconColor="var(--domain-roadtrip)"
      title={station.title}
      subtitle={`${station.routeName} · ${nights}`}
      date={ev.date}
      dateLabel={formatTimelineDate(ev.when)}
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
      detailsLabel={t("trips:detail.timeline.showDetails")}
    >
      <DetailRow label={t("tripBuilder:timeline.roadtrip")} value={station.routeName} />
      <DetailRow label={t("tripBuilder:timeline.state")} value={state} />
      <DetailRow label={t("tripBuilder:timeline.dates")} value={spanLabel(station)} />
      <DetailRow label={t("tripBuilder:timeline.notes")} value={station.notes} />
      <OpenFullLink to={`/roadtrips/${station.routeId}`} label={t("tripBuilder:timeline.open")} />
    </ExpandableEventCard>
  );
}
