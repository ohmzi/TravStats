import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { tripBuilderApi } from "../../../lib/api/tripBuilder";
import type { CreateTripInput } from "../../../lib/api/trips";
import { apiErrorCode } from "../../../lib/apiError";
import { saveErrorKey } from "../../../lib/saveErrorMessage";
import { jobKey, writeSession } from "../../../lib/tripBuilder/session";
import { useToastStore } from "../../../store/toastStore";
import type { LauncherHandoff, ScanBody } from "../../../types/tripBuilder";
import type { ImmichScanOptions } from "./useImmichBuild";

interface Props {
  form: CreateTripInput;
  options: ImmichScanOptions;
  /** Called after the navigation, so the popup closes behind the review page, not before it. */
  onClose: () => void;
  /** The scan did not start; the popup keeps its form. */
  onFailed: () => void;
}

/** The scan request for a new trip, or null when the form has no window to scan. */
export function scanBodyOf(form: CreateTripInput, options: ImmichScanOptions): ScanBody | null {
  if (!form.startDate || !form.endDate) return null;
  return {
    name: form.name,
    startDay: form.startDate,
    endDay: form.endDate,
    inspect: options.inspect,
    createAlbum: options.createAlbum,
    target: { kind: "new" },
  };
}

function failureKey(err: unknown): string {
  if (apiErrorCode(err) === "notConfigured") return "tripBuilder:launch.notConfigured";
  return saveErrorKey(err, "tripBuilder:launch.failed");
}

/**
 * Starts the scan and hands the form to the review page (spec 2026-10-09 §A).
 *
 * Rendered by the popup only after Save, and the ONLY place of the builder
 * that calls `useNavigate`: `TripModal` itself has Router-less tests, so a
 * router hook there would break them. It posts the scan, keeps what the popup
 * knew in `sessionStorage[tb:job:<jobId>]` for the page, navigates, and only
 * then closes the popup.
 *
 * The hand-off carries the request it posted as `scan`: a scan that is lost
 * before any draft exists has nothing else to rebuild it from, and the page
 * offers "Scan again" from it.
 */
export default function TripBuilderLauncher({ form, options, onClose, onFailed }: Props): null {
  const { t } = useTranslation(["tripBuilder", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const started = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    // One scan per launcher, also under StrictMode's second effect run.
    if (!started.current) {
      started.current = true;
      void run();
    }
    return () => {
      alive.current = false;
    };
  }, []);

  async function run(): Promise<void> {
    const body = scanBodyOf(form, options);
    if (!body) {
      addToast("error", t("tripBuilder:launch.needDates"));
      onFailed();
      return;
    }
    try {
      const { jobId } = await tripBuilderApi.scan(body);
      // The popup was closed while the request ran: nobody is left to hand over to.
      if (!alive.current) return;
      const handoff: LauncherHandoff = { form, target: body.target, returnTo, scan: body };
      writeSession(jobKey(jobId), handoff);
      navigate(`/trips/builder?job=${encodeURIComponent(jobId)}`);
      onClose();
    } catch (err) {
      addToast("error", t(failureKey(err)));
      onFailed();
    }
  }

  return null;
}
