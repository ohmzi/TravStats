import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";

import FigureBand, { type FigureBandCell } from "../ui/FigureBand";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { ownDatesDays, roadtripsDrivenKm, type DrivenKms } from "../../lib/entityFigures";
import {
  distancePrefix,
  journeyDistanceKm,
  type JourneyFlight,
} from "../../lib/flights/journeyFigures";
import { tripEnd, tripStart } from "../../lib/entityTimes";
import { albumForRoadtrip } from "../../lib/roadtrip/roadtripAlbum";
import {
  daysAhead,
  omitStartYear,
  roadtripDays,
  roadtripPhase,
  spanDays,
} from "../../lib/roadtrip/roadtripView";
import type { Trip } from "../../types";
import type { RoadtripDetail } from "../../types/roadtrip";

/** The journey's half: its own row, plus the trips it holds. */
interface JourneyFiguresProps {
  level: "journey";
  trip: Trip;
  /**
   * The journey's trips — `useTripRoadtrips` today. Narrow on purpose (the km
   * and the count are the figures this band reads), so any roadtrip row shape
   * fits; `id` is the one addition, and optional — it is what turns the Km cell
   * into a link when the journey holds EXACTLY ONE roadtrip (`journeyKmTarget`).
   * A caller that hands rows of bare kms still fits and the cell then falls
   * back to the journey's Trips tab rather than guess a target.
   */
  roadtrips: readonly (DrivenKms & { id?: string })[];
  /**
   * The journey's flights, as `trip.flights` carries them — narrow on purpose
   * like `roadtrips`, so the band reads only the fields the flights fold needs
   * (`JourneyFlight`). The page hands them down from the trip it already
   * loaded (`tripsApi.getById`), so the band adds no fetch of its own.
   */
  flights: readonly JourneyFlight[];
}

/** The trip's half: the detail DTO the roadtrip page already loads. */
interface TripFiguresProps {
  level: "trip";
  detail: RoadtripDetail;
  today: string;
}

export type EntityFiguresProps = JourneyFiguresProps | TripFiguresProps;

/**
 * "18.09. – 28.09.2026" — the entity's own from–to, the year written once when
 * both ends share it (`omitStartYear`, the card's own rule — the two surfaces
 * print one span one way), a single date when the two days are the same. Dates
 * are calendar days (`YYYY-MM-DD…`), shown as the place knew them
 * (`localDate`), never moved by the reader's zone.
 */
function datesText(
  display: ReturnType<typeof useDisplayFormat>,
  start: string,
  end: string
): string {
  const from = start.slice(0, 10);
  const to = end.slice(0, 10);
  if (from === to) return display.localDate(from);
  return `${display.localDate(from, { omitYear: omitStartYear(from, to) })} – ${display.localDate(to)}`;
}

/**
 * The shared figures table (design 2026-10-12 §2), keyed by level: the same
 * band both pages draw, with the level's own cells.
 *
 * - Journey (design §2, owner 2026-10-12): Dates (from–to) · Days · Km (the
 *   SUM of its trips' driven km) · Km flown (the SUM of its flights',
 *   `journeyDistanceKm`) · Countries · Trips (the roadtrips PLUS the flights,
 *   which are one trip of the journey) · Albums (count).
 * - Trip (design §2): Dates (from–to) · Driven km · Days · Slept in ·
 *   Countries · Journey (link back) · Album — the trip's OWN album when the
 *   journey links it (`albumForRoadtrip`, the pitstop rule), the journey's
 *   first otherwise; the cell links to the TRIP's Gallery tab, which resolves
 *   the same album.
 *
 * The folds live in `lib/entityFigures.ts` (the sums, the days) and in the
 * level's own modules (`roadtripView.roadtripDays`, `roadtripAlbum`), so the
 * band is only cells. A FIGURE THAT CANNOT BE DERIVED IS LEFT OUT — an
 * undated entity draws no Dates, and with it no Days — while a cell that is an
 * ENTRY POINT (the journey, its album) is always drawn, saying "N/A" when
 * there is nothing to point at, because an absent entry point and a hidden
 * one read the same otherwise. The Km FLOWN cell follows the flights band's
 * own choice for "no distance at all" (`FlightTripFigures`): it is drawn, and
 * a journey with no leg distance reads a dash with its reason on hover — a
 * hidden cell would read as "no flights" and a zero as "none at all", and
 * only one of those is true.
 *
 * The trip band's caption keeps its odometer and its no-routing note (the
 * page's own facts, not copy); the "Re-sync from Immich" link that used to
 * ride here moved to the trip's edit page (design §4: the headers lose their
 * standalone Edit/Delete/Re-sync, and the edit page carries them).
 *
 * THE BAND IS NAVIGATION NOW (owner request 2026-10-14): each figure that names
 * a surface is a `Link` to it — Days→Timeline, Countries→Map, Trips→Trips,
 * Albums→Gallery on the journey; Driven/Countries→Map, Days/Places→Timeline on
 * the trip. A cell with no sensible target keeps today's plain rendering rather
 * than link to nowhere: the journey's Km falls back to its Trips tab only when
 * the sum spans several roadtrips (Ruling 1), and the Albums cell stays a plain
 * count with no album linked. The link's TEXT stays the figure the cell already
 * showed, so the accessible name is unchanged and the band's `title` (on the
 * wrapper) still carries the reason on hover.
 */
