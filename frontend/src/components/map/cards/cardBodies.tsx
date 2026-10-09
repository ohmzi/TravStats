// The four newer card bodies: a trip group, a Sonder-Flug, a lodging and a
// place.
//
// Split out of `PinnedCard.tsx` when the merge with the globe's pin work
// brought the lodging and place shapes in from the other side — the card file
// was six lines under the 800-line limit, which is a trap for whoever touches
// it next rather than a size that passes. The shell, the heading and the four
// ORIGINAL bodies (route, airport, port, cruise) stay there; these four are
// the ones a reader looks up by name.

import type { JSX } from "react";
import { useEffect, useState } from "react";
import { resolveCountryCode } from "../../../lib/countryFlag";
import { LODGING_COLOR } from "../../../lib/lodgingColor";
import { PLACE_COLOR } from "../../../lib/placeColor";
import { rgbCss } from "../../../lib/flightColor";
import { roadtripsApi } from "../../../lib/api/roadtrips";
import { logger } from "../../../lib/logger";
import { tokens } from "../../../theme/tokens";
import type { GeoJSONFeature } from "../../../types";
import type { RoadtripDetail } from "../../../types/roadtrip";
import type {
  LodgingCardDatum,
  PlaceCardDatum,
  RoadtripCardDatum,
  SpecialFlightCardDatum,
  TripCardDatum,
} from "./pinnedTypes";
import { getArcStats, latestStayFacts } from "./cardStats";
import {
  Actions,
  Grid,
  Hero,
  Place,
  Row,
  SubHeading,
  formatDate,
  formatKm,
  formatKmNumber,
  type TFn,
} from "./cardChrome";
import { CardFlights } from "./CardFlights";
import { LocalName } from "../../places/LocalName";

export interface BodyCommonProps {
  locale: string;
  t: TFn;
}

// ─── Trip body ────────────────────────────────────────────────────

/**
 * A selection that spans more than one airport pair — the flat map's trip
 * grouping. It reports the same three facts a route does (how far, when, with
 * whom) and lists the flights; the route heading would be a lie here, so the
 * heading counts instead.
 */
export function TripBody({
  data,
  flights,
  locale,
  t,
  onTripDetails,
}: {
  data: TripCardDatum;
  flights: readonly GeoJSONFeature[];
  onTripDetails?: () => void;
} & BodyCommonProps): JSX.Element {
  const stats = getArcStats(flights, data.flightIds);
  const colorRgb = `rgb(${data.color[0]},${data.color[1]},${data.color[2]})`;
  return (
    <>
      <Hero color={colorRgb}>
        {t("map:globe.pinned.totalKm", {
          count: data.flightIds.length,
          km: formatKmNumber(stats.totalKm, locale),
        })}
      </Hero>
      <Grid>
        {/* The SPAN, as `TripTooltip` showed it. Only "last flight" survived
            the fold, which for a two-week trip named one day of it. */}
        {stats.firstFlightDate && stats.lastFlightDate && (
          <Row
            label={t("map:globe.pinned.dateRange")}
            value={
              stats.firstFlightDate === stats.lastFlightDate
                ? formatDate(stats.lastFlightDate, locale)
                : `${formatDate(stats.firstFlightDate, locale)} – ${formatDate(stats.lastFlightDate, locale)}`
            }
          />
        )}
        {stats.topAirline && (
          <Row label={t("map:globe.pinned.topAirline")} value={stats.topAirline} />
        )}
        {stats.topAircraft && (
          <Row label={t("map:globe.pinned.topAircraft")} value={stats.topAircraft} />
        )}
      </Grid>
      <CardFlights flights={flights} flightIds={data.flightIds} locale={locale} t={t} />
      <Actions
        primary={
          onTripDetails
            ? { label: t("map:globe.pinned.details"), onClick: onTripDetails }
            : undefined
        }
      />
    </>
  );
}

// ─── Sonder-Flug body ─────────────────────────────────────────────

