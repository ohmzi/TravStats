import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useRoadtripSpan } from "../Roadtrips/RoadtripCard";
import { useTripRoadtrips } from "../Roadtrips/useTripRoadtrips";

/**
 * The journey's chain (spec 2026-10-12 §3): one node per trip — its name, its
 * date span, its driven km and its station count — each a link to the trip
 * page. It is the journey level of the same chain the trip page draws for its
 * stations; the stops themselves stay on each trip's own pages.
 *
 * The rows come from the roadtrips list (`useTripRoadtrips`) and the span from
 * `useRoadtripSpan` — the same hook the itinerary cards head with, so a node
 * and a card cannot disagree about one trip's span. An empty chain says so
 * rather than drawing a blank.
 */
export default function JourneyTripsChain({ tripId }: { tripId: string }): JSX.Element {
  const { t, i18n } = useTranslation(["trips", "roadtrips"]);
  const { isEnabled } = useEnabledDomains();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const span = useRoadtripSpan();
  const trips = useTripRoadtrips(tripId, isEnabled("roadtrip"));

  if (trips.length === 0) {
    return <p className="t-caption">{t("trips:overview.noTrips")}</p>;
  }

  return (
    <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <h2 className="t-label-mono">{t("roadtrips:pageTitle")}</h2>
      <ol className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {trips.map((r) => (
          <li
            key={r.id}
            className="grid"
            style={{ gridTemplateColumns: "22px minmax(0, 1fr)", gap: 12 }}
          >
            {/* The chain's own line: a node per trip, connected downwards. */}
            <div className="flex flex-col items-center" aria-hidden>
              <span
                className="rounded-full"
                style={{
                  width: 10,
                  height: 10,
                  marginTop: 20,
                  background: "var(--domain-roadtrip)",
                  boxShadow: "0 0 0 3px var(--ts-surface)",
                }}
              />
              <span className="flex-1" style={{ width: 2, background: "var(--ts-border)" }} />
            </div>
            <Link
              to={`/roadtrips/${r.id}`}
              className="flex min-w-0 items-center transition-colors hover:bg-[var(--ts-surface2)]"
              style={{
                gap: "var(--ts-space-md)",
                marginBottom: "var(--ts-space-sm)",
                padding: "var(--ts-space-md) var(--ts-space-lg)",
                borderRadius: "var(--ts-radius-card)",
                background: "var(--ts-surface)",
                border: "1px solid var(--ts-border)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <span className="flex min-w-0 flex-1 flex-col" style={{ gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ts-text-bright)" }}>
                  {r.name}
                </span>
                <span className="t-caption truncate">
                  {[
                    span(r),
                    `${nf.format(r.drivenKm)} km`,
                    t("roadtrips:stationCount", { count: r.stationCount }),
                  ].join(" · ")}
                </span>
              </span>
              <span aria-hidden style={{ color: "var(--ts-muted)" }}>
                ›
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