export default function EntityFigures(props: EntityFiguresProps): JSX.Element {
  return props.level === "journey" ? (
    <JourneyFigures trip={props.trip} roadtrips={props.roadtrips} flights={props.flights} />
  ) : (
    <TripFigures detail={props.detail} today={props.today} />
  );
}

/* ─────────── The journey's cells ─────────── */

/**
 * Where the journey's Km cell points (owner request 2026-10-14, controller
 * Ruling 1). The journey's Km is a SUM over its roadtrips
 * (`roadtripsDrivenKm`), so there is rarely one "road trip page" it names:
 *
 *  - EXACTLY ONE roadtrip with an id → that roadtrip's page;
 *  - several → the journey's own Trips tab, where every roadtrip is listed;
 *  - NONE (or a lone row with no id) → `null`, and the cell keeps today's plain
 *    figure. With no roadtrip the Trips tab holds nothing of the journey's own
 *    to show, and the owner's rule is that a link to nowhere useful is worse
 *    than no link. Never a dead link, never a guess.
 */
function journeyKmTarget(
  trip: Trip,
  roadtrips: readonly (DrivenKms & { id?: string })[]
): string | null {
  if (roadtrips.length === 0) return null;
  if (roadtrips.length === 1) {
    const id = roadtrips[0].id;
    return id ? `/roadtrips/${id}` : `/trips/${trip.id}?tab=trips`;
  }
  return `/trips/${trip.id}?tab=trips`;
}

