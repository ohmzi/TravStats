import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { StopoverTick } from "../../../lib/tripBuilder/draftEdits";
import { stopoverHours } from "../../../lib/tripBuilder/reviewView";
import type { DraftFlight, DraftStopover } from "../../../types/tripBuilder";
import { Switch } from "../../ui/Field";
import Pill from "../../ui/Pill";
import ReviewSection from "./ReviewSection";

interface ReviewStopoversProps {
  stopovers: readonly DraftStopover[];
  /** The draft's flights: a stopover's key names the two the heading's hours come from. */
  flights: readonly DraftFlight[];
  ticks: Readonly<Record<string, StopoverTick>>;
  /** Roadtrips are switched off for this account, so switch 1 cannot be turned on. */
  roadtripsHidden: boolean;
  onTick: (key: string, tick: StopoverTick) => void;
}

/**
 * The stopovers the scan found (spec 2026-10-11 §3): a long layover the traveller
 * spent in the city. Both switches start off; the second only enables with the
 * first. A stopover the re-sync already wrote shows both on and locked.
 */
export default function ReviewStopovers({
  stopovers,
  flights,
  ticks,
  roadtripsHidden,
  onTick,
}: ReviewStopoversProps): JSX.Element | null {
  const { t } = useTranslation(["tripBuilder"]);
  const fmt = useDisplayFormat();
  if (stopovers.length === 0) return null;

  return (
    <ReviewSection
      title={t("tripBuilder:review.stopovers.title")}
      aside={t("tripBuilder:review.stopovers.hint")}
    >
      <ul className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
        {stopovers.map((stopover) => {
          const tick = ticks[stopover.key] ?? { roadtrip: false, album: false };
          // The wire marks a matched stopover with `stored`; the flat `roadtripId`
          // is the mirror's older pair, which `initialReviewState` still reads.
          const synced = stopover.roadtripId !== undefined || stopover.stored !== undefined;
          const hours = stopoverHours(flights, stopover);
          // The key's `#` is not an id character the label can carry.
          const id = `stopover-${stopover.key.replace("#", "-")}`;
          return (
            <li
              key={stopover.key}
              data-stopover={stopover.key}
              className="flex flex-col"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <div className="flex flex-wrap items-baseline" style={{ gap: "var(--ts-space-md)" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ts-text-bright)" }}>
                  {hours === null
                    ? t("tripBuilder:review.stopovers.headingNoClock", {
                        city: stopover.city,
                        day: fmt.localDate(stopover.day),
                      })
                    : t("tripBuilder:review.stopovers.heading", {
                        city: stopover.city,
                        day: fmt.localDate(stopover.day),
                        hours,
                        airport: stopover.airportIata ?? "?",
                      })}
                </span>
                {synced && (
                  <Pill color="var(--ts-good)">{t("tripBuilder:review.stopovers.synced")}</Pill>
                )}
              </div>
              <span className="t-caption">
                {t("tripBuilder:review.stopovers.photos", { count: stopover.photoCount })}
                {" · "}
                {t("tripBuilder:review.stopovers.outing", { count: stopover.outingCount })}
              </span>
              {synced && (
                <span className="t-caption">
                  {t("tripBuilder:review.stopovers.syncedCounts", {
                    stored: stopover.storedPhotoCount ?? stopover.stored?.albumAssetCount ?? 0,
                    count: stopover.photoCount,
                  })}
                </span>
              )}

              <ol className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
                {stopover.stations.map((station, index) => (
                  <li
                    key={station.key}
                    className="flex items-center"
                    style={{ gap: "var(--ts-space-sm)" }}
                  >
                    {index > 0 && <span aria-hidden="true">→</span>}
                    <span>{station.title}</span>
                    <span className="t-caption">{fmt.localDate(station.firstDay)}</span>
                    {station.photoCount > 0 && (
                      <span className="t-caption">
                        {t("tripBuilder:review.station.photos", { count: station.photoCount })}
                      </span>
                    )}
                  </li>
                ))}
              </ol>

              <Switch
                id={`${id}-roadtrip`}
                label={t("tripBuilder:review.stopovers.roadtrip")}
                // A synced row is status, not an offer: the hidden reason belongs to a
                // switch the user could still consider (finding S3-1), and the re-sync
                // writes the album only, so nothing here is refused.
                sub={
                  roadtripsHidden && !synced ? t("tripBuilder:warnings.roadtripsHidden") : undefined
                }
                checked={synced || tick.roadtrip}
                disabled={synced || roadtripsHidden}
                onChange={(on) => onTick(stopover.key, { roadtrip: on, album: on && tick.album })}
              />
              <Switch
                id={`${id}-album`}
                label={t("tripBuilder:review.stopovers.album", { title: stopover.title })}
                checked={synced || tick.album}
                disabled={synced || roadtripsHidden || !tick.roadtrip}
                // The switch is only enabled with switch 1 on, so this cannot turn
                // the album on under a roadtrip that is off.
                onChange={(on) => onTick(stopover.key, { roadtrip: true, album: on })}
              />
              <span className="t-caption">{t("tripBuilder:review.stopovers.albumNote")}</span>
            </li>
          );
        })}
      </ul>
    </ReviewSection>
  );
}
