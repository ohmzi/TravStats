import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import ActionLink from "../components/ui/ActionLink";
import Button from "../components/ui/Button";
import DetailHeader from "../components/ui/DetailHeader";
import EmptyState from "../components/ui/EmptyState";
import Pill from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import TripModal from "../components/Trips/TripModal";
import TripMap, { type TripMapContent } from "../components/Trips/TripMap";
import { stationHighlightLayer } from "../components/Roadtrips/stationHighlightLayer";
import FlightTripFigures from "../components/flightsTable/FlightTripFigures";
import FlightLegTimeline, {
  type AirportStation,
  type TripLegFlight,
} from "../components/flightsTable/FlightLegTimeline";
import { FlightsTablePanel } from "../components/flightsTable/FlightsTablePanel";
import { useTranslation } from "../hooks/useTranslation";
import { useDisplayFormat } from "../lib/displayFormat";
import { localeForLanguage } from "../lib/units";
import { tripsApi } from "../lib/api";
import { sortFlightsByLegOrder } from "../lib/flightLegSort";
import { useTodayZone } from "../hooks/useTodayZone";
import { todayIn } from "../shared/time";
import { roadtripPhase } from "../lib/roadtrip/roadtripView";
import { phasePillColor } from "../lib/detailPhase";
import { DETAIL_MAP_BOX_RADIUS, DETAIL_MAP_STICKY_TOP } from "../lib/detailChrome";
import { distinctAirports } from "../lib/flights/journeyFigures";
import type { Trip } from "../types";

/** A steady empty list, so a page with no trip yet does not re-order a fresh array each render. */
const NO_FLIGHTS: TripLegFlight[] = [];

/**
 * One journey — a Trip's flights — as a page of its own (owner, 2026-10-08).
 *
 * Tapping a journey card in the Flights logbook used to drop the reader into
 * the whole table filtered to that trip: a list of rows with no home for the
 * journey itself. This is that home, and it is SHAPED like the roadtrip detail
 * page on purpose — head, a band of figures, then the body — so the two read
 * as the same kind of page rather than as two designs side by side.
 *
 * The band sits ABOVE the tab strip so its figures are visible whichever body
 * is shown, and the tab lives in the URL as `?view=table` — the logbook's own
 * word for "show me the table" (`FlightsTablePage.tsx`), so one meaning holds
 * across the whole Flights section and a link that already says it keeps
 * working. The title never changes across the two.
 *
 * A `tripId` here is always a real Trip. An untripped flight has no journey and
 * keeps opening its own page at `/flights/:id`.
 */
