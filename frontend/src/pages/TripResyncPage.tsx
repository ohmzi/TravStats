import { useEffect, useRef, useState, type JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import AppShell from "../components/ui/AppShell";
import EmptyState from "../components/ui/EmptyState";
import { useTranslation } from "../hooks/useTranslation";
import { tripsApi } from "../lib/api/trips";
import { apiErrorCode, apiErrorMachineCode } from "../lib/apiError";
import {
  scanWindowOf,
  startExistingScan,
  type ScanRefusal,
} from "../lib/tripBuilder/launchExisting";

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
 * Where "Re-sync from Immich" goes (spec 2026-10-09 §K.1): the trip page, the
 * roadtrip page and the "dates changed" toast all link here. It scans the
 * trip's saved dates against the trip itself and hands the job to the review
 * page, so three entry points share one launch and the router-less TripModal
 * never needs one.
 */
export default function TripResyncPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["tripBuilder"]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const trip = await tripsApi.getById(id);
        const span = scanWindowOf(trip);
        if ("refusal" in span) {
          setProblem(PROBLEM_OF_REFUSAL[span.refusal]);
          return;
        }
        // The album is asked for the way the edit-mode button asks (§K.3): the
        // scan only reads, and the review's switch — on by default when the key
        // may, and turnable off there — decides what the commit writes. Gating
        // it on an album already being linked made these entry points disagree
        // and left an album-less trip unable to ever get one.
        const { jobId } = await startExistingScan(trip, { createAlbum: true });
        navigate(`/trips/builder?job=${encodeURIComponent(jobId)}`, { replace: true });
      } catch (err: unknown) {
        if (apiErrorCode(err) === "notConfigured") setProblem("notConfigured");
        else if (apiErrorMachineCode(err) === "VALIDATION_FAILED") setProblem("tooLong");
        else setProblem("failed");
      }
    })();
  }, [id, navigate]);

  const back = (
    <Link to={id ? `/trips/${id}` : "/trips"} className="underline">
      {t("tripBuilder:resync.back")}
    </Link>
  );

  return (
    <AppShell width="list">
      {problem === null && <EmptyState kind="pending" title={t("tripBuilder:resync.starting")} />}
      {problem === "noDates" && (
        <EmptyState
          title={t("tripBuilder:resync.noDates.title")}
          description={t("tripBuilder:resync.noDates.description")}
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
          title={t("tripBuilder:resync.tooLong.title")}
          description={t("tripBuilder:resync.tooLong.description")}
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
