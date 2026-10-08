import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import FlightJourneyCard, { type FlightJourneyGroup } from "./FlightJourneyCard";
import { SkeletonStatCards } from "../SkeletonLoader";
import { flightsApi } from "../../lib/api/flights";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type { Flight } from "../../types";

/** "YUL → YYZ", for a flight that belongs to no journey and stands alone. */
function legLabel(flight: Flight): string {
  const from = flight.depIata || flight.depIcao || "?";
  const to = flight.arrIata || flight.arrIcao || "?";
  return `${from} → ${to}`;
}

/**
 * A journey's flights grouped the way the cards show them.
 *
 * Grouping happens HERE rather than on the server because the two sources are
 * already on the client: the flight list carries its trip's id, name and
 * colour, so one pass over the flights the page already fetches answers it.
 *
 * A flight filed under NO journey is a card of its own rather than a bucket
 * called "other": the point of the grid is to see where each journey went, and
 * lumping every untripped flight onto one map would draw a scribble across the
 * world that means nothing. It is also the state a mistyped import lands in,
 * so it should be visible one flight at a time.
 */
export function groupFlightsByJourney(flights: Flight[]): FlightJourneyGroup[] {
  const groups = new Map<string, FlightJourneyGroup>();
  for (const flight of flights) {
    if (!flight.tripId) {
      groups.set(`flight:${flight.id}`, {
        key: `flight:${flight.id}`,
        title: legLabel(flight),
        href: `/flights/${flight.id}`,
        flights: [flight],
      });
      continue;
    }
    const existing = groups.get(flight.tripId);
    if (existing) {
      existing.flights.push(flight);
      continue;
    }
    groups.set(flight.tripId, {
      key: flight.tripId,
      title: flight.trip?.name ?? legLabel(flight),
      color: flight.trip?.color ?? null,
      href: `/flights?trip=${flight.tripId}`,
      flights: [flight],
    });
  }

  // Newest journey first, matching the table's own default order; a single
  // untripped flight sorts by its own date through the same key.
  return [...groups.values()].sort((a, b) => {
    const latest = (g: FlightJourneyGroup): string => {
      const sorted = g.flights.map((f) => f.departureTime ?? "").sort();
      return sorted.length > 0 ? sorted[sorted.length - 1] : "";
    };
    return latest(b).localeCompare(latest(a));
  });
}

/**
 * The Flights page's door: one card per journey, its flights overlaid on one
 * map, and the whole card opening that journey's table.
 *
 * The page used to BE the table, so a journey's shape — where it went, how many
 * legs it took — had to be assembled by reading rows. The table is still there,
 * one click in, because that is where a flight is edited.
 */
export default function FlightJourneyGrid(): JSX.Element {
  const { t, i18n } = useTranslation(["flights", "common"]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await flightsApi.getEvery();
        if (!cancelled) setFlights(all);
      } catch (error: unknown) {
        logger.error({ err: error }, "FlightsTablePage: failed to load flights for the cards");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => groupFlightsByJourney(flights), [flights]);

  if (loading) {
    return <SkeletonStatCards />;
  }

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-h2" style={{ margin: 0 }}>
          {t("flights:journeyCard.allJourneys")}
        </h2>
        {/* The table of everything, which the cards no longer are: without this
            the page would have no way back to the unfiltered list. */}
        <Link to="/flights?trip=all" className="t-caption underline">
          {t("flights:table.title")}
        </Link>
      </div>
      {groups.length === 0 ? (
        <p className="t-caption">{t("flights:table.noFlights")}</p>
      ) : (
        <div
          className="grid"
          style={{
            gap: "var(--ts-space-lg)",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          }}
        >
          {groups.map((group) => (
            <FlightJourneyCard key={group.key} group={group} locale={i18n.language} />
          ))}
        </div>
      )}
    </div>
  );
}
