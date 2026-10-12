/**
 * Scanning again from the review page: for other dates ("Change dates…", the
 * warnings' extend chips) or because the draft expired. The new scan is an
 * ordinary job, so the page follows it the way it follows the first; the edits
 * ride along under `tb:carry:<jobId>` for `reapplyEdits` to put onto the new
 * draft by the stable keys.
 */
import type { LauncherHandoff, ScanBody, TripBuilderDraft } from "../../types/tripBuilder";
import { tripBuilderApi } from "../api/tripBuilder";
import type { DraftEdit } from "./draftEdits";
import { carryKey } from "./reviewSession";
import { jobKey, writeSession } from "./session";

/** The scan that would make `draft` again; `name` is the trip name as it stands in the review. */
export function scanBodyFor(draft: TripBuilderDraft, name: string): ScanBody {
  return {
    name: name.trim() || draft.tripName,
    startDay: draft.window.startDay,
    endDay: draft.window.endDay,
    inspect: draft.options.inspect,
    createAlbum: draft.options.createAlbum,
    target:
      draft.target.kind === "existing"
        ? {
            kind: "existing",
            tripId: draft.target.tripId,
            // A re-scan of a trip-scoped draft stays scoped to that trip.
            ...(draft.target.routeId === undefined ? {} : { routeId: draft.target.routeId }),
          }
        : { kind: "new" },
  };
}

export interface RescanInput {
  scan: ScanBody;
  handoff: LauncherHandoff;
  edits: DraftEdit[];
  commitKey: string;
}

/** Starts the scan and files what the page needs to follow it; returns the job to follow. */
export async function startRescan(input: RescanInput): Promise<string> {
  const { jobId } = await tripBuilderApi.scan(input.scan);
  writeSession(jobKey(jobId), input.handoff);
  writeSession(carryKey(jobId), { edits: input.edits, commitKey: input.commitKey });
  return jobId;
}