export function SpecialFlightBody({
  data,
  locale,
  t,
  onFlightOpen,
}: {
  data: SpecialFlightCardDatum;
  onFlightOpen?: (flightId: string) => void;
} & BodyCommonProps): JSX.Element {
  const colorRgb = `rgb(${data.color[0]},${data.color[1]},${data.color[2]})`;
  return (
    <>
      <Hero color={colorRgb}>{data.routeLabel}</Hero>
      <Grid>
        {data.aircraft && <Row label={t("map:globe.pinned.topAircraft")} value={data.aircraft} />}
        {data.eventLabel && <Row label={t("map:globe.pinned.event")} value={data.eventLabel} />}
        {data.departureTime && (
          <Row
            label={t("map:globe.pinned.lastFlight")}
            value={formatDate(data.departureTime, locale)}
          />
        )}
      </Grid>
      <Actions
        primary={
          onFlightOpen
            ? {
                label: t("map:globe.pinned.openFlight"),
                onClick: () => onFlightOpen(data.flightId),
              }
            : undefined
        }
      />
    </>
  );
}

// ─── Lodging + place bodies ───────────────────────────────────────
//
// Neither needs a `cardStats` aggregator the way the four above do: a pin IS
// the row, already carrying its own derived `stayCount`, `nights` and
// `visitCount` from the server. There is nothing to fold, so there is nothing
// to fold DIFFERENTLY from the list page showing the same numbers.
//
// The ONE derivation is "which stay" — `latestStayFacts`, so the dates, the
// span and the price all name the same stay and the rule lives in one place.

/**
 * A hotel, as both the globe's pin and the activity sidebar's row mean it.
 *
 * `nights` and the stay row answer DIFFERENT questions and are labelled
 * separately on purpose: `Lodging.nights` is the lifetime total this account
 * has slept here, while the stay row is the most recent visit. Collapsing them
 * under one label would be two facts wearing one name.
 */
export function LodgingBody({
  data,
  locale,
  t,
  onLodgingOpen,
}: {
  data: LodgingCardDatum;
  onLodgingOpen?: (lodgingId: string) => void;
} & BodyCommonProps): JSX.Element {
  const stays = data.stayCount ?? 0;
  const nights = data.nights ?? 0;
  const stay = latestStayFacts(data.stays, locale);
  return (
    <>
      {data.type && <SubHeading>{t(`lodging:type.${data.type}`)}</SubHeading>}
      <Place city={data.city} country={resolveCountryCode(data.country)} locale={locale} />
      <Hero color={rgbCss(LODGING_COLOR)}>{t("lodging:field.staysCount", { count: stays })}</Hero>
      <Grid>
        {/* An upcoming booking is labelled as one: the hero counts only stays
            already slept (shared/lodgingCounting.ts), so presenting a future
            date under that count as "the stay" contradicted the number above
            it. */}
        {stay.dateRange && (
          <Row
            label={t(stay.upcoming ? "map:globe.pinned.upcomingStay" : "map:globe.pinned.stay")}
            value={stay.dateRange}
          />
        )}
        {/* Nights are omitted rather than shown as 0 when nothing is recorded:
            a stay whose span is unknown and a same-day stay both come to 0,
            and only one of those means "no nights" (shared/lodgingTiming.ts). */}
        {nights > 0 && (
          <Row
            label={t("map:globe.pinned.nights")}
            value={t("lodging:field.nightsCount", { count: nights })}
          />
        )}
        {stay.price && <Row label={t("map:globe.pinned.price")} value={stay.price} />}
        {data.chain?.name && <Row label={t("lodging:field.chain")} value={data.chain.name} />}
        {data.overallRating != null && (
          <Row label={t("lodging:field.ratingOverall")} value={data.overallRating.toFixed(1)} />
        )}
      </Grid>
      <Actions
        primary={
          onLodgingOpen
            ? { label: t("map:globe.pinned.openLodging"), onClick: () => onLodgingOpen(data.id) }
            : undefined
        }
      />
    </>
  );
}

