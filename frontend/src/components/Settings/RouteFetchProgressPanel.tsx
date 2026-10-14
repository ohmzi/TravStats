import { useEffect, useState } from "react";
import type { JSX } from "react";

import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { useToursVisible } from "../../hooks/useToursVisible";
import { adminApi, type RouteFetchStatus } from "../../lib/api";
import { logger } from "../../lib/logger";

/** Fast while a job runs (it changes phase and regions); slow when idle. */
const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 15000;

/** Whole minutes since an epoch-SECONDS timestamp — never negative on a skew. */
function minutesSince(atSeconds: number): number {
  return Math.max(0, Math.floor((Date.now() / 1000 - atSeconds) / 60));
}

/**
 * The admin map-download progress panel (owner request 2026-10-14: "a place
 * in setting that shows its progress", beside the routing configuration it
 * belongs to). It reads only what the host's `osrm-autofetch` `GET /status`
 * reports — `GET /admin/route-fetch` proxies it — and shows nothing it cannot
 * source: the phase in words, the regions, the elapsed time, and the ETA only
 * when the service names one. No invented percentage; when the only progress
 * the service exposes is a phase, the phase is what this says.
 *
 * Admin-only and gated like the routing card beside it (tours behind the
 * `roadtrips` beta key): a panel for a feature hidden everywhere else would
 * offer nothing. Silently refreshes on a timer — the last good view stays on
 * screen — and stops when the panel unmounts.
 */
export default function RouteFetchProgressPanel(): JSX.Element | null {
  const { t } = useTranslation(["settings", "common"]);
  const toursVisible = useToursVisible();
  const [status, setStatus] = useState<RouteFetchStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!toursVisible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      try {
        const data = await adminApi.getRouteFetchStatus();
        if (cancelled) return;
        setStatus(data);
        setLoadFailed(false);
        const running = data.configured === true && data.reachable === true && !!data.job;
        timer = setTimeout(() => void poll(), running ? ACTIVE_POLL_MS : IDLE_POLL_MS);
      } catch (err) {
        if (cancelled) return;
        logger.error("Failed to load the route-fetch status", err);
        setLoadFailed(true);
        timer = setTimeout(() => void poll(), IDLE_POLL_MS);
      }
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [toursVisible]);

  if (!toursVisible) return null;

  let body: JSX.Element;
  if (loadFailed) {
    body = (
      <p className="text-sm" style={{ color: "var(--danger)" }} data-testid="route-fetch-error">
        {t("settings:routing.fetch.loadError")}
      </p>
    );
  } else if (status === null) {
    body = (
      <p
        className="text-sm"
        style={{ color: "var(--text-muted)" }}
        data-testid="route-fetch-loading"
      >
        {t("common:loading.title")}
      </p>
    );
  } else if (status.configured !== true) {
    body = (
      <p className="text-sm" style={{ color: "var(--text-muted)" }} data-testid="route-fetch-off">
        {t("settings:routing.fetch.notConfigured")}
      </p>
    );
  } else if (status.reachable !== true) {
    body = (
      <p
        className="text-sm"
        style={{ color: "var(--danger)" }}
        data-testid="route-fetch-unreachable"
      >
        {t("settings:routing.fetch.unreachable")}
      </p>
    );
  } else {
    const job = status.job ?? null;
    const lastResult = status.lastResult ?? null;
    const built = status.built ?? [];
    body = (
      <div className="space-y-1" data-testid="route-fetch-state">
        {job ? (
          <>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {t(`settings:routing.fetch.phase.${job.state}`)}
            </p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {job.label}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings:routing.fetch.regions", { regions: job.regions.join(", ") })}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings:routing.fetch.elapsed", { minutes: minutesSince(job.startedAt) })}
            </p>
            {job.etaMinutes != null && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings:routing.fetch.eta", { minutes: job.etaMinutes })}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("settings:routing.fetch.idle")}
            </p>
            {built.length > 0 && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings:routing.fetch.built", { regions: built.join(", ") })}
              </p>
            )}
            {lastResult?.status === "built" && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings:routing.fetch.lastBuilt", {
                  regions: lastResult.regions.join(", "),
                  minutes: minutesSince(lastResult.at),
                })}
              </p>
            )}
            {lastResult?.status === "failed" && (
              <p className="text-xs" style={{ color: "var(--danger)" }}>
                {t("settings:routing.fetch.lastFailed", { error: lastResult.error ?? "" })}
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:routing.fetch.title")}
        description={t("settings:routing.fetch.description")}
      />
      {body}
    </SectionCard>
  );
}