function JourneyFigures({
  trip,
  roadtrips,
  flights,
}: Omit<JourneyFiguresProps, "level">): JSX.Element {
  const { t, i18n } = useTranslation(["trips", "common", "flights"]);
  const display = useDisplayFormat();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });

  const start = tripStart(trip);
  const end = tripEnd(trip);
  const days = ownDatesDays(start, end);
  // A stored list can hold the same country twice (the backend returns the
  // user-filled list untouched — the journey head's own finding); fold it, so
  // the count agrees with the names beside it.
  const countries = [...new Set(trip.countries)];
  const albums = trip.immichAlbums ?? [];
  const km = roadtripsDrivenKm(roadtrips);
  const flown = journeyDistanceKm(flights);
  const knownLegs = flown.liveLegs + flown.derivedLegs;
  // The journeys list compares journeys by their flown + cruise + driven total
  // (`TripCard.estimateTripDistanceKm` + the journey's route km — untouched);
  // the band's two Km cells are that total's roadtrip and flight halves.
  const tripCount = roadtrips.length + (flights.length > 0 ? 1 : 0);
  // The Km cell's one-or-many rule (Ruling 1); null means "keep today's plain
  // figure", the journey with no roadtrip of its own.
  const kmTarget = journeyKmTarget(trip, roadtrips);

  const figures: FigureBandCell[] = [
    ...(start !== null && end !== null
      ? [
          {
            key: "dates",
            label: t("common:summary.dates"),
            value: datesText(display, start.date, end.date),
          },
        ]
      : []),
    ...(days !== null
      ? [
          {
            key: "days",
            label: t("common:summary.cardDays", { count: days.days }),
            // The days open the journey's Timeline tab — the band is
            // navigation now (owner request 2026-10-14).
            value: (
              <Link to={`/trips/${trip.id}?tab=timeline`} className="hover:underline">
                {`${days.approximate ? "≈ " : ""}${nf.format(days.days)}`}
              </Link>
            ),
            title: days.approximate ? t("trips:figures.daysApprox") : undefined,
          },
        ]
      : []),
    {
      key: "km",
      label: t("trips:figures.km"),
      value: kmTarget ? (
        <Link to={kmTarget} className="hover:underline">{`${nf.format(km)} km`}</Link>
      ) : (
        `${nf.format(km)} km`
      ),
      sub: roadtrips.length > 0 ? t("trips:figures.kmSub", { count: roadtrips.length }) : undefined,
    },
    {
      key: "kmFlown",
      label: t("trips:figures.kmFlown"),
      // The flights band's own honesty rule, reused whole (`FlightTripFigures`):
      // `distancePrefix` marks a derived sum `~` and a sum missing a leg `≈`,
      // and a journey with no leg distance at all is a dash with its reason —
      // never a zero, and never a bare sum that would read as measured. The
      // figure opens the journey's flight-trip page whoever the sum is made of.
      value: (
        <Link to={`/flights/journeys/${trip.id}`} className="hover:underline">
          {knownLegs === 0 ? "—" : `${distancePrefix(flown)}${nf.format(flown.km)} km`}
        </Link>
      ),
      title:
        knownLegs === 0
          ? t("flights:journeyPage.figDistanceNone")
          : flown.derivedLegs > 0
            ? t("flights:journeyPage.figDistanceTitle", {
                derived: flown.derivedLegs,
                live: flown.liveLegs,
              })
            : t("flights:journeyPage.figDistanceMeasured"),
    },
    {
      key: "countries",
      label: t("trips:detail.stats.countries"),
      value: (
        <Link to={`/trips/${trip.id}?tab=map`} className="hover:underline">
          {nf.format(countries.length)}
        </Link>
      ),
      sub: countries.join(" · ") || undefined,
    },
    {
      key: "trips",
      // The flight entry the Trips tab draws is one trip of the journey, so
      // the count carries it too — a count the tab contradicts is worse than
      // no count (owner, 2026-10-12: the stats must reflect the flights).
      label: t("trips:figures.trips", { count: tripCount }),
      value: (
        <Link to={`/trips/${trip.id}?tab=trips`} className="hover:underline">
          {nf.format(tripCount)}
        </Link>
      ),
    },
    {
      key: "albums",
      label: t("trips:detail.stats.albums"),
      // The gallery is where the linked albums live; with none it is an empty
      // page, so the cell keeps today's plain count rather than lead there (the
      // owner's "a link to nowhere useful is worse than no link").
      value:
        albums.length > 0 ? (
          <Link to={`/trips/${trip.id}?tab=gallery`} className="hover:underline">
            {nf.format(albums.length)}
          </Link>
        ) : (
          nf.format(albums.length)
        ),
    },
  ];

  // Seven cells, two / four / seven — the flights band's own grid, reused so
  // the journey band's full row closes on itself instead of leaving the album
  // cell a row of its own; an undated journey's five close their own row
  // (`FigureBand.spanClasses`).
  return <FigureBand cells={figures} columns={[2, 4, 7]} />;
}

/* ─────────── The trip's cells ─────────── */

