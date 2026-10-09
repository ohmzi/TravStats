import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";

import FlightFigures, { type FlightFigureCell } from "./FlightFigures";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { formatDistance, localeForLanguage } from "../../lib/units";
import {
  distancePrefix,
  distinctAirports,
  distinctCities,
  journeyDistanceKm,
  nightsFromStays,
} from "../../lib/flights/journeyFigures";
import type { Trip } from "../../types";

/**
 * A journey's figures, as the roadtrip band draws the roadtrip's (owner,
 * 2026-10-08): distance, nights, cities, airports, flights, then the journey
 * and its album as entry points. The pure folding lives in
 * `lib/flights/journeyFigures.ts`; this only turns it into cells, so the rules
 * can be tested without rendering.
 *
 * THREE THINGS ARE NOT FIGURES AND ARE NOT ZEROS:
 *
 *  - the DISTANCE is a sum of great-circle chords, never a flown path, so it
 *    is marked `~` and reads "at least" (`≈`) when a leg had no distance to
 *    give — one rule, `journeyFigures.distancePrefix`, shared with the journey
 *    card. A journey with no leg distance at all is a dash with its reason, not
 *    a zero.
 *  - the CITIES figure is DELIBERATELY different from airports (owner,
 *    2026-10-08): two airports in one city are one city and two airports. It
 *    comes from the catalogue's own city, so a partial lookup is a lower bound
 *    and the caption says by how many airports.
 *  - the NIGHTS are the journey's recorded stays, and a journey with no stay
 *    is a dash with its reason — never the calendar span, never `days − 1`,
 *    which the owner has not ruled on (open question, 2026-10-08).
 *
 * `onShowFlights` is the owner's "tap the flights number": the flights cell is
 * a button, not a link, because it swaps the page's BODY in place rather than
 * navigating (`?view=table`, the same word the logbook already uses).
 */
export default function FlightTripFigures({
  trip,
  onShowFlights,
}: {
  trip: Trip;
  onShowFlights: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["flights", "common"]);
  const distanceUnit = useSettingsStore((state) => state.units.distanceUnit);
  const locale = localeForLanguage(i18n.language);
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  const flights = trip.flights ?? [];
  const album = trip.immichAlbums?.[0] ?? null;
  const distance = journeyDistanceKm(flights);
  const cities = distinctCities(flights);
  const airports = distinctAirports(flights);
  const nights = nightsFromStays(trip.lodgingStays ?? []);
  const knownLegs = distance.liveLegs + distance.derivedLegs;

  // The band owns the MARKER, not the number: `distancePrefix` is shared with
  // the journey card, so `~` (derived) and `≈` (lower bound) mean the same on
  // both, and `units.formatDistance` owns the reader's unit and separators. A
  // journey with no leg distance at all is a dash with its reason, never a zero.
  const distanceValue: ReactNode =
    knownLegs === 0
      ? "—"
      : `${distancePrefix(distance)}${formatDistance(distance.km, distanceUnit, t, i18n.language)}`;

  const nightsValue = nights ? `${nights.approximate ? "≈ " : ""}${nf.format(nights.nights)}` : "—";
  const citiesValue = cities.count === 0 ? "—" : nf.format(cities.count);

  // A dash's reason belongs on hover (owner, 2026-10-08) — never a zero, and
  // never a number the data cannot support. The title names what the sum is:
  // nothing (no leg distance), chords (derived), or a recorded track (measured).
  const distanceTitle =
    knownLegs === 0
      ? t("flights:journeyPage.figDistanceNone")
      : distance.derivedLegs > 0
        ? t("flights:journeyPage.figDistanceTitle", {
            derived: distance.derivedLegs,
            live: distance.liveLegs,
          })
        : t("flights:journeyPage.figDistanceMeasured");

  const figures: FlightFigureCell[] = [
    {
      key: "distance",
      label: t("flights:journeyPage.figDistance"),
      value: distanceValue,
      title: distanceTitle,
    },
    {
      key: "nights",
      label: t("flights:journeyPage.figNights"),
      value: nightsValue,
      sub: nights ? t("flights:journeyPage.figNightsSub", { count: nights.stays }) : undefined,
      title: nights
        ? nights.approximate
          ? t("flights:journeyPage.figNightsApprox")
          : undefined
        : t("flights:journeyPage.figNightsNone"),
    },
    {
      key: "cities",
      label: t("flights:journeyPage.figCities"),
      value: citiesValue,
      title: cities.count === 0 ? t("flights:journeyPage.figCitiesNone") : undefined,
    },
    {
      key: "airports",
      // The one existing rule (distinct IATA), reused so the band and the
      // logbook strip cannot disagree.
      label: t("common:summary.airports", { count: airports }),
      value: nf.format(airports),
    },
    {
      key: "flights",
      label: t("common:summary.flights", { count: flights.length }),
      // A button, not a link: it swaps the body in place rather than leaving
      // the page, so Back leaves the journey instead of toggling a tab.
      value: (
        <button
          type="button"
          onClick={onShowFlights}
          className="underline underline-offset-4"
          style={{
            background: "none",
            border: 0,
            padding: 0,
            cursor: "pointer",
            font: "inherit",
            color: "var(--ts-accent)",
          }}
        >
          {nf.format(flights.length)}
        </button>
      ),
    },
    {
      key: "journey",
      label: t("flights:journeyPage.figJourney"),
      value: trip.name ? (
        <Link to={`/trips/${trip.id}`}>{trip.name}</Link>
      ) : (
        t("common:labels.notAvailable")
      ),
    },
    {
      key: "album",
      label: t("flights:journeyPage.figAlbum"),
      value: album ? (
        <Link to={`/trips/${trip.id}?tab=gallery`}>{album.albumName}</Link>
      ) : (
        t("common:labels.notAvailable")
      ),
      sub: album ? t("flights:journeyPage.figAlbumSub", { count: album.assetCount }) : undefined,
    },
  ];

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <FlightFigures figures={figures} responsive={7} />
      {/* The caveats the band is making, said once, in the roadtrip band's own
          voice: what the distance is made of, and what the city count leaves
          out. Cell titles say the same thing on hover. */}
      <div className="flex flex-wrap items-center t-caption" style={{ gap: "var(--ts-space-lg)" }}>
        {/* Shown whenever the sum is DERIVED, even when a leg is also missing:
            the `~` on the value marks the derivation, and dropping this caption
            the moment one leg had no distance would leave the derivation stated
            only on hover (owner, 2026-10-08). */}
        {knownLegs > 0 && distance.estimated && (
          <span>{t("flights:journeyPage.figDistanceSub")}</span>
        )}
        {knownLegs > 0 && distance.unknownLegs > 0 && (
          <span>
            {t("flights:journeyPage.figDistanceSubLower", { count: distance.unknownLegs })}
          </span>
        )}
        {cities.airportsWithoutCity > 0 && (
          <span>
            {t("flights:journeyPage.figCitiesSub", { count: cities.airportsWithoutCity })}
          </span>
        )}
        {nights?.approximate && <span>{t("flights:journeyPage.figNightsApprox")}</span>}
      </div>
    </div>
  );
}