export function PlaceBody({
  data,
  locale,
  t,
  onPlaceOpen,
}: {
  data: PlaceCardDatum;
  onPlaceOpen?: (placeId: string) => void;
} & BodyCommonProps): JSX.Element {
  return (
    <>
      <LocalName value={data.localName} block className="mb-1" testId="pinned-place-local-name" />
      {data.category && <SubHeading>{t(`places:categories.${data.category}`)}</SubHeading>}
      <Place city={data.city} country={resolveCountryCode(data.country)} locale={locale} />
      {/* A wishlist entry has no visit count to show — it is somewhere the
          user has NOT been, and "0 Besuche" reads as a failure rather than an
          intention (shared/placeCounting.ts draws the same line). */}
      <Hero color={rgbCss(PLACE_COLOR)}>
        {data.visited === false
          ? t("places:list.status.wishlist")
          : t("places:list.visitsCount", { count: data.visitCount ?? 0 })}
      </Hero>
      <Grid>
        {data.lastVisitAt && (
          <Row label={t("map:tooltip.lastVisit")} value={formatDate(data.lastVisitAt, locale)} />
        )}
      </Grid>
      <Actions
        primary={
          onPlaceOpen
            ? { label: t("map:globe.pinned.openPlace"), onClick: () => onPlaceOpen(data.id) }
            : undefined
        }
      />
    </>
  );
}

// ─── Roadtrip body ────────────────────────────────────────────────

/**
 * The card a roadtrip LINE puts up on the dashboard (owner, 2026-10-09).
 *
 * The roadtrip tabs drew their lines and listed their sections beside the map,
 * so a reader could see a route and not ask it anything. The flight line already
 * answered a tap with the shared card; this is the SAME furniture for a roadtrip
 * — heading, the km it covered, the nights and stations, and the way in.
 *
 * It fetches its own figures (`roadtripsApi.get`) because the tab's tour index
 * carries the line and its name, not the nights or the station count. A failed
 * or absent figure is a DASH with its reason, never a 0: a roadtrip whose
 * distance did not load is not a roadtrip that covered nothing.
 *
 * This began life as a standalone overlay docked bottom-left of the map, which
 * put it in a corner rather than near the line the reader tapped. Folding it
 * into the shared card is what fixes that: the renderer projects the datum's
 * `anchorLngLat` exactly as it does for the flight card, so both appear beside
 * the thing they describe.
 */
export function RoadtripBody({
  data,
  locale,
  t,
}: { data: RoadtripCardDatum } & BodyCommonProps): JSX.Element {
  const [detail, setDetail] = useState<RoadtripDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setFailed(false);
    void (async () => {
      try {
        const d = await roadtripsApi.get(data.routeId);
        if (!cancelled) setDetail(d);
      } catch (error: unknown) {
        logger.error(
          { err: error, routeId: data.routeId },
          "RoadtripBody: failed to load the roadtrip"
        );
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.routeId]);

  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  return (
    <>
      {failed && (
        <>
          <Hero color={tokens.color.faint}>—</Hero>
          <SubHeading>{t("roadtrips:detailLoadError")}</SubHeading>
        </>
      )}
      {detail && (
        <>
          <Hero color={tokens.domainColor.roadtrip}>
            {formatKm(detail.roadtrip.drivenKm, locale)}
          </Hero>
          <Grid>
            <Row
              label={t("roadtrips:list.figNights", { count: detail.nights.nights })}
              value={nf.format(detail.nights.nights)}
            />
            <Row
              label={t("roadtrips:list.figStations", { count: detail.roadtrip.stopCount })}
              value={nf.format(detail.roadtrip.stopCount)}
            />
            <Row
              label={t("roadtrips:detail.figCountries")}
              value={nf.format(detail.countries.length)}
            />
          </Grid>
        </>
      )}
      <Actions
        primary={{
          // "Last" is a claim that the line stands for more than one roadtrip;
          // a line is one roadtrip today, so the plain wording is the honest
          // one and the branch is here for the day a grouping puts several on
          // one line (owner, 2026-10-09).
          label:
            data.count > 1 ? t("roadtrips:list.lastRoadtrip") : t("roadtrips:list.openDetails"),
          to: `/roadtrips/${data.routeId}`,
        }}
      />
    </>
  );
}
