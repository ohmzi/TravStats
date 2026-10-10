/**
 * Starting a scan for a trip that already exists (spec §G edit mode, §K.1): its
 * saved dates are the window, and the review adds to the trip instead of making
 * one. Used by the "Build from Immich photos…" button of the trip form.
 */
import type { Trip } from "../../types";
import type { LauncherHandoff, ScanBody } from "../../types/tripBuilder";
import { tripBuilderApi } from "../api/tripBuilder";
import { dayOf, windowIssue } from "./scanWindow";
import { jobKey, writeSession } from "./session";

export type ScanRefusal = "noDates" | "reversed" | "tooLong";

/** The window a trip's saved dates give a scan, or why they give none. */
export function scanWindowOf(
  trip: Pick<Trip, "startDate" | "endDate">
): { startDay: string; endDay: string } | { refusal: ScanRefusal } {
  const startDay = dayOf(trip.startDate);
  const endDay = dayOf(trip.endDate);
  if (startDay === null || endDay === null) return { refusal: "noDates" };
  const issue = windowIssue(startDay, endDay);
  if (issue === "reversed" || issue === "tooLong") return { refusal: issue };
  return { startDay, endDay };
}

/** What the caller decides about the scan; inspect is always on, the album is a choice. */
export interface ExistingScanOptions {
  createAlbum: boolean;
}

/**
 * Starts the scan and files the handoff the review page reads, with the scan
 * request in it so a scan that is lost before any draft exists can be run
 * again. Inspect is on, and the album is whatever `createAlbum` says: nothing is
 * made before the review, where the album can still be switched off. Throws a
 * `RangeError` when the trip's dates give no window; ask `scanWindowOf` first.
 */
export async function startExistingScan(
  trip: Pick<Trip, "id" | "name" | "startDate" | "endDate">,
  opts: ExistingScanOptions
): Promise<{ jobId: string }> {
  const span = scanWindowOf(trip);
  if ("refusal" in span) throw new RangeError(`The trip has no scannable dates: ${span.refusal}`);
  const target = { kind: "existing", tripId: trip.id } as const;
  const scan: ScanBody = {
    name: trip.name,
    ...span,
    inspect: true,
    createAlbum: opts.createAlbum,
    target,
  };
  const { jobId } = await tripBuilderApi.scan(scan);
  const handoff: LauncherHandoff = {
    form: { name: trip.name, startDate: span.startDay, endDate: span.endDay },
    target,
    returnTo: `/trips/${trip.id}`,
    scan,
  };
  writeSession(jobKey(jobId), handoff);
  return { jobId };
}
