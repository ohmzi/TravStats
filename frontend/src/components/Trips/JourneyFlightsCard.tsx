import type { JSX } from "react";
import { Link } from "react-router-dom";

import { Figure, useRoadtripSpan } from "../Roadtrips/RoadtripCard";
import CardMap, { type CardMapLine, type CardMapStop } from "../map/CardMap";
import { Icon } from "../ui/Icon";
import {
  calculateDistance,
  getArcPeakAltitudeMeters,
  getArcSteps,
  greatCircleWaypoints,
} from "../Globe/arcUtils";
import { useTranslation } from "../../hooks/useTranslation";
import {
  distancePrefix,
  isRealEndpoint,
  journeyDays,
  journeyDistanceKm,
  type JourneyFlight,
} from "../../lib/flights/journeyFigures";

/**
 * One leg's drawn line: the great circle between its two airports as
 * `[lon, lat]` — the logbook journey card's own arc (`FlightJourneyCard.arcOf`
 * over `Globe/arcUtils`), so one journey reads the same shape on both cards —
 * or `null` for a leg the app stored without a real endpoint.
 *
 * A LEG WITH NO POSITION AT EITHER END IS SKIPPED, NOT DRAWN TO NULL ISLAND.
 * An airport the catalogue never resolved is stored as (0,0), not as a null
 * (`isRealEndpoint`); the distance fold already refuses to measure such a leg
 * and `TripMap` draws no arc for it. The map here obeys the same rule rather
 * than inventing a second one.
 *
 * DASHED IS THE FLIGHT DOMAIN'S OWN "UPCOMING": a leg whose status is
 * `"scheduled"` has not been flown — the whole flight domain reads exactly
 * that (`routesLayer`, `globeArcData`, `tripMapColors`: `status ===
 * "scheduled"`) — while a flown or historical leg stays solid. The dash is
 * what a card line says for a trip that has not happened (`CardMap.dashed`,
 * and the roadtrip card beside this one dashing its planned phase); the
 * dashboard's own flight map cannot draw it at all (deck.gl has no dash on
 * arcs, `statusColors.PLANNED_STROKE_IS_DASHED`), so where the card's SVG can,
 * the dash says what the map can only colour.
 */
function legLine(flight: JourneyFlight): CardMapLine | null {
  if (
    !isRealEndpoint(flight.depLat, flight.depLon) ||
    !isRealEndpoint(flight.arrLat, flight.arrLon)
  ) {
    return null;
  }
  const km =
    flight.routeDistance ??
    calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon);
  return {
    coords: greatCircleWaypoints(
      [flight.depLon, flight.depLat],
      [flight.arrLon, flight.arrLat],
      getArcPeakAltitudeMeters(km),
      getArcSteps(km, false)
    ).map(([lon, lat]) => [lon, lat] as const),
    width: 1.6,
    dashed: flight.status === "scheduled",
  };
}

/**
 * Every distinct airport the legs touch, one dot per position — the roadtrip
 * cards' own stations rule, so the arcs meet on the airports the way a routed
 * roadtrip's line meets its stations. Deduped by the coordinate itself: the
 * two legs that land at, or leave from, one airport read the same catalogue
 * position, so the key is exact. A sentinel end draws no dot (there is no
 * position to draw), but the other end of a broken leg is still a place the
 * journey touched and keeps its own.
 */
function airportStops(flights: readonly JourneyFlight[]): CardMapStop[] {
  const stops = new Map<string, CardMapStop>();
  for (const flight of flights) {
    const ends = [
      [flight.depLat, flight.depLon],
      [flight.arrLat, flight.arrLon],
    ] as const;
    for (const [lat, lon] of ends) {
      if (!isRealEndpoint(lat, lon)) continue;
      // The radius the logbook journey card gives its airports.
      stops.set(`${lon},${lat}`, { coord: [lon, lat], radius: 2.4 });
    }
  }
  return [...stops.values()];
}

