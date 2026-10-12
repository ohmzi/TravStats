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

/** The roadtrip a trip-side Re-sync scans, and the journey it is filed on (owner request 2026-10-12). */
export interface RouteScanInput {
  /** The journey's id and name, as `GET /roadtrips/:id` reports them. */
  journey: { id: string; name: string };
  /** The roadtrip whose own dates are the window and whose row the commit updates. */
  route: { id: string; name: string; startDate: string | null; endDate: string | null };
}

/**
 * Starts the trip edit page's own Re-sync (owner request 2026-10-12): the scan
 * window is THAT roadtrip's saved dates, and the target names both the journey
 * and the route, so the scan and the commit update only that trip. The trip's
 * own name travels as the scan's name (the album and a re-minted area name
 * would otherwise come from the journey's). Throws a `RangeError` when the
 * trip's dates give no window; ask `scanWindowOf` on the route first.
 */
export async function startRouteScan(
  input: RouteScanInput,
  opts: ExistingScanOptions
): Promise<{ jobId: string }> {
  const { route } = input;
  const span = scanWindowOf(route);
  if ("refusal" in span) throw new RangeError(`The trip has no scannable dates: ${span.refusal}`);
  const target = {
    kind: "existing",
    tripId: input.journey.id,
    routeId: route.id,
  } as const;
  const scan: ScanBody = {
    name: route.name,
    ...span,
    inspect: true,
    createAlbum: opts.createAlbum,
    target,
  };
  const { jobId } = await tripBuilderApi.scan(scan);
  const handoff: LauncherHandoff = {
    form: { name: route.name, startDate: span.startDay, endDate: span.endDay },
    target,
    // Back returns to the trip's page, mirroring the journey flow (which goes
    // back to the journey's).
    returnTo: `/roadtrips/${route.id}`,
    scan,
  };
  writeSession(jobKey(jobId), handoff);
  return { jobId };
}
