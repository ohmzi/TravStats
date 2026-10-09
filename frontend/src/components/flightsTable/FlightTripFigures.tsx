import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";

import FigureBand, { type FigureBandCell } from "../ui/FigureBand";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { formatDistance, localeForLanguage } from "../../lib/units";
import {
  distancePrefix,
  distinctAirports,
  distinctCities,
  journeyDistanceKm,
  journeyNights,
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
 *  - the NIGHTS are the journey's SPAN — from the day it left to the day it
 *    came back to the city it left from, or to the last arrival of a one-way
 *    (owner, 2026-10-08). They are emphatically NOT the sum of its recorded
 *    stays: that was the old rule and it is gone. A journey with no dated leg
 *    to measure is a dash with its reason, never a fabricated number and never
 *    `days − 1`; the fold is `journeyFigures.journeyNights`, shared with the
 *    journey card so the two cannot disagree about the same journey.
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
  const nights = journeyNights(flights);
  const knownLegs = distance.liveLegs + distance.derivedLegs;

  // The band owns the MARKER, not the number: `distancePrefix` is shared with
  // the journey card, so `~` (derived) and `≈` (lower bound) mean the same on
  // both, and `units.formatDistance` owns the reader's unit and separators. A
  // journey with no leg distance at all is a dash with its reason, never a zero.
  const distanceValue: ReactNode =
    knownLegs === 0
      ? "—"
      : `${distancePrefix(distance)}${formatDistance(distance.km, distanceUnit, t, i18n.language)}`;

  const nightsValue = nights === null ? "—" : nf.format(nights);
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

  const figures: FigureBandCell[] = [
    {
      key: "distance",
      // "Distance covered", not the roadtrip band's "Driven": a plane is not
      // driven, and this figure is a DERIVED great-circle sum, so its word has
      // to stay distinct from the roadtrip's measured/planned one — the reason
      // is on the caption and on hover (owner, 2026-10-08). The roadtrip's own
      // neutral word is "Distance" (`roadtrips:detail.figRoute`), the candidate
      // if one word is ever wanted for both.
      label: t("flights:journeyPage.figDistance"),
      value: distanceValue,
      title: distanceTitle,
    },
    {
      key: "nights",
      label: t("flights:journeyPage.figNights"),
      value: nightsValue,
      title: nights === null ? t("flights:journeyPage.figNightsNone") : undefined,
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
      // logbook strip cannot disagree. zero prints as `0`, not a dash: the
      // COUNT of the journey's own recorded legs is a fact about the record —
      // an empty journey really has none — while the derived figures above are
      // dashes with a reason, because "we cannot work it out" is not "none".
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
      // The same words as the roadtrip band's two cells (see its header): one
      // `common:` key set, so the two bands cannot label the same thing twice.
      label: t("common:summary.journey"),
      value: trip.name ? (
        <Link to={`/trips/${trip.id}`}>{trip.name}</Link>
      ) : (
        t("common:labels.notAvailable")
      ),
    },
    {
      key: "album",
      label: t("common:summary.album"),
      value: album ? (
        <Link to={`/trips/${trip.id}?tab=gallery`}>{album.albumName}</Link>
      ) : (
        t("common:labels.notAvailable")
      ),
      sub: album ? t("common:summary.albumSub", { count: album.assetCount }) : undefined,
    },
  ];

  return (
    <FigureBand
      cells={figures}
      // Seven cells, two / four / seven. The trailing seventh spans its row's
      // remainder (see `FigureBand.spanClasses`); four across `sm` keeps the
      // band TWO rows, the shape the roadtrip band has.
      columns={[2, 4, 7]}
      caption={
        <>
          {/* Shown whenever the sum is DERIVED, even when a leg is also missing:
              the `~` on the value marks the derivation, and dropping this
              caption the moment one leg had no distance would leave the
              derivation stated only on hover (owner, 2026-10-08). The marker
              stays: the roadtrip band has none because its distance is
              measured or routed, and matching its look must never mean
              dropping this one. */}
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
        </>
      }
    />
  );
}
