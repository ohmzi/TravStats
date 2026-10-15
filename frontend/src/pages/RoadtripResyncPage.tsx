import { useEffect, useRef, useState, type JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import ActionLink from "../components/ui/ActionLink";
import EmptyState from "../components/ui/EmptyState";
import { useTranslation } from "../hooks/useTranslation";
import { roadtripsApi } from "../lib/api/roadtrips";
import { apiErrorCode, apiErrorMachineCode } from "../lib/apiError";
import { scanWindowOf, startRouteScan, type ScanRefusal } from "../lib/tripBuilder/launchExisting";

type Problem = "noDates" | "notConfigured" | "tooLong" | "failed";

/** Why a trip's saved dates refused a scan, said the way this page says it. */
const PROBLEM_OF_REFUSAL: Record<ScanRefusal, Problem> = {
  noDates: "noDates",
  tooLong: "tooLong",
  // The form refuses an end before the start, so such a row is not a state
  // the reader can act on; it reads as a plain failure.
  reversed: "failed",
};

/**
 * Where the TRIP's "Re-sync from Immich" goes (owner request 2026-10-12): the
 * trip edit page's section links here, the trip's own saved dates are the scan
 * window, and the scan's target names both the journey and the roadtrip — so
 * the review and the commit update that trip alone. The journey edit page's
 * entry keeps `/trips/:id/resync`, which re-syncs the whole journey.
 */
export default function RoadtripResyncPage(): JSX.Element {
  const { routeId } = useParams<{ routeId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["tripBuilder"]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!routeId || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const detail = await roadtripsApi.get(routeId);
        // A detached trip has no journey to scan against; the entry never
        // links here for one, so this reads as a plain failure.
        if (detail.trip === null) {
          setProblem("failed");
          return;
        }
        const span = scanWindowOf(detail);
        if ("refusal" in span) {
          setProblem(PROBLEM_OF_REFUSAL[span.refusal]);
          return;
        }
        // The album is asked for the way the journey flow asks: the scan only
        // reads, and the review's switch decides; for this scope it targets the
        // trip's own album, matched by its stored name.
        const { jobId } = await startRouteScan(
          {
            journey: { id: detail.trip.id, name: detail.trip.name },
            route: {
              id: detail.roadtrip.id,
              name: detail.roadtrip.name,
              startDate: detail.startDate,
              endDate: detail.endDate,
            },
          },
          { createAlbum: true }
        );
        navigate(`/trips/builder?job=${encodeURIComponent(jobId)}`, { replace: true });
      } catch (err: unknown) {
        if (apiErrorCode(err) === "notConfigured") setProblem("notConfigured");
        else if (apiErrorMachineCode(err) === "VALIDATION_FAILED") setProblem("tooLong");
        else setProblem("failed");
      }
    })();
  }, [routeId, navigate]);

  // The same shared outline control as the journey's resync page draws — the
  // two screens are twins and their way out was the one thing they styled
  // separately (owner, 2026-10-15: "back buttons aren't matching").
  const back: JSX.Element = (
    <ActionLink to={routeId ? `/roadtrips/${routeId}` : "/roadtrips"}>
      {t("tripBuilder:resync.backTrip")}
    </ActionLink>
  );

  return (
    <AppShell width="list">
      {problem === null && <EmptyState kind="pending" title={t("tripBuilder:resync.starting")} />}
      {problem === "noDates" && (
        <EmptyState
          title={t("tripBuilder:resync.tripNoDates.title")}
          description={t("tripBuilder:resync.tripNoDates.description")}
          action={back}
        />
      )}
      {problem === "notConfigured" && (
        <EmptyState
          kind="unpaired"
          title={t("tripBuilder:resync.notConfigured.title")}
          banner={t("tripBuilder:resync.notConfigured.description")}
          action={
            <Link to="/settings/services?section=externalServices" className="underline">
              {t("tripBuilder:resync.notConfigured.action")}
            </Link>
          }
        />
      )}
      {problem === "tooLong" && (
        <EmptyState
          title={t("tripBuilder:resync.tripTooLong.title")}
          description={t("tripBuilder:resync.tripTooLong.description")}
          action={back}
        />
      )}
      {problem === "failed" && (
        <EmptyState
          kind="degraded"
          title={t("tripBuilder:resync.failed.title")}
          description={t("tripBuilder:resync.failed.description")}
          action={back}
        />
      )}
    </AppShell>
  );
}
