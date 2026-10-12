import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import { roadtripsApi } from "../../lib/api/roadtrips";
import { logger } from "../../lib/logger";
import { roadtripPhase, dayKey } from "../../lib/roadtrip/roadtripView";
import { todayIn } from "../../shared/time";
import { useTodayZone } from "../../hooks/useTodayZone";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useTranslation } from "../../hooks/useTranslation";
import RoadtripCard from "../Roadtrips/RoadtripCard";
import JourneyFlightsCard from "./JourneyFlightsCard";
import { Placeholder } from "./TripDetailPanels";
import type { JourneyFlight } from "../../lib/flights/journeyFigures";
import type { RoadtripSummary } from "../../types/roadtrip";

/** The card grid the roadtrip cards are drawn in, the list page's at row scale. */
const GRID = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

/**
 * The journey's own Trips tab (spec 2026-10-12 §3): its trips as cards, the
 * overview's roadtrips section promoted to a tab of its own. Each card opens
 * the trip's page.
 *
 * THE JOURNEY'S FLIGHTS ARE ONE OF THOSE TRIPS (owner, 2026-10-12): when the
 * journey has flights the tab draws a flights entry FIRST — flights are what
 * the journey starts from — linking to the flight journey's own page, and the
 * roadtrip cards keep their travel order after it. The entry and the roadtrip
 * cards are gated on THEIR OWN domains: the roadtrip cards (and the roadtrips
 * read behind them) on the roadtrips domain — the page can now mount this tab
 * for a journey whose only trip is its flights — while the flights entry is
 * the journey's flights, which this app lists ungated on every other journey
 * surface (the Timeline and Logistics tabs, `TripCard`'s own counts: "Flights
 * stay ungated, as they always were here"). A journey with no flights draws
 * exactly today's tab.
 *
 * The rows come from the roadtrips list, filtered to this journey — the
 * endpoint returns the reader's whole list, and a journey's own query does
 * not exist. Loading, failed and empty stay three different pictures for the
 * reason every list here keeps them apart: "no trip yet" and "we could not
 * ask" look identical as an empty grid. The flights entry is handed down by
 * the journey page from the trip it already loaded (`tripsApi.getById`) —
 * one fetch for the page, shared with the figures band.
 */
export default function JourneyTripsTab({
  tripId,
  flights,
}: {
  tripId: string;
  /** The journey's flights, as the journey page's own trip payload carries them. */
  flights: readonly JourneyFlight[];
}): JSX.Element {
  const { t } = useTranslation(["trips", "roadtrips", "common"]);
  const { isEnabled } = useEnabledDomains();
  const roadtripEnabled = isEnabled("roadtrip");
  const todayZone = useTodayZone();
  const today = useMemo(() => todayIn(todayZone), [todayZone]);
  const [rows, setRows] = useState<RoadtripSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(false);
    // A domain that is off has no cards to ask for: the read is skipped, not
    // failed — the tab may still be open for the journey's flights.
    if (!roadtripEnabled) {
      setRows([]);
      return;
    }
    try {
      const all = await roadtripsApi.list();
      if (!mountedRef.current) return;
      setRows(all.filter((r) => r.tripId === tripId));
    } catch (err: unknown) {
      logger.warn("Loading a journey's trips failed", err);
      if (!mountedRef.current) return;
      setRows(null);
      setLoadError(true);
    }
  }, [tripId, roadtripEnabled]);

  useEffect(() => {
    void load();
  }, [load]);

  // Travel order, the journey's own chronology; an undated trip goes last.
  const sorted = useMemo(() => {
    if (rows === null) return null;
    return [...rows].sort((a, b) => {
      const ak = dayKey(a.startDate) ?? "";
      const bk = dayKey(b.startDate) ?? "";
      if (ak === bk) return 0;
      if (ak === "") return 1;
      if (bk === "") return -1;
      return ak < bk ? -1 : 1;
    });
  }, [rows]);

  if (loadError) {
    return (
      <div
        className="rounded-xl p-4 text-sm"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <p style={{ color: "var(--ts-bad)" }}>{t("roadtrips:loadError")}</p>
        <button type="button" className="mt-2 underline" onClick={() => void load()}>
          {t("common:buttons.retry")}
        </button>
      </div>
    );
  }

  if (sorted === null) {
    return (
      <div className="py-10 text-center text-sm text-(--text-muted)">
        {t("common:loading.default")}
      </div>
    );
  }

  // The flights lead, the roadtrip cards follow in travel order. The tab is
  // empty only when NEITHER trip exists — the flights alone are a trip.
  const flightsEntry =
    flights.length > 0 ? <JourneyFlightsCard tripId={tripId} flights={flights} /> : null;
  if (flightsEntry === null && sorted.length === 0) {
    return <Placeholder text={t("trips:detail.tripsEmpty")} />;
  }

  return (
    <div className={GRID}>
      {flightsEntry}
      {sorted.map((r) => (
        <RoadtripCard
          key={r.id}
          roadtrip={r}
          phase={roadtripPhase(r.startDate, r.endDate, today)}
        />
      ))}
    </div>
  );
}
