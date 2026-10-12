import type { JSX, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import Pill from "../ui/Pill";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { omitStartYear, roadtripDays, type RoadtripPhase } from "../../lib/roadtrip/roadtripView";
import type { RoadtripSummary } from "../../types/roadtrip";
import CardMap from "../map/CardMap";

/**
 * "18.09. – 28.09.2026", or the undated word. The start's year goes only when
 * both ends share it (`omitStartYear`, the figures band's own rule), so a span
 * across New Year keeps it and the card and the trip's page print one string.
 */
export function useRoadtripSpan(): (r: Pick<RoadtripSummary, "startDate" | "endDate">) => string {
  const { t } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  return (r) => {
    if (!r.startDate) return t("roadtrips:undated");
    const to = r.endDate ?? r.startDate;
    if (to.slice(0, 10) === r.startDate.slice(0, 10)) {
      return display.date(r.startDate, { timeZone: "UTC" });
    }
    return `${display.date(r.startDate, { timeZone: "UTC", omitYear: omitStartYear(r.startDate, to) })} – ${display.date(to, { timeZone: "UTC" })}`;
  };
}

/**
 * One figure of a card's three-figure row — the roadtrip card's own furniture,
 * exported so a card that joins the roadtrip cards in a grid (the Trips tab's
 * flights entry) draws the same row rather than one that merely looks like it.
 */
export function Figure({
  value,
  label,
  title,
}: {
  value: ReactNode;
  label: string;
  title?: string;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col" title={title}>
      <span
        className="t-meta-mono"
        style={{ fontSize: 15, fontWeight: 600, color: "var(--ts-text-bright)" }}
      >
        {value}
      </span>
      <span className="t-caption">{label}</span>
    </div>
  );
}

/**
 * One roadtrip in the list (design 2026-09-25, board 1): the route sketch,
 * the vehicle, the name, when and where, and three figures — km, days and
 * cities (owner, 2026-10-08 figures; days since 2026-10-11). A figure that is
 * not known is a dash with its reason on hover — never a zero — and the day
 * count falls back to the stored nights + 1, carrying "≈" while those nights
 * are only a lower bound, exactly when a stored date is missing.
 *
 * CITIES is not a station count (owner, 2026-10-08): it is the distinct STATION
 * TITLES the row carries, the same field the roadtrips list strip unions across
 * its rows. A title is free text, so "Oakville" and "Oakville, Ontario" count as
 * two and a wild-camp station counts as one; the owner was shown that and
 * accepted it. A roadtrip with no titled station prints a real 0, unlike the
 * flight card, which dashes when no airport can name a city — a known empty
 * against an unknown one; do not unify them (owner, 2026-10-08).
 *
 * THE ROW IS THE LIST STRIP'S RULE AT ROW SCALE. Its days are the roadtrip's
 * own span (`roadtripDays`): the two stored dates' inclusive days where both
 * are there — the very `spanDays` the detail page's figures band prints, so
 * one roadtrip cannot put two day counts under the one word — and the stored
 * nights + 1 only when a date is missing. It reads the shared
 * `common:summary.cardDays` — the one key both journey cards use, so they
 * cannot spell the same figure two ways — and its cities the shared
 * `common:summary.cities` over `cityNames`, the field the strip unions. The
 * detail page's figures band is a DIFFERENT surface and keeps its own cells (it
 * has a "slept in" figure the card never had, and it leaves Days out of an
 * undated roadtrip where the card falls back to the nights) — that difference
 * is deliberate, not something to "fix" into agreement.
 */
export default function RoadtripCard({
  roadtrip: r,
  phase,
}: {
  roadtrip: RoadtripSummary;
  phase: RoadtripPhase;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "common"]);
  const navigate = useNavigate();
  const span = useRoadtripSpan();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  // The headline is the roadtrip's own span in days: its two stored dates
  // inclusively where both are there — the figure the detail page's band
  // prints — and the stored nights + 1 only when a date is missing, the "≈"
  // staying while those nights are known only as a lower bound (owner,
  // 2026-10-11).
  const { days, approximate } = roadtripDays(r.startDate, r.endDate, r);
  const vehicle = [
    r.vehicle ? t(`roadtrips:vehicle.${r.vehicle}`) : null,
    r.vehicleName ? `„${r.vehicleName}“` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Legs are measured when a save creates them, so a distance exists as soon
  // as there are two stations; before that there is nothing to measure.
  const kmKnown = r.stationCount >= 2;
  /** When and where, without the journey — that gets its own element below. */
  const meta = [span(r), r.countries.join(" · ") || null].filter(Boolean).join(" · ");

  return (
    <Link
      to={`/roadtrips/${r.id}`}
      className="flex flex-col overflow-hidden"
      style={{
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <div className="relative">
        {/* The map, not just the line: the sketch above drew the route on a
            blank background, so a trip had no land to sit against. The routed
            path when there is one, the stations alone until then. */}
        <CardMap
          lines={[
            {
              coords: r.path && r.path.length >= 2 ? r.path : r.points,
              dashed: phase === "planned",
            },
          ]}
          stops={(r.points ?? []).map((coord) => ({ coord }))}
        />
        {phase === "planned" && (
          <span className="absolute" style={{ top: 10, left: 10 }}>
            <Pill color="var(--ts-info)">{t("roadtrips:phase.planned")}</Pill>
          </span>
        )}
      </div>
      <div
        className="flex flex-col"
        style={{ padding: "var(--ts-space-lg)", gap: "var(--ts-space-sm)" }}
      >
        {vehicle && <span style={{ fontSize: 12, color: "var(--accent)" }}>{vehicle}</span>}
        <span style={{ fontSize: 17, fontWeight: 800, color: "var(--ts-text-bright)" }}>
          {r.name}
        </span>
        {/* The journey is a LINK, not one more word in the meta line: a
            roadtrip is reached from its trip and the way back has to exist
            too. It cannot be an `<a>` — the whole card already is one, and a
            link inside a link is invalid HTML whose click fires twice — so it
            is a span that stops the card's navigation and goes where it says. */}
        <span className="t-caption">
          {meta}
          {meta && r.tripId && r.tripName ? " · " : ""}
          {r.tripId && r.tripName && (
            <span
              role="link"
              tabIndex={0}
              style={{ color: "var(--accent)", textDecoration: "underline" }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate(`/trips/${r.tripId}`);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/trips/${r.tripId}`);
                }
              }}
            >
              {r.tripName}
            </span>
          )}
        </span>
        <div
          className="grid grid-cols-3"
          style={{
            gap: "var(--ts-space-sm)",
            paddingTop: "var(--ts-space-sm)",
            borderTop: "1px solid var(--ts-border)",
          }}
        >
          <Figure
            value={kmKnown ? nf.format(r.drivenKm) : "—"}
            label={t("roadtrips:list.figKm")}
            title={kmKnown ? undefined : t("roadtrips:list.kmUnknown")}
          />
          <Figure
            value={`${approximate ? "≈ " : ""}${nf.format(days)}`}
            label={t("common:summary.cardDays", { count: days })}
            title={approximate ? t("roadtrips:list.nightsApprox") : undefined}
          />
          <Figure
            value={nf.format(r.cityNames.length)}
            label={t("common:summary.cities", { count: r.cityNames.length })}
          />
        </div>
      </div>
    </Link>
  );
}
