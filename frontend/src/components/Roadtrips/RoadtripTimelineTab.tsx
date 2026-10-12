import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { foldViaPoints } from "../../shared/tour/viaPoints";
import {
  arrivalDay,
  departureDay,
  isStayCancelled,
  dayNumber,
} from "../../lib/roadtrip/roadtripView";
import type { RoadtripDetail, RoadtripStation } from "../../types/roadtrip";
import { LegLabel } from "./StationTimeline";

export interface RoadtripDayGroup {
  /** The day the group's first station was reached; null for undated stations. */
  day: string | null;
  /** The trip's Day N for that day, or null without a start date. */
  number: number | null;
  stations: RoadtripStation[];
}

/**
 * The trip's stations grouped by the day they were reached, travel order kept.
 * Consecutive stations that share an arrival day share a group; undated ones
 * (including the ones between two dated stations) form their own.
 */
export function stationDayGroups(
  stations: readonly RoadtripStation[],
  startDate: string | null
): RoadtripDayGroup[] {
  const groups: RoadtripDayGroup[] = [];
  for (const station of stations) {
    const day = arrivalDay(station);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.stations.push(station);
    } else {
      groups.push({
        day,
        number: day !== null ? dayNumber(startDate, day) : null,
        stations: [station],
      });
    }
  }
  return groups;
}

/** The nights a station holds, or null while its dates cannot say. */
function nightsOf(s: RoadtripStation): number | null {
  const from = arrivalDay(s);
  const to = departureDay(s);
  if (!from || !to) return null;
  if (s.state === "stay" && s.stay?.nights != null) return s.stay.nights;
  return Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
}

/**
 * The roadtrip's day-by-day breakdown, as its own Timeline tab (spec 2026-10-12
 * §3): under each day head, EVERY station with the detail the overview's chain
 * does not spell out — its state, its stay and the stay's dates, its linked
 * place, its notes and the nights it holds — and between the stations the same
 * leg rows the chain draws (mode, km, duration, source). The chain stays the
 * overview's glance; this is the reading view of the same material.
 */
export default function RoadtripTimelineTab({ detail }: { detail: RoadtripDetail }): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  // Route corrections are not stations: the timeline shows the folded walk,
  // the same fold the chain uses.
  const { stations, legs } = foldViaPoints(detail.stations, detail.legs);
  const legFrom = new Map(legs.map((l) => [l.fromStopId, l]));
  const indexOfStation = new Map(stations.map((s, index) => [s.id, index]));
  const groups = stationDayGroups(stations, detail.startDate);

  const short = (day: string): string =>
    display.date(`${day}T00:00:00Z`, { timeZone: "UTC", omitYear: true });
  const weekday = (day: string): string =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "long", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`)
    );
  const duration = (minutes: number): string =>
    t("roadtrips:timeline.duration", {
      h: Math.floor(minutes / 60),
      m: String(minutes % 60).padStart(2, "0"),
    });

  if (stations.length === 0) {
    return <p className="t-caption">{t("roadtrips:stations.empty")}</p>;
  }

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      {groups.map((group, groupIndex) => (
        <section
          key={group.day ?? `undated-${groupIndex}`}
          className="flex flex-col"
          style={{ gap: "var(--ts-space-sm)" }}
        >
          <h3 className="t-label-mono" style={{ color: "var(--domain-roadtrip)" }}>
            {group.day !== null
              ? [
                  group.number !== null ? t("roadtrips:timeline.day", { n: group.number }) : null,
                  `${weekday(group.day)} ${short(group.day)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("roadtrips:undated")}
          </h3>
          <ol className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {group.stations.map((s) => {
              const leg = stations[(indexOfStation.get(s.id) ?? 0) + 1]
                ? (legFrom.get(s.id) ?? null)
                : null;
              const nights = nightsOf(s);
              return (
                <li key={s.id} style={{ paddingBottom: "var(--ts-space-md)" }}>
                  <div
                    className="flex flex-col"
                    style={{
                      gap: 6,
                      padding: "var(--ts-space-md) var(--ts-space-lg)",
                      borderRadius: "var(--ts-radius-card)",
                      background: "var(--ts-surface)",
                      border: "1px solid var(--ts-border)",
                    }}
                  >
                    <span style={{ fontSize: 16, fontWeight: 800, color: "var(--ts-text-bright)" }}>
                      {s.title}
                    </span>
                    <div className="flex flex-wrap items-center" style={{ gap: 8, fontSize: 13 }}>
                      <span style={{ color: "var(--ts-muted)" }}>
                        {t(`roadtrips:night.${s.state}`)}
                      </span>
                      {isStayCancelled(s) ? (
                        <span style={{ color: "var(--ts-warn)" }}>
                          {t("roadtrips:timeline.cancelled")}
                        </span>
                      ) : (
                        nights !== null && (
                          <span style={{ color: "var(--ts-muted)" }}>
                            {t("roadtrips:nightsCount", { count: nights })}
                          </span>
                        )
                      )}
                      <span className="t-meta-mono">
                        {[arrivalDay(s), departureDay(s)]
                          .filter((d): d is string => d !== null)
                          .map(short)
                          .join(" – ")}
                      </span>
                    </div>
                    {(s.stay || s.place) && (
                      <div className="flex flex-wrap items-center" style={{ gap: 8, fontSize: 13 }}>
                        {s.stay && (
                          <Link
                            to={`/lodging/${s.stay.lodgingId}`}
                            style={{ color: "var(--domain-lodging)" }}
                          >
                            {s.stay.lodgingName}
                          </Link>
                        )}
                        {s.place && (
                          <Link to={`/places/${s.place.id}`} style={{ color: "var(--domain-poi)" }}>
                            {s.place.name}
                          </Link>
                        )}
                      </div>
                    )}
                    {s.notes && (
                      <p className="whitespace-pre-wrap t-caption" style={{ margin: 0 }}>
                        {s.notes}
                      </p>
                    )}
                    {leg && (
                      <LegLabel
                        leg={leg}
                        km={nf.format(leg.distanceKm)}
                        duration={leg.drivingMinutes !== null ? duration(leg.drivingMinutes) : null}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
