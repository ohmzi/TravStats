import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { flightDeparture } from "../../lib/entityTimes";
import { flightDurationOf } from "../../shared/flightDuration";
import { formatDurationWithEstimate } from "../../lib/formatters";
import { flightDateFmt } from "./flightDateFormat";
import type { Trip } from "../../types";

/**
 * The fields this timeline reads out of one of the journey's flights. The trip
 * endpoint's own `Pick` (`GET /trips/:id`) is exactly this shape, so the page
 * hands over what the wire carries rather than a full `Flight` it does not
 * have.
 */
export type TripLegFlight = NonNullable<Trip["flights"]>[number];

/**
 * One airport on the journey, as the timeline draws it. `key` is how the row
 * is told apart on the map — its IATA where there is one, its coordinate
 * otherwise — so a chain landing at the same field twice is one station.
 */
export interface AirportStation {
  key: string;
  iata: string | null;
  name: string | null;
  lat: number;
  lon: number;
}

/** The origin end of a leg, in the shape the timeline draws. */
function departureStation(f: TripLegFlight): AirportStation {
  return {
    key: f.depIata ?? `${f.depLat},${f.depLon}`,
    iata: f.depIata ?? null,
    name: f.depName ?? null,
    lat: f.depLat,
    lon: f.depLon,
  };
}

/** The destination end of a leg. */
function arrivalStation(f: TripLegFlight): AirportStation {
  return {
    key: f.arrIata ?? `${f.arrLat},${f.arrLon}`,
    iata: f.arrIata ?? null,
    name: f.arrName ?? null,
    lat: f.arrLat,
    lon: f.arrLon,
  };
}

/**
 * A journey read as a route (owner, 2026-10-08), the way the roadtrip page
 * reads a roadtrip: stations in travel order with the leg between them, and a
 * map beside it that rings the station you pick.
 *
 * A STATION here is an AIRPORT and a LEG is a FLIGHT. That is the whole
 * difference from `StationTimeline`, which is why this is a parallel row and
 * not a generalisation of it: a drive has a mode, a distance and a duration
 * the road router worked out, while a flight has an airline, a number and a
 * departure — and the leg between two airports is a row of the logbook, which
 * is what its link opens.
 *
 * The flights arrive ALREADY ORDERED (`lib/flightLegSort`, the same rule the
 * table's tripped group uses), because the map beside this draws the same
 * rows and the two must not disagree about which leg came first.
 */
export default function FlightLegTimeline({
  flights,
  selectedKey,
  onSelectStation,
}: {
  /** The journey's flights, in travel order — `sortFlightsByLegOrder`'d by the caller. */
  flights: readonly TripLegFlight[];
  /** The station the page is ringing on the map, if any. */
  selectedKey: string | null;
  /** A station was picked; `null` clears the selection. */
  onSelectStation: (station: AirportStation | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);

  if (flights.length === 0) {
    return <p className="t-caption">{t("flights:journeyPage.routeEmpty")}</p>;
  }

  // Walk the legs, drawing each end once: an airport that is one leg's arrival
  // and the next leg's departure is ONE station, not two rows sharing a name.
  const rows: JSX.Element[] = [];
  let drawnKey: string | null = null;
  flights.forEach((flight, index) => {
    const departure = departureStation(flight);
    if (departure.key !== drawnKey) {
      rows.push(
        <StationRow
          key={`dep-${index}-${departure.key}`}
          station={departure}
          selected={departure.key === selectedKey}
          onSelect={() => onSelectStation(departure.key === selectedKey ? null : departure)}
        />
      );
      drawnKey = departure.key;
    }
    rows.push(<LegRow key={`leg-${flight.id}`} flight={flight} />);
    const arrival = arrivalStation(flight);
    if (arrival.key !== drawnKey) {
      rows.push(
        <StationRow
          key={`arr-${index}-${arrival.key}`}
          station={arrival}
          selected={arrival.key === selectedKey}
          onSelect={() => onSelectStation(arrival.key === selectedKey ? null : arrival)}
        />
      );
      drawnKey = arrival.key;
    }
  });

  return (
    <ol className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows}
    </ol>
  );
}

/**
 * One airport in the chain. A button, because picking it rings it on the map —
 * the same bargain a roadtrip station makes — and pressing it again lets go.
 */
function StationRow({
  station,
  selected,
  onSelect,
}: {
  station: AirportStation;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  return (
    <li
      className="grid"
      style={{
        gridTemplateColumns: "32px minmax(0, 1fr)",
        gap: 10,
        padding: "10px 12px 10px 0",
        borderRadius: "var(--ts-radius-button)",
        background: selected ? "var(--domain-flight-soft)" : "transparent",
        boxShadow: selected
          ? "inset 0 0 0 1px color-mix(in srgb, var(--domain-flight) 35%, transparent)"
          : undefined,
      }}
    >
      <div className="flex justify-center" style={{ paddingTop: 4 }}>
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            boxSizing: "border-box",
            background: "var(--domain-flight)",
            border: selected
              ? "2px solid var(--ts-text-bright)"
              : "2px solid color-mix(in srgb, var(--domain-flight) 30%, transparent)",
          }}
        />
      </div>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex flex-wrap items-baseline text-left"
        style={{
          gap: 8,
          background: "none",
          border: 0,
          padding: 0,
          color: "inherit",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontFamily: "var(--ts-font-mono)",
            fontSize: 16,
            fontWeight: 800,
            color: "var(--ts-text-bright)",
          }}
        >
          {station.iata ?? station.name ?? t("common:labels.unknown")}
        </span>
        {station.iata && station.name && <span className="t-caption">{station.name}</span>}
      </button>
    </li>
  );
}

/**
 * The flight between two stations — one row of the logbook, drawn as the edge
 * of the route. Its duration is `getFlightDuration`'s rule, so a DATE_ONLY leg
 * reads `~` here exactly as it does in the table.
 */
function LegRow({ flight }: { flight: TripLegFlight }): JSX.Element {
  const duration = flightDurationOf({
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    depTimeSemantics: flight.depTimeSemantics,
    depLat: flight.depLat ?? null,
    depLon: flight.depLon ?? null,
    arrLat: flight.arrLat ?? null,
    arrLon: flight.arrLon ?? null,
  });
  const departure = flightDeparture(flight);
  const date = departure ? flightDateFmt(departure) : null;
  const identity = [flight.flightNumber, flight.airline].filter(Boolean).join(" · ");
  const route = `${flight.depIata ?? "?"} → ${flight.arrIata ?? "?"}`;

  return (
    <li
      className="grid items-center"
      style={{ gridTemplateColumns: "32px minmax(0, 1fr)", gap: 10, minHeight: 40 }}
    >
      <div className="flex justify-center self-stretch">
        <div
          style={{
            width: 2,
            borderRadius: 2,
            background: "var(--domain-flight)",
            opacity: 0.55,
          }}
        />
      </div>
      <Link
        to={`/flights/${flight.id}`}
        className="flex flex-wrap items-center"
        style={{ gap: 10, fontSize: 13, color: "var(--ts-muted)", textDecoration: "none" }}
      >
        <span style={{ color: "var(--ts-text-bright)", fontWeight: 700 }}>{identity || route}</span>
        <span className="t-meta-mono">{route}</span>
        {date && <span className="t-caption">{date}</span>}
        {duration && (
          <span className="t-meta-mono">
            {formatDurationWithEstimate(duration.minutes, duration.estimated)}
          </span>
        )}
      </Link>
    </li>
  );
}