function TripFigures({ detail, today }: Omit<TripFiguresProps, "level">): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const r = detail.roadtrip;
  const n = detail.nights;
  const span = spanDays(detail.startDate, detail.endDate);
  const ahead = daysAhead(detail.startDate, detail.endDate, today);
  // The roadtrip is over only when it HAD a span and its phase says so: an
  // undated one shows its planned distance, never a "driven" it cannot know.
  // The phase is `roadtripPhase` — the list card's own rule, which keeps the
  // LAST day underway (`daysAhead` is already null on it) — so one trip cannot
  // read "Gefahren" here and "unterwegs" on the card the same day.
  const over = span !== null && roadtripPhase(detail.startDate, detail.endDate, today) === "past";
  // The days read the SAME fold the roadtrip card does (`roadtripDays`), so
  // one roadtrip cannot put two day counts under the one word; `≈` rides the
  // nights fallback exactly while those nights are only a lower bound.
  const days = roadtripDays(detail.startDate, detail.endDate, n);
  const journey = detail.trip;
  const album = journey ? albumForRoadtrip(journey, r.name) : null;
  const ferryNote =
    r.drivenKm !== r.distanceKm
      ? t("roadtrips:detail.figDrivenSub", { km: nf.format(r.distanceKm) })
      : undefined;

  const figures: FigureBandCell[] = [
    ...(detail.startDate !== null && detail.endDate !== null
      ? [
          {
            key: "dates",
            label: t("common:summary.dates"),
            value: datesText(display, detail.startDate, detail.endDate),
          },
        ]
      : []),
    {
      key: "driven",
      label: over ? t("roadtrips:detail.figDriven") : t("roadtrips:detail.figRoute"),
      // The distance opens the trip's Map tab (owner request 2026-10-14).
      value: (
        <Link
          to={`/roadtrips/${r.id}?tab=map`}
          className="hover:underline"
        >{`${nf.format(r.drivenKm)} km`}</Link>
      ),
      sub: over
        ? ferryNote
        : [t("roadtrips:detail.figRoutePlanned"), ferryNote].filter(Boolean).join(" · "),
    },
    {
      key: "days",
      label: t("roadtrips:detail.figDays"),
      // Days and the places slept in both open the trip's Timeline tab.
      value: (
        <Link to={`/roadtrips/${r.id}?tab=timeline`} className="hover:underline">
          {`${days.approximate ? "≈ " : ""}${nf.format(days.days)}`}
        </Link>
      ),
      sub: ahead !== null ? t("roadtrips:detail.figDaysAhead", { count: ahead }) : undefined,
      title: days.approximate ? t("roadtrips:list.nightsApprox") : undefined,
    },
    {
      key: "places",
      label: t("roadtrips:detail.figPlaces"),
      value: (
        <Link to={`/roadtrips/${r.id}?tab=timeline`} className="hover:underline">
          {t("roadtrips:detail.figPlacesValue", { count: n.placesSlept })}
        </Link>
      ),
    },
    {
      key: "countries",
      label: t("roadtrips:detail.figCountries"),
      // The countries open the trip's Map tab (owner request 2026-10-14).
      value: (
        <Link to={`/roadtrips/${r.id}?tab=map`} className="hover:underline">
          {nf.format(detail.countries.length)}
        </Link>
      ),
      sub: detail.countries.join(" · ") || undefined,
    },
    {
      key: "journey",
      label: t("common:summary.journey"),
      value: journey ? (
        <Link to={`/trips/${journey.id}`} className="hover:underline">
          {journey.name}
        </Link>
      ) : (
        t("common:labels.notAvailable")
      ),
    },
    {
      key: "album",
      label: t("common:summary.album"),
      value:
        album && journey ? (
          // The TRIP's gallery: its tab resolves the same album
          // (`RoadtripGallery` → `albumForRoadtrip`, journey fallback and all),
          // so the link lands on the page that shows what the cell names.
          <Link to={`/roadtrips/${r.id}?tab=gallery`} className="hover:underline">
            {album.albumName}
          </Link>
        ) : (
          t("common:labels.notAvailable")
        ),
      sub: album ? t("common:summary.albumSub", { count: album.assetCount }) : undefined,
    },
  ];

  const caption: ReactNode =
    r.startOdometerKm !== null || !detail.routingAvailable ? (
      <>
        {r.startOdometerKm !== null && (
          <span className="flex items-center" style={{ gap: 6 }}>
            <Icon name="gauge" size={16} />
            {t("roadtrips:detail.odometer", {
              from: nf.format(r.startOdometerKm),
              to:
                r.endOdometerKm !== null
                  ? nf.format(r.endOdometerKm)
                  : t("roadtrips:detail.odometerOpen"),
            })}
          </span>
        )}
        {!detail.routingAvailable && <span>{t("roadtrips:detail.noRouting")}</span>}
      </>
    ) : undefined;

  // Seven cells, two / four / seven — the band's 7-cell shape, so the row's
  // remainder is closed by the last cell rather than left as an empty track.
  return <FigureBand cells={figures} columns={[2, 4, 7]} caption={caption} />;
}