/**
 * The journey's flights as a trip of its own, in the Trips tab (owner,
 * 2026-10-12: "why is St.Johns Newfoundland 2026 journey not showing the
 * flight in the trips"). One link to the flights' own page
 * (`/flights/journeys/:tripId`), drawn in the roadtrip cards' grid and their
 * card furniture (surface, radius, a three-figure row) so the tab reads as one
 * list of the journey's trips, with the flights' own affordance: the plane
 * icon in the flight domain's colour beside the word.
 *
 * THE MAP IS THE ROADTRIP CARDS' MAP, DRAWN FROM THIS CARD'S OWN FLIGHTS
 * (owner, 2026-10-12: the journey's Trips tab drew the flights card "showing
 * the thumbnail of flight as blank" where the roadtrip cards beside it drew
 * their routes). One line per leg over the same `CardMap` as the cards beside
 * it, and a dot on every distinct airport, so a flight reads as one more trip
 * in the same grid (`legLine`, `airportStops` above) — nothing else about the
 * card moves: one link, the same figures, the same affordance.
 *
 * THE FIGURES ARE THE FLIGHTS BAND'S OWN FOLDS, NOT NEW ONES. The distance is
 * `journeyDistanceKm` carrying `distancePrefix`, so `~` (a sum of derived
 * great-circle chords) and `≈` (a leg gave no distance) mean here what they
 * mean on the band and on the logbook's journey card; the reasons ride the
 * cell's `title` (the card has no caption row — `FlightJourneyCard`'s rule,
 * reused, including its order: a missing leg's "at least this much" outranks
 * the derivation note). The days are `journeyDays` — the journey's SPAN, both
 * ends inclusive — and a journey with no dated leg is a dash with its reason.
 * The third figure is the flight count, which is what the owner's "the flight
 * in the trips" means: the tab counts each leg it holds.
 *
 * The km is printed in kilometres, like the band's two Km cells and the
 * roadtrip cards beside it in this grid; the flights band and the logbook card
 * convert to the reader's unit (`units.formatDistance`) and stay as they are —
 * a card in a grid prints what its neighbours print.
 *
 * The span is the first and last departure day (the logbook journey card's own
 * rule, `FlightJourneyCard`), shown through `useRoadtripSpan` — the roadtrip
 * cards' OWN span builder (year written once, `display.date` on the UTC day) —
 * so one tab cannot spell two spans two ways; a journey whose legs carry no
 * departure draws no span line rather than an invented date.
 */
export default function JourneyFlightsCard({
  tripId,
  flights,
}: {
  tripId: string;
  flights: readonly JourneyFlight[];
}): JSX.Element {
  const { t, i18n } = useTranslation(["flights", "common", "trips"]);
  const span = useRoadtripSpan();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });

  const lines = flights.map(legLine).filter((line): line is CardMapLine => line !== null);
  const stops = airportStops(flights);
  const distance = journeyDistanceKm(flights);
  const knownLegs = distance.liveLegs + distance.derivedLegs;
  const days = journeyDays(flights);
  const departures = flights
    .map((f) => f.departureTime)
    .filter((d): d is string => Boolean(d))
    .sort();

  // The band's value rule, reused: a dash for "no leg distance at all", the
  // `~`/`≈` prefix otherwise — never a bare sum that would read as measured.
  const kmText = knownLegs === 0 ? "—" : `${distancePrefix(distance)}${nf.format(distance.km)}`;
  const kmTitle =
    knownLegs === 0
      ? t("flights:journeyPage.figDistanceNone")
      : distance.unknownLegs > 0
        ? t("flights:journeyPage.figDistanceSubLower", { count: distance.unknownLegs })
        : distance.derivedLegs > 0
          ? t("flights:journeyPage.figDistanceSub")
          : t("flights:journeyPage.figDistanceMeasured");

  return (
    <Link
      to={`/flights/journeys/${tripId}`}
      className="flex flex-col overflow-hidden transition-colors hover:border-[var(--ts-muted)]"
      style={{
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <CardMap lines={lines} stops={stops} />
      <div
        className="flex flex-1 flex-col"
        style={{ padding: "var(--ts-space-lg)", gap: "var(--ts-space-sm)" }}
      >
        <span
          className="flex items-center"
          style={{
            gap: 8,
            fontSize: 17,
            fontWeight: 800,
            color: "var(--ts-text-bright)",
          }}
        >
          <Icon name="plane" size={16} style={{ color: "var(--domain-flight)" }} />
          {t("common:summary.flights", { count: flights.length })}
        </span>
        {departures.length > 0 && (
          <span className="t-caption">
            {span({ startDate: departures[0], endDate: departures[departures.length - 1] })}
          </span>
        )}
        <div
          className="grid grid-cols-3"
          style={{
            gap: "var(--ts-space-sm)",
            paddingTop: "var(--ts-space-sm)",
            borderTop: "1px solid var(--ts-border)",
          }}
        >
          <Figure value={kmText} label={t("trips:figures.kmFlown")} title={kmTitle} />
          <Figure
            value={days === null ? "—" : nf.format(days)}
            label={t("common:summary.cardDays", { count: days ?? 0 })}
            title={days === null ? t("flights:journeyPage.figDaysNone") : undefined}
          />
          <Figure
            value={nf.format(flights.length)}
            label={t("common:summary.flights", { count: flights.length })}
          />
        </div>
      </div>
    </Link>
  );
}
