import { useEffect, useRef, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";

import { useTranslation } from "../../../hooks/useTranslation";
import { rateLimitOf, scanStartFailureKey } from "../../../lib/tripBuilder/errors";
import {
  scanWindowOf,
  startExistingScan,
  type ScanRefusal,
} from "../../../lib/tripBuilder/launchExisting";
import { useToastStore } from "../../../store/toastStore";
import type { Trip } from "../../../types";
import Button from "../../ui/Button";

const REASON_KEY: Record<ScanRefusal | "unsaved", string> = {
  unsaved: "tripBuilder:editBuild.unsaved",
  noDates: "tripBuilder:editBuild.noDates",
  reversed: "tripBuilder:editBuild.reversed",
  tooLong: "tripBuilder:editBuild.tooLong",
};

/**
 * Goes to the review page once the scan has started. It is its own component so
 * that `useNavigate` runs only after the button was pressed: the trip form is
 * rendered without a router in many tests, and a button that is never pressed
 * must not need one.
 */
function Go({ to, onDone }: { to: string; onDone: () => void }): null {
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    navigate(to);
    onDone();
  }, []);
  return null;
}

interface EditBuildButtonProps {
  trip: Pick<Trip, "id" | "name" | "startDate" | "endDate">;
  /** The form has edits that are not saved: the scan would use the saved trip, not what is shown. */
  unsaved: boolean;
  /** The scan has started and the review page is open: close the form. */
  onLaunched: () => void;
}

/**
 * "Build from Immich photos…" in the form of an existing trip (spec §G edit
 * mode, §K.1): scans the trip's saved dates and opens the review, which adds to
 * this trip instead of making one. It waits for a saved form, because the
 * review reads the saved trip and closing the form would drop what is not saved.
 */
export default function EditBuildButton({
  trip,
  unsaved,
  onLaunched,
}: EditBuildButtonProps): JSX.Element {
  const { t } = useTranslation(["tripBuilder", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const span = scanWindowOf(trip);
  const reason: ScanRefusal | "unsaved" | null = unsaved
    ? "unsaved"
    : "refusal" in span
      ? span.refusal
      : null;

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      // The album is on for every existing trip: nothing is made before the
      // review, where it can still be switched off.
      setJob((await startExistingScan(trip, { createAlbum: true })).jobId);
    } catch (err: unknown) {
      const limited = rateLimitOf(err);
      addToast(
        "error",
        limited?.minutes
          ? t("tripBuilder:errors.rateLimitedMinutes", { count: limited.minutes })
          : t(scanStartFailureKey(err))
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      <div>
        <Button disabled={reason !== null || busy} onClick={() => void start()}>
          {t("tripBuilder:editBuild.button")}
        </Button>
      </div>
      {reason !== null && <span className="t-caption">{t(REASON_KEY[reason])}</span>}
      {job !== null && <Go to={`/trips/builder?job=${job}`} onDone={onLaunched} />}
    </div>
  );
}
