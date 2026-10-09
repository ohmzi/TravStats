import type { JSX } from "react";
import { Link } from "react-router-dom";

import CardMap, { type CardMapLine } from "../map/CardMap";
import {
  calculateDistance,
  getArcPeakAltitudeMeters,
  getArcSteps,
  greatCircleWaypoints,
} from "../Globe/arcUtils";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { useSettingsStore } from "../../store/settingsStore";
import { convertDistance, getDistanceLabel } from "../../lib/units";
import {
  distancePrefix,
  distinctAirports,
  journeyDistanceKm,
} from "../../lib/flights/journeyFigures";
import type { Flight } from "../../types";

/** The flights of one journey, as the card grid groups them. */
export interface FlightJourneyGroup {
  /** `tripId`, or a synthetic key for flights filed under no trip at all. */
  key: string;
  title: string;
  color?: string | null;
  /** Where the card opens — the journey's own page (`/flights/journeys/:tripId`). */
  href: string;
  flights: Flight[];
  /**
   * ISO alpha-2 codes the journey touches. Computed by the grouping rather
   * than here so the page's search can match a country without opening every
   * card to find out what it holds.
   */
  countries: string[];
}

/** The countries a set of flights touches — departure and arrival alike. */
export function countriesOfFlights(flights: Flight[]): string[] {
  const out = new Set<string>();
  for (const f of flights) {
    if (f.depCountry) out.add(f.depCountry);
    if (f.arrCountry) out.add(f.arrCountry);
  }
  return [...out].sort();
}

/** The great circle between a flight's two airports, as `[lon, lat]`. */
function arcOf(flight: Flight): Array<[number, number]> {
  const from: [number, number] = [flight.depLon, flight.depLat];
  const to: [number, number] = [flight.arrLon, flight.arrLat];
  const km =
    flight.routeDistance ??
    calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon);
  const waypoints = greatCircleWaypoints(
    from,
    to,
    getArcPeakAltitudeMeters(km),
    getArcSteps(km, false)
  );
  // The z the globe needs is meaningless on a flat map; x and y carry the curve.
  return waypoints.map(([lon, lat]) => [lon, lat] as [number, number]);
}

/**
 * One journey's flying, as a card (owner, 2026-10-08): every flight of the
 * journey overlaid on one map, because a journey's shape is the sum of its
 * legs — a single flight card answers "where did I go" with one line.
 *
 * The arcs are drawn on the card's own basemap through `CardMap`, which is the
 * same component the roadtrip cards use, so a flight and a drive read as the
 * same kind of thing on the same kind of ground.
 *
 * The card is one link to the journey's own page (`/flights/journeys/:id`),
 * which wears the journey's head and figures and keeps the table on its own
 * tab. Its distance comes from the same fold as that page's band
 * (`journeyDistanceKm`) and carries the same marker (`distancePrefix`), and its
 * airport count the same rule (`distinctAirports`), so a card a tap away from
 * the page cannot contradict it: a sum of great-circle chords is derived, and a
 * card that printed it bare while the band said `~` would pass a derived figure
 * off as a measured one.
 */
export default function FlightJourneyCard({
  group,
  locale,
}: {
  group: FlightJourneyGroup;
  locale: string;
}): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  const display = useDisplayFormat();
  const distanceUnit = useSettingsStore((state) => state.units.distanceUnit);

  const lines: CardMapLine[] = group.flights.map((f) => ({
    coords: arcOf(f),
    width: 1.6,
  }));

  // Both ends of every flight: an airport is where a journey touches down, and
  // drawing only the arcs leaves the eye without the places they connect.
  const airports = new Map<string, [number, number]>();
  for (const f of group.flights) {
    airports.set(f.depIata ?? f.depIcao ?? f.depName ?? "?", [f.depLon, f.depLat]);
    airports.set(f.arrIata ?? f.arrIcao ?? f.arrName ?? "?", [f.arrLon, f.arrLat]);
  }

  const distance = journeyDistanceKm(group.flights);
  const knownLegs = distance.derivedLegs + distance.liveLegs;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  // The value and the marker come from the SAME rules the page band uses —
  // `distancePrefix` for the `~`/`≈`, and `convertDistance` for the reader's
  // unit — so the card a tap away from the page cannot print a different number
  // for the same journey. A leg that could give no distance lowers the sum,
  // which `distancePrefix` marks `≈`; the reason rides the cell's title.
  const kmText =
    knownLegs === 0
      ? "—"
      : `${distancePrefix(distance)}${nf.format(convertDistance(distance.km, distanceUnit))}`;
  const kmTitle =
    knownLegs === 0
      ? t("flights:journeyPage.figDistanceNone")
      : distance.unknownLegs > 0
        ? t("flights:journeyPage.figDistanceSubLower", { count: distance.unknownLegs })
        : distance.derivedLegs > 0
          ? t("flights:journeyPage.figDistanceSub")
          : t("flights:journeyPage.figDistanceMeasured");
  const times = group.flights
    .map((f) => f.departureTime)
    .filter((d): d is string => Boolean(d))
    .sort();
  const span =
    times.length > 0
      ? [times[0], times[times.length - 1]]
          .map((d) => display.date(d, { timeZone: "UTC" }))
          .filter((d, i, all) => all.indexOf(d) === i)
          .join(" – ")
      : null;

  return (
    <Link
      to={group.href}
      className="flex flex-col overflow-hidden"
      style={{
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <CardMap
        lines={lines}
        stops={[...airports.values()].map((coord) => ({ coord, radius: 2.4 }))}
      />
      <div
        className="flex flex-col"
        style={{ padding: "var(--ts-space-lg)", gap: "var(--ts-space-sm)" }}
      >
        <span style={{ fontSize: 17, fontWeight: 800, color: "var(--ts-text-bright)" }}>
          {group.title}
        </span>
        {span && <span className="t-caption">{span}</span>}
        <div
          className="grid grid-cols-3"
          style={{
            gap: "var(--ts-space-sm)",
            paddingTop: "var(--ts-space-sm)",
            borderTop: "1px solid var(--ts-border)",
          }}
        >
          <span className="flex flex-col">
            <span className="t-meta-mono" style={{ fontSize: 15, fontWeight: 600 }}>
              {nf.format(group.flights.length)}
            </span>
            <span className="t-caption">
              {t("flights:journeyCard.flights", { count: group.flights.length })}
            </span>
          </span>
          <span className="flex flex-col">
            <span className="t-meta-mono" style={{ fontSize: 15, fontWeight: 600 }}>
              {nf.format(distinctAirports(group.flights))}
            </span>
            <span className="t-caption">{t("flights:journeyCard.airports")}</span>
          </span>
          <span className="flex flex-col">
            <span className="t-meta-mono" style={{ fontSize: 15, fontWeight: 600 }} title={kmTitle}>
              {kmText}
            </span>
            <span className="t-caption">{getDistanceLabel(distanceUnit, t)}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
