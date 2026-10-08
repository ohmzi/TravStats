import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import FlightJourneyCard, {
  countriesOfFlights,
  type FlightJourneyGroup,
} from "./FlightJourneyCard";
import { SkeletonStatCards } from "../SkeletonLoader";
import ListSummaryStrip, { type SummaryFigure } from "../table/ListSummaryStrip";
import { flightsApi } from "../../lib/api/flights";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type { Flight } from "../../types";

/** The bar's controls, styled as the ones the table's own bar uses. */
const CONTROL_CLASS =
  "rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]";

/**
 * A loose match over what a reader remembers a flight by — the airline, the
 * number, either airport or the country — which is also what the search box
 * now says it takes.
 */
function matchesQuery(flight: Flight, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    flight.airline,
    flight.flightNumber,
    flight.depIata,
    flight.arrIata,
    flight.depName,
    flight.arrName,
    flight.depCountry,
    flight.arrCountry,
    flight.trip?.name,
  ].some((v) => (v ?? "").toLowerCase().includes(q));
}

/** "YUL → YYZ", for a flight that belongs to no journey and stands alone. */
function legLabel(flight: Flight): string {
  const from = flight.depIata || flight.depIcao || "?";
  const to = flight.arrIata || flight.arrIcao || "?";
  return `${from} → ${to}`;
}

/**
 * A journey's flights grouped the way the cards show them.
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
        countries: [],
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
      href: `/flights?view=table&trip=${flight.tripId}`,
      flights: [flight],
      countries: [],
    });
  }

  // Filled after the loop: a journey's countries are a property of all its
  // flights and are not known until it has them.
  for (const group of groups.values()) {
    group.countries = countriesOfFlights(group.flights);
  }

  // Newest journey first, matching the table's own default order.
  return [...groups.values()].sort((a, b) => {
    const latest = (g: FlightJourneyGroup): string => {
      const sorted = g.flights.map((f) => f.departureTime ?? "").sort();
      return sorted.length > 0 ? sorted[sorted.length - 1] : "";
    };
    return latest(b).localeCompare(latest(a));
  });
}

/**
 * The Flights log page's card view (owner, 2026-10-08).
 *
 * It wears the same furniture as the table view, above and below the cards —
 * the summary line, the search, the status and year filters, and the "a whole
 * list at once?" hint with the way across to the table — because the two views
 * are ONE page shown two ways, and only the middle should differ. That
 * furniture existed on the table side alone, which is why the card view read
 * as a different page that happened to share a title.
 *
 * The filters narrow the FLIGHTS, and a journey with none left goes with them:
 * matching a card on "does any of its legs match" and then showing the card in
 * full would answer a question nobody asked. The journey name is matchable
 * too, so searching a trip's name still finds it.
 */
export default function FlightJourneyGrid(): JSX.Element {
  const { t, i18n } = useTranslation(["flights", "common"]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [year, setYear] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await flightsApi.getEvery();
        if (!cancelled) setFlights(all);
      } catch (error: unknown) {
        logger.error({ err: error }, "FlightJourneyGrid: failed to load flights");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const statuses = useMemo(
    () => [...new Set(flights.map((f) => f.status).filter(Boolean))].sort(),
    [flights]
  );
  const years = useMemo(
    () =>
      [
        ...new Set(
          flights.map((f) => (f.departureTime ?? "").slice(0, 4)).filter((y) => y.length === 4)
        ),
      ].sort((a, b) => b.localeCompare(a)),
    [flights]
  );

  const shown = useMemo(
    () =>
      flights.filter(
        (f) =>
          matchesQuery(f, query) &&
          (status === "all" || f.status === status) &&
          (year === "all" || (f.departureTime ?? "").startsWith(year))
      ),
    [flights, query, status, year]
  );
  const groups = useMemo(() => groupFlightsByJourney(shown), [shown]);

  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const figures = useMemo<SummaryFigure[]>(() => {
    const airlines = new Set(shown.map((f) => f.airline).filter(Boolean));
    const airports = new Set<string>();
    for (const f of shown) {
      if (f.depIata) airports.add(f.depIata);
      if (f.arrIata) airports.add(f.arrIata);
    }
    return [
      {
        key: "flights",
        value: nf.format(shown.length),
        label: t("common:summary.flights", { count: shown.length }),
      },
      {
        key: "airlines",
        value: nf.format(airlines.size),
        label: t("common:summary.airlines", { count: airlines.size }),
      },
      {
        key: "airports",
        value: nf.format(airports.size),
        label: t("common:summary.airports", { count: airports.size }),
      },
    ];
  }, [shown, nf, t]);

  const activeFilters = [query.trim().length > 0, status !== "all", year !== "all"].filter(
    Boolean
  ).length;

  if (loading) return <SkeletonStatCards />;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      <ListSummaryStrip
        figures={figures}
        filtered={activeFilters > 0}
        filteredLabel={t("common:filters.filtered")}
        unknown={loading}
      />

      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("flights:journeyCard.searchLong")}
          aria-label={t("flights:journeyCard.searchLong")}
          className={CONTROL_CLASS}
          style={{ flex: "1 1 280px", maxWidth: 460 }}
        />
        {/* The rest fold away behind one button, which is what the table's own
            bar does with them — there behind its Filter panel, here behind
            this. Either way the search stays in sight. */}
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className={CONTROL_CLASS}
        >
          {t("flights:journeyCard.moreFilters")}
          {activeFilters > 0 && (
            <span
              className="ml-2 rounded-full px-1.5 text-xs"
              style={{ background: "var(--accent)", color: "#0d1117" }}
            >
              {activeFilters}
            </span>
          )}
        </button>
        <span className="t-caption ml-auto">
          {t("common:filters.matching", { count: groups.length })}
        </span>
      </div>

      <div
        aria-hidden={!filtersOpen}
        style={{
          overflow: "hidden",
          maxHeight: filtersOpen ? 120 : 0,
          opacity: filtersOpen ? 1 : 0,
          transition: "max-height 220ms ease, opacity 180ms ease",
        }}
      >
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label={t("flights:filter.allStatuses")}
            className={CONTROL_CLASS}
          >
            <option value="all">{t("flights:filter.allStatuses")}</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {t(`flights:status.${s}`, { defaultValue: s })}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-label={t("flights:filter.allYears")}
            className={CONTROL_CLASS}
          >
            <option value="all">{t("flights:filter.allYears")}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {activeFilters > 0 && (
            <button
              type="button"
              className="t-caption underline"
              onClick={() => {
                setQuery("");
                setStatus("all");
                setYear("all");
              }}
            >
              {t("common:filters.reset")}
            </button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="t-caption">
          {activeFilters > 0 ? t("flights:journeyCard.noMatch") : t("flights:table.noFlights")}
        </p>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
          style={{ gap: "var(--ts-space-lg)" }}
        >
          {groups.map((group) => (
            <FlightJourneyCard key={group.key} group={group} locale={i18n.language} />
          ))}
        </div>
      )}

      {/* The table view's own footer, in the same place: a whole list at once is
          the other view's job, and the way there is a link at the foot of the
          page rather than a heading at the top competing with its title. */}
      <p className="t-caption">
        {t("flights:list.wholeListHint")}{" "}
        <Link
          to="/settings/data?section=import"
          className="underline underline-offset-4 hover:text-(--text-primary)"
        >
          {t("settings:import.openHub")}
        </Link>
        {" · "}
        <Link to="/flights?view=table" className="underline underline-offset-4">
          {t("flights:journeyCard.viewTable")}
        </Link>
      </p>
    </div>
  );
}