export default function FlightTripDetailPage(): JSX.Element {
  const { tripId = "" } = useParams<{ tripId: string }>();
  const [params, setParams] = useSearchParams();
  const { t, i18n } = useTranslation(["flights", "common"]);
  const display = useDisplayFormat();
  const todayZone = useTodayZone();
  const today = useMemo(() => todayIn(todayZone), [todayZone]);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  // The airport the reader picked in the route timeline; the page rings it on
  // the map. Held as the station, not its key, so the map gets its coordinate.
  const [selected, setSelected] = useState<AirportStation | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(false);
    try {
      const data = await tripsApi.getById(tripId);
      if (mountedRef.current) setTrip(data);
    } catch {
      if (mountedRef.current) setLoadError(true);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The journey's flights in travel order, by `sortFlightsByLegOrder` — the
  // same rule the table's tripped group uses — so the route timeline and the
  // map beside it cannot disagree about which leg came first.
  const routeFlights = trip?.flights ?? NO_FLIGHTS;
  const orderedFlights = useMemo(() => sortFlightsByLegOrder(routeFlights), [routeFlights]);

  // The map draws the same legs the timeline lists, and rings the station the
  // reader picked. `stationHighlightLayer` knows nothing of roadtrips or
  // flights — it rings a point — so it serves here unchanged.
  const mapContent = useMemo<TripMapContent>(
    // The empty sentence in this page's words, not the trip map's own.
    () => ({ flights: orderedFlights, emptyKey: "flights:journeyPage.mapEmpty" }),
    [orderedFlights]
  );
  const highlight = useMemo(
    () => stationHighlightLayer(selected ? { lat: selected.lat, lon: selected.lon } : null),
    [selected]
  );

  // The body swap lives in the URL, not in state alone: a shared
  // `/flights/journeys/:tripId?view=table` has to land on the table, and Back
  // has to leave the page rather than toggle the tab. `replace` is the
  // precedent the trip page's `?tab=` set (`TripDetailPage.tsx`).
  const showTable = params.get("view") === "table";
  const setView = useCallback(
    (next: "route" | "table"): void => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next === "table") updated.set("view", "table");
          else updated.delete("view");
          return updated;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  if (loadError) {
    return (
      <AppShell width="table">
        <EmptyState
          kind="degraded"
          title={t("flights:journeyPage.loadError")}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t("common:buttons.retry")}
            </Button>
          }
        />
      </AppShell>
    );
  }

  if (!trip) {
    return (
      <AppShell width="table">
        <div
          aria-busy="true"
          aria-label={t("common:loading.default")}
          className="flex flex-col"
          style={{ gap: 16 }}
        >
          {[150, 96, 420].map((height) => (
            <div
              key={height}
              className="animate-pulse"
              style={{
                height,
                borderRadius: "var(--ts-radius-card)",
                background: "var(--ts-surface)",
              }}
            />
          ))}
        </div>
      </AppShell>
    );
  }

  const flights = trip.flights ?? [];
  const airports = distinctAirports(flights);
  const phase = roadtripPhase(trip.startDate, trip.endDate, today);
  const nf = new Intl.NumberFormat(localeForLanguage(i18n.language), {
    maximumFractionDigits: 0,
  });

  const span =
    trip.startDate === null
      ? null
      : `${display.date(trip.startDate, {
          timeZone: "UTC",
          omitYear: trip.endDate !== null,
        })}${
          trip.endDate && trip.endDate.slice(0, 10) !== trip.startDate.slice(0, 10)
            ? ` – ${display.date(trip.endDate, { timeZone: "UTC" })}`
            : ""
        }`;

  // The subtitle keeps its own shape — a date span, then counts — rather than
  // the roadtrip page's vehicle · dates · in-trip link: a journey has no
  // vehicle, and it IS the trip, so there is no "part of the trip" to name. The
  // span and the " · " join are the SAME builders the roadtrip page uses; only
  // what goes between them differs, which is what the subject decides.
  const subtitle = [
    span,
    `${nf.format(flights.length)} ${t("common:summary.flights", { count: flights.length })}`,
    `${nf.format(airports)} ${t("common:summary.airports", { count: airports })}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // A phase, not a status column, and the SAME rule the roadtrip page applies:
  // planned and underway earn a pill, past and undated earn none. `past` is
  // deliberately absent — a finished journey reads as finished from its date
  // span, exactly as a finished roadtrip does, and the roadtrip page is the
  // reference the owner pointed at. The colour comes from `phasePillColor`, so
  // the two pages cannot disagree about which phase draws what again.
  const pillColor = phasePillColor(phase);
  const status =
    pillColor === null ? undefined : (
      <Pill color={pillColor}>
        {phase === "underway"
          ? t("flights:journeyPage.phase.underway")
          : t("flights:journeyPage.phase.planned")}
      </Pill>
    );

  const tabStyle = (active: boolean): CSSProperties => ({
    background: "none",
    border: 0,
    cursor: "pointer",
    padding: "8px 0",
    color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
    borderBottom: active ? "2px solid var(--ts-accent)" : "2px solid transparent",
  });

  return (
    <AppShell width="table">
      <DetailHeader
        backTo="/flights"
        // "Logbook · Flights", the label the four sibling detail pages use for
        // an entry that belongs to the Logbook (`FlightDetailPage`,
        // `CruiseDetailPage`, `LodgingDetailPage`, `PlaceDetailPage`). The
        // roadtrip page's "Roadtrips" names its own top-level section, not a
        // Logbook area — so this is a difference the two pages are RIGHT to
        // keep, not one to erase for the look of it (owner, 2026-10-08).
        backLabel={t("flights:detail.backToLogbook")}
        domain="flight"
        // The domain's line icon, as every other detail page draws (`caravan`
        // on the roadtrip page, `plane` here — `ui/domainIcons.ts`). It was a
        // raw "✈" glyph in the same 48px tile, the last emoji-style mark in a
        // header.
        icon={<Icon name="plane" size={24} />}
        title={trip.name}
        status={status}
        subtitle={<span>{subtitle}</span>}
        actions={
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <ActionLink to={`/trips/${trip.id}`}>{t("flights:detail.openTrip")}</ActionLink>
            <Button
              variant="primary"
              icon={<Icon name="pencil" size={16} />}
              onClick={() => setEditing(true)}
            >
              {t("common:buttons.edit")}
            </Button>
          </div>
        }
      />

      {/* Visible in BOTH tabs, which is why it is above the strip. */}
      <FlightTripFigures trip={trip} onShowFlights={() => setView("table")} />

      {/* Two ways to read one journey. The count is the second tab's name
          (owner: "when user taps the flights number"), so the number leads and
          the noun comes from the shared plural-aware summary label — "3
          Flights", or "1 Flight" for a single leg.

          The strip is the page's OWN furniture, the flight page's one
          difference from the roadtrip page that the owner asked for (a table
          behind a tab, 2026-10-08) — a roadtrip has no second view to hide. It
          is built like the band's labels (`t-label-mono`) and every other strip
          (`var(--ts-accent)`, a `--ts-space-*` margin), so it reads as this
          page's furniture rather than as a fourth design.

          Its first tab names the VIEW ("Route" — the timeline and the map),
          while the list under it is headed by its OWN noun ("Airports",
          `routeHeading`); the two are separate keys on purpose, so neither word
          drags the other along. */}
      <div
        role="tablist"
        aria-label={t("flights:journeyPage.tabsLabel")}
        className="flex items-center"
        style={{
          marginTop: "var(--ts-space-xl)",
          gap: "var(--ts-space-lg)",
          borderBottom: "1px solid var(--ts-border)",
        }}
      >
        <button
          type="button"
          role="tab"
          id="journey-tab-route"
          aria-selected={!showTable}
          className="t-label-mono"
          style={tabStyle(!showTable)}
          onClick={() => setView("route")}
        >
          {t("flights:journeyPage.tabRoute")}
        </button>
        <button
          type="button"
          role="tab"
          id="journey-tab-table"
          aria-selected={showTable}
          className="t-label-mono"
          style={tabStyle(showTable)}
          onClick={() => setView("table")}
        >
          {`${nf.format(flights.length)} ${t("common:summary.flights", {
            count: flights.length,
          })}`}
        </button>
      </div>

      {/*
        The body, one of two — the band and the tab strip above never unmount,
        and the title never changes across them.

        Route (default): the journey's airports in travel order with the
        flights between them on the left, a sticky framed `TripMap` on the
        right — the panel chrome copied from `RoadtripDetailPage` so the two
        detail pages read as the same page with different content.

        `?view=table`: the logbook's OWN table, locked to this trip through the
        extracted `FlightsTablePanel`, so a flight number still opens the
        flight's page exactly as it does at /flights.
      */}
      <div
        role="tabpanel"
        aria-labelledby={showTable ? "journey-tab-table" : "journey-tab-route"}
        style={{ marginTop: "var(--ts-space-xl)" }}
      >
        {showTable ? (
          <FlightsTablePanel
            lockedTripId={trip.id}
            heading={<h2 className="t-card-title">{t("flights:journeyPage.tableTitle")}</h2>}
            onChanged={() => void load()}
          />
        ) : (
          <div
            className="grid items-start lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]"
            style={{ gap: "var(--ts-space-xl)" }}
          >
            <section className="order-2 flex min-w-0 flex-col lg:order-1" style={{ gap: 8 }}>
              {/* The roadtrip body this mirrors heads its timeline with the
                  noun for its markers ("Stations"); a journey's markers are
                  airports, so the parallel heading is "Airports" — its own key,
                  not the tab's "Route", so changing one cannot silently change
                  the other. "Route" was the other candidate and was not taken:
                  it names the tab's idea, not the list's (owner, 2026-10-08). */}
              <h2 className="t-card-title">{t("flights:journeyPage.routeHeading")}</h2>
              <FlightLegTimeline
                flights={orderedFlights}
                selectedKey={selected?.key ?? null}
                onSelectStation={setSelected}
              />
            </section>

            <aside
              className="order-1 flex flex-col lg:sticky lg:order-2"
              style={{ gap: 8, top: DETAIL_MAP_STICKY_TOP }}
            >
              <div
                className="overflow-hidden"
                style={{
                  borderRadius: DETAIL_MAP_BOX_RADIUS,
                  border: "1px solid var(--ts-border)",
                  height: "min(640px, calc(100vh - 96px))",
                  minHeight: 380,
                }}
              >
                <TripMap trip={mapContent} extraLayers={highlight} />
              </div>
              {/* The noun differs from the roadtrip page's "station" only
                  because the markers do; the sentence, its punctuation and its
                  place under the map are the same. */}
              <span className="t-caption">{t("flights:journeyPage.tabMapHint")}</span>
            </aside>
          </div>
        )}
      </div>

      {editing && (
        <TripModal
          trip={trip}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}
