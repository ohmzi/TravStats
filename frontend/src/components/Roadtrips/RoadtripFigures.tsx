import type { JSX } from "react";
import { Link } from "react-router-dom";

import FigureBand, { type FigureBandCell } from "../ui/FigureBand";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { daysAhead, spanDays } from "../../lib/roadtrip/roadtripView";
import type { RoadtripDetail } from "../../types/roadtrip";

/**
 * The figures band of a roadtrip (board 2): driven, days, places slept,
 * countries — each with the line that says what it is made of — then the
 * journey it belongs to and that journey's Immich album as entry points. Fixed
 * columns (6 / 3 / 2), so the cells never reflow into an odd last row: six is
 * the full set, and an undated roadtrip draws five, because Days is left out
 * rather than drawn as a zero. A figure that cannot be derived is left out; a
 * cell that is an ENTRY POINT is always drawn, saying "N/A" when there is
 * nothing to point at, because an absent entry point and a hidden one read the
 * same otherwise.
 *
 * The band itself is `FigureBand`, shared with the flight journey's band so the
 * two cannot drift apart (owner, 2026-10-08: "match the flight page to the
 * road trip page"). Its journey and album cells read the SAME keys the journey
 * band reads (`common:summary.*`): both bands put the same two words on the
 * same two entry points, and one key set is what keeps them the same.
 *
 * NIGHTS AND DAY TOURS LEAVE THE BAND (owner, 2026-10-08): the nights restate
 * the same stretch of time as Days — "12 days" against "11 nights" — so Days
 * stays and Nights goes; the day-tour count goes with it. This is a DIFFERENT
 * surface from the roadtrip CARD, which drops DAY TOURS but KEEPS nights and
 * shows CITIES where the band shows places slept. Band and card are meant to
 * differ; do not "fix" one to match the other.
 */
export default function RoadtripFigures({
  detail,
  today,
}: {
  detail: RoadtripDetail;
  today: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "common"]);
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const r = detail.roadtrip;
  const n = detail.nights;
  const days = spanDays(detail.startDate, detail.endDate);
  const ahead = daysAhead(detail.startDate, detail.endDate, today);
  const journey = detail.trip;
  const album = journey?.immichAlbums?.[0] ?? null;

  // The km figure is the length of ALL legs, whatever their date. It may be
  // called driven only once the roadtrip is over; before that it is the
  // planned distance (forgejo#179: "Gefahren 254 km" on day 1 of 3, with the
  // only leg still ahead).
  const over = days !== null && ahead === null;
  const ferryNote =
    r.drivenKm !== r.distanceKm
      ? t("roadtrips:detail.figDrivenSub", { km: nf.format(r.distanceKm) })
      : undefined;

  const figures: FigureBandCell[] = [
    {
      key: "driven",
      label: over ? t("roadtrips:detail.figDriven") : t("roadtrips:detail.figRoute"),
      value: `${nf.format(r.drivenKm)} km`,
      sub: over
        ? ferryNote
        : [t("roadtrips:detail.figRoutePlanned"), ferryNote].filter(Boolean).join(" · "),
    },
    ...(days !== null
      ? [
          {
            key: "days",
            label: t("roadtrips:detail.figDays"),
            value: nf.format(days),
            sub: ahead !== null ? t("roadtrips:detail.figDaysAhead", { count: ahead }) : undefined,
          },
        ]
      : []),
    {
      key: "places",
      label: t("roadtrips:detail.figPlaces"),
      value: t("roadtrips:detail.figPlacesValue", { count: n.placesSlept }),
    },
    {
      key: "countries",
      label: t("roadtrips:detail.figCountries"),
      value: nf.format(detail.countries.length),
      sub: detail.countries.join(" · ") || undefined,
    },
    // The journey and its album, as ENTRY POINTS rather than figures: a
    // roadtrip is reached from its journey, and the way back — plus the way to
    // the photos of the journey itself — belongs on this band. Either can be
    // absent (a standalone section, a journey with no album), and an absent
    // one says so rather than vanishing, so the reader can tell "none" from
    // "not shown".
    {
      key: "journey",
      // The same two words as the journey band's two cells (see the header):
      // one key set, so "Journey"/"Album" cannot mean two things.
      label: t("common:summary.journey"),
      value: journey ? (
        <Link to={`/trips/${journey.id}`}>{journey.name}</Link>
      ) : (
        t("common:labels.notAvailable")
      ),
    },
    {
      key: "album",
      label: t("common:summary.album"),
      value:
        album && journey ? (
          <Link to={`/trips/${journey.id}?tab=gallery`}>{album.albumName}</Link>
        ) : (
          t("common:labels.notAvailable")
        ),
      sub: album ? t("common:summary.albumSub", { count: album.assetCount }) : undefined,
    },
  ];

  return (
    <FigureBand
      cells={figures}
      // Six cells, two / three / six — the band's own cadence, unchanged.
      columns={[2, 3, 6]}
      caption={
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
      }
    />
  );
}
