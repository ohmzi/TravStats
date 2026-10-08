import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { roadtripsApi } from "../../lib/api/roadtrips";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type { RoadtripDetail } from "../../types/roadtrip";

/**
 * The card a roadtrip line puts up on the dashboard (owner, 2026-10-08).
 *
 * The roadtrip tabs drew their lines and listed their sections beside the map,
 * so a reader could see a route and not ask it anything: clicking it did
 * nothing, because the layer was pickable and no one listened. This is the
 * answer the flight card already gives for a route — what it is, what it took,
 * and the way in.
 *
 * It fetches its own figures rather than taking them from the tab. The tab's
 * tour index carries the line and its name, not the nights or the station
 * count, and those live behind the roadtrip's own endpoint — one request, made
 * only when a line is actually clicked. Until it lands the card shows what it
 * already knows, so the click feels immediate and the numbers fill in.
 */
export default function RoadtripCardOverlay({
  routeId,
  name,
  onClose,
}: {
  routeId: string;
  name: string;
  onClose: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "common"]);
  const [detail, setDetail] = useState<RoadtripDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setFailed(false);
    void (async () => {
      try {
        const d = await roadtripsApi.get(routeId);
        if (!cancelled) setDetail(d);
      } catch (error: unknown) {
        logger.error({ err: error, routeId }, "RoadtripCardOverlay: failed to load the roadtrip");
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const figures = detail
    ? [
        { value: `${nf.format(detail.roadtrip.drivenKm)} km`, label: t("roadtrips:list.figKm") },
        {
          value: nf.format(detail.nights.nights),
          label: t("roadtrips:list.figNights", { count: detail.nights.nights }),
        },
        {
          value: nf.format(detail.roadtrip.stopCount),
          label: t("roadtrips:list.figStations", { count: detail.roadtrip.stopCount }),
        },
        {
          value: nf.format(detail.countries.length),
          label: t("roadtrips:detail.figCountries"),
        },
      ]
    : [];

  return (
    <div
      className="flex flex-col"
      style={{
        position: "absolute",
        left: "var(--ts-space-lg)",
        bottom: "var(--ts-space-lg)",
        width: 300,
        zIndex: 5,
        gap: "var(--ts-space-sm)",
        padding: "var(--ts-space-lg)",
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>
          {detail?.roadtrip.name ?? name}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common:buttons.close")}
          className="shrink-0"
          style={{ color: "var(--ts-muted)", lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {failed && <span className="t-caption">{t("roadtrips:detail.noRouting")}</span>}

      {figures.length > 0 && (
        <div className="grid grid-cols-2" style={{ gap: "var(--ts-space-sm)" }}>
          {figures.map((f) => (
            <span key={f.label} className="flex flex-col">
              <span
                className="t-meta-mono"
                style={{ fontSize: 15, fontWeight: 600, color: "var(--ts-text-bright)" }}
              >
                {f.value}
              </span>
              <span className="t-caption">{f.label}</span>
            </span>
          ))}
        </div>
      )}

      <Link
        to={`/roadtrips/${routeId}`}
        className="btn-primary text-center"
        style={{ textDecoration: "none" }}
      >
        {t("roadtrips:list.open")}
      </Link>
    </div>
  );
}
